// =============================================================================
// Pipeline Orchestration Edge Function
// =============================================================================
// Coordinates the full pipeline: Discovery -> Parsing -> Embedding -> Storage
// Runs SYNCHRONOUSLY (Edge Functions are stateless)
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PipelineJob, VectorSearchResult } from "../_shared/types.ts";
import { createResponse, handleCors, getRequiredEnv, generateJobId } from "../_shared/utils.ts";

interface PipelineRequest {
  action: "run_pipeline" | "search";
  // For run_pipeline
  file_numbers?: string[];
  search_terms?: string[];
  max_credits?: number;
  pdf_limit?: number;  // Limit number of PDFs to process (default: 3)
  // For search
  query?: string;
  limit?: number;
  min_score?: number;
}

interface PipelineResponse {
  job?: PipelineJob;
  search_results?: VectorSearchResult[];
  message?: string;
}

serve(async (req: Request) => {
  const startTime = Date.now();

  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const SUPABASE_URL = getRequiredEnv("SUPABASE_URL");

    if (req.method !== "POST") {
      return createResponse(null, "Method not allowed. Use POST.", startTime);
    }

    const body: PipelineRequest = await req.json();

    switch (body.action) {
      case "run_pipeline":
        return await runPipelineSync(body, SUPABASE_URL, startTime);

      case "search":
        return await runSearch(body, SUPABASE_URL, startTime);

      default:
        return createResponse(
          null,
          "Invalid action. Use 'run_pipeline' or 'search'.",
          startTime
        );
    }
  } catch (error) {
    console.error(`[orchestrate] Error:`, error);
    return createResponse(null, (error as Error).message, startTime);
  }
});

/**
 * Run the full pipeline SYNCHRONOUSLY
 */
async function runPipelineSync(
  request: PipelineRequest,
  supabaseUrl: string,
  startTime: number
): Promise<Response> {
  const fileNumbers = request.file_numbers;
  const searchTerms = request.search_terms || [
    "housing development",
    "zoning amendment",
    "environmental impact report",
    "EIR",
    "residential project"
  ];
  const maxCredits = request.max_credits || 150;
  const pdfLimit = request.pdf_limit || 3;  // Process max 3 PDFs to stay within resource limits
  const baseUrl = supabaseUrl.replace(/\/$/, "");

  const job: PipelineJob = {
    job_id: generateJobId(),
    status: "discovering",
    file_numbers: fileNumbers || [],
    discovered_pdfs: [],
    parsed_chunks: 0,
    embedded_chunks: 0,
    upserted_chunks: 0,
    started_at: new Date().toISOString(),
  };

  console.log(`[orchestrate] Starting pipeline job: ${job.job_id}`);
  console.log(`[orchestrate] Search terms: ${searchTerms.join(", ")}`);

  try {
    // Step 1: Autonomous Discovery
    console.log(`[orchestrate] Step 1: Autonomous PDF Discovery...`);
    job.status = "discovering";

    const discoverResponse = await fetch(`${baseUrl}/functions/v1/firecrawl-discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_numbers: fileNumbers,
        search_terms: searchTerms,
        limit: pdfLimit,
      }),
    });

    if (!discoverResponse.ok) {
      throw new Error(`Discovery failed: ${await discoverResponse.text()}`);
    }

    const discoverResult = await discoverResponse.json();
    job.discovered_pdfs = discoverResult.data?.discovered_pdfs || [];
    console.log(`[orchestrate] Discovered ${job.discovered_pdfs.length} PDFs`);

    if (job.discovered_pdfs.length === 0) {
      job.status = "completed";
      job.completed_at = new Date().toISOString();
      return createResponse<PipelineResponse>(
        {
          job,
          message: "Pipeline complete. No PDFs found to process.",
        },
        null,
        startTime
      );
    }

    // Step 2: Parse each PDF
    console.log(`[orchestrate] Step 2: Parsing PDFs...`);
    job.status = "parsing";

    const allChunks: Array<{
      text: string;
      embedding?: number[];
      file_number: string;
      source_url: string;
      page_number: number;
      bbox: { left: number; top: number; width: number; height: number };
      chunk_index: number;
      metadata?: Record<string, unknown>;
    }> = [];

    for (const pdf of job.discovered_pdfs) {
      console.log(`[orchestrate] Parsing: ${pdf.url}`);

      const parseResponse = await fetch(`${baseUrl}/functions/v1/reducto-parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdf_url: pdf.url,
          file_number: pdf.file_number,
        }),
      });

      if (!parseResponse.ok) {
        console.error(`[orchestrate] Parse failed for ${pdf.url}: ${await parseResponse.text()}`);
        continue;
      }

      const parseResult = await parseResponse.json();
      const chunks = parseResult.data?.chunks || [];

      for (const chunk of chunks) {
        allChunks.push({
          text: chunk.text,
          file_number: pdf.file_number,
          source_url: pdf.url,
          page_number: chunk.page_number,
          bbox: chunk.bbox,
          chunk_index: chunk.chunk_index,
          metadata: {
            ...chunk.metadata,
            discovered_at: pdf.discovered_at,
            parsed_at: parseResult.data?.parsed_at,
          },
        });
      }

      job.parsed_chunks = allChunks.length;
    }

    console.log(`[orchestrate] Parsed ${allChunks.length} total chunks`);

    if (allChunks.length === 0) {
      job.status = "completed";
      job.completed_at = new Date().toISOString();
      return createResponse<PipelineResponse>(
        {
          job,
          message: "Pipeline complete. No chunks extracted from PDFs.",
        },
        null,
        startTime
      );
    }

    // Step 3: Generate embeddings
    console.log(`[orchestrate] Step 3: Generating embeddings...`);
    job.status = "embedding";

    // Group chunks by source for batch embedding
    const chunksBySource = new Map<string, typeof allChunks>();
    for (const chunk of allChunks) {
      const key = `${chunk.file_number}:${chunk.source_url}`;
      if (!chunksBySource.has(key)) {
        chunksBySource.set(key, []);
      }
      chunksBySource.get(key)!.push(chunk);
    }

    const embeddedChunks: typeof allChunks = [];

    for (const [key, chunks] of chunksBySource) {
      const [fileNumber, ...sourceUrlParts] = key.split(":");
      const sourceUrl = sourceUrlParts.join(":"); // Rejoin in case URL has colons
      console.log(`[orchestrate] Embedding ${chunks.length} chunks from ${sourceUrl}`);

      const embedResponse = await fetch(`${baseUrl}/functions/v1/voyage-embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chunks: chunks.map((c) => ({
            text: c.text,
            page_number: c.page_number,
            bbox: c.bbox,
            chunk_index: c.chunk_index,
            metadata: c.metadata,
          })),
          file_number: fileNumber,
          source_url: sourceUrl,
        }),
      });

      if (!embedResponse.ok) {
        console.error(`[orchestrate] Embedding failed: ${await embedResponse.text()}`);
        continue;
      }

      const embedResult = await embedResponse.json();
      const embedded = embedResult.data?.chunks || [];

      for (const chunk of embedded) {
        embeddedChunks.push({
          ...chunk,
          embedding: chunk.embedding,
        });
      }

      job.embedded_chunks = embeddedChunks.length;
    }

    console.log(`[orchestrate] Generated ${embeddedChunks.length} embeddings`);

    // Step 4: Upsert to MongoDB
    console.log(`[orchestrate] Step 4: Upserting to MongoDB...`);
    job.status = "upserting";

    const upsertResponse = await fetch(`${baseUrl}/functions/v1/mongo-upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert",
        documents: embeddedChunks,
      }),
    });

    if (!upsertResponse.ok) {
      throw new Error(`Upsert failed: ${await upsertResponse.text()}`);
    }

    const upsertResult = await upsertResponse.json();
    job.upserted_chunks = upsertResult.data?.upserted_count || 0;

    // Complete
    job.status = "completed";
    job.completed_at = new Date().toISOString();

    console.log(`[orchestrate] Pipeline complete. Upserted ${job.upserted_chunks} chunks.`);

    return createResponse<PipelineResponse>(
      {
        job,
        message: `Pipeline complete! Processed ${job.discovered_pdfs.length} PDFs, ${job.upserted_chunks} chunks stored.`,
      },
      null,
      startTime
    );
  } catch (error) {
    job.status = "failed";
    job.error = (error as Error).message;
    job.completed_at = new Date().toISOString();

    return createResponse<PipelineResponse>(
      { job },
      (error as Error).message,
      startTime
    );
  }
}

/**
 * Run vector search
 */
async function runSearch(
  request: PipelineRequest,
  supabaseUrl: string,
  startTime: number
): Promise<Response> {
  if (!request.query) {
    return createResponse(null, "Missing query", startTime);
  }

  const VOYAGE_API_KEY = getRequiredEnv("VOYAGE_API_KEY");
  const baseUrl = supabaseUrl.replace(/\/$/, "");

  // First, generate query embedding
  console.log(`[orchestrate] Generating query embedding for: ${request.query}`);

  const embedResponse = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [request.query],
      model: "voyage-law-2",
      input_type: "query",
    }),
  });

  if (!embedResponse.ok) {
    throw new Error(`Query embedding failed: ${await embedResponse.text()}`);
  }

  const embedResult = await embedResponse.json();
  const queryEmbedding = embedResult.data[0].embedding;

  // Search MongoDB
  const searchResponse = await fetch(`${baseUrl}/functions/v1/mongo-upsert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "search",
      query_embedding: queryEmbedding,
      file_numbers: request.file_numbers,
      limit: request.limit || 10,
      min_score: request.min_score || 0.7,
    }),
  });

  if (!searchResponse.ok) {
    throw new Error(`Search failed: ${await searchResponse.text()}`);
  }

  const searchResult = await searchResponse.json();

  return createResponse<PipelineResponse>(
    {
      search_results: searchResult.data?.results || [],
      message: `Found ${searchResult.data?.total_found || 0} results`,
    },
    null,
    startTime
  );
}
