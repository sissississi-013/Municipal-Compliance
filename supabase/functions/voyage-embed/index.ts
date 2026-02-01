// =============================================================================
// Voyage AI Embedding Generation Edge Function
// =============================================================================
// Uses voyage-law-2 model for legal-domain optimized embeddings
// with 16k context window for comprehensive zoning document coverage
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ReductoChunk, VoyageEmbeddingResponse } from "../_shared/types.ts";
import { createResponse, handleCors, getRequiredEnv, retryWithBackoff, chunkArray } from "../_shared/utils.ts";

interface EmbedRequest {
  chunks: ReductoChunk[];
  file_number: string;
  source_url: string;
  input_type?: "document" | "query";
}

interface EmbeddedChunk extends ReductoChunk {
  embedding: number[];
  file_number: string;
  source_url: string;
}

interface EmbedResponse {
  chunks: EmbeddedChunk[];
  total_tokens: number;
  model: string;
}

// Voyage API limits
const VOYAGE_BATCH_SIZE = 128; // Max texts per request
const VOYAGE_MODEL = "voyage-law-2";

serve(async (req: Request) => {
  const startTime = Date.now();

  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const VOYAGE_API_KEY = getRequiredEnv("VOYAGE_API_KEY");

    // Parse request
    if (req.method !== "POST") {
      return createResponse(null, "Method not allowed. Use POST.", startTime);
    }

    const body: EmbedRequest = await req.json();

    if (!body.chunks || !Array.isArray(body.chunks) || body.chunks.length === 0) {
      return createResponse(null, "Missing or empty chunks array", startTime);
    }

    const { chunks, file_number, source_url, input_type = "document" } = body;

    console.log(`[voyage-embed] Generating embeddings for ${chunks.length} chunks`);
    console.log(`[voyage-embed] File: ${file_number}, Input type: ${input_type}`);

    // Batch chunks for API calls
    const batches = chunkArray(chunks, VOYAGE_BATCH_SIZE);
    const embeddedChunks: EmbeddedChunk[] = [];
    let totalTokens = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`[voyage-embed] Processing batch ${batchIndex + 1}/${batches.length}`);

      // Extract texts for embedding
      const texts = batch.map((chunk) => prepareTextForEmbedding(chunk));

      // Call Voyage AI API
      const voyageResponse = await retryWithBackoff(async () => {
        const response = await fetch("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${VOYAGE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: texts,
            model: VOYAGE_MODEL,
            input_type: input_type,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Voyage API error: ${response.status} - ${errorText}`);
        }

        return response.json() as Promise<VoyageEmbeddingResponse>;
      });

      // Map embeddings back to chunks
      for (const item of voyageResponse.data) {
        const originalChunk = batch[item.index];
        embeddedChunks.push({
          ...originalChunk,
          embedding: item.embedding,
          file_number: file_number,
          source_url: source_url,
        });
      }

      totalTokens += voyageResponse.usage.total_tokens;

      // Small delay between batches to avoid rate limits
      if (batchIndex < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(`[voyage-embed] Generated ${embeddedChunks.length} embeddings, total tokens: ${totalTokens}`);

    const result: EmbedResponse = {
      chunks: embeddedChunks,
      total_tokens: totalTokens,
      model: VOYAGE_MODEL,
    };

    return createResponse(result, null, startTime);
  } catch (error) {
    console.error(`[voyage-embed] Error:`, error);
    return createResponse(null, (error as Error).message, startTime);
  }
});

/**
 * Prepare text for embedding with context enhancement
 *
 * voyage-law-2 has a 16k context window, so we can include
 * rich context for better retrieval accuracy
 */
function prepareTextForEmbedding(chunk: ReductoChunk): string {
  const parts: string[] = [];

  // Add section context if available
  if (chunk.metadata.section) {
    parts.push(`[Section: ${chunk.metadata.section}]`);
  }

  // Add page context
  parts.push(`[Page ${chunk.page_number}]`);

  // Add table indicator if relevant
  if (chunk.metadata.table_detected) {
    parts.push("[Contains tabular data]");
  }

  // Add the main text content
  parts.push(chunk.text);

  return parts.join(" ");
}

// =============================================================================
// Query Embedding Endpoint
// =============================================================================
// Separate handler for generating query embeddings (different input_type)

export async function generateQueryEmbedding(
  query: string,
  apiKey: string
): Promise<number[]> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [enhanceQuery(query)],
      model: VOYAGE_MODEL,
      input_type: "query",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Voyage API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as VoyageEmbeddingResponse;
  return data.data[0].embedding;
}

/**
 * Enhance query with zoning-specific context
 *
 * This helps bridge the gap between natural language developer queries
 * and technical zoning terminology (e.g., "RTO-C" = Residential Transit Oriented-Commercial)
 */
function enhanceQuery(query: string): string {
  // Zoning terminology mappings
  const zoningTerms: Record<string, string> = {
    "rto": "RTO Residential Transit Oriented",
    "rto-c": "RTO-C Residential Transit Oriented Commercial",
    "rto-m": "RTO-M Residential Transit Oriented Mixed",
    "nc": "NC Neighborhood Commercial",
    "rm": "RM Residential Mixed",
    "rh": "RH Residential House",
    "c-3": "C-3 Downtown Commercial",
    "soma": "South of Market SOMA",
    "builder's remedy": "Builder's Remedy Housing Accountability Act HAA",
    "housing element": "Housing Element General Plan",
    "ceqa": "California Environmental Quality Act CEQA",
    "eir": "Environmental Impact Report EIR",
  };

  let enhancedQuery = query.toLowerCase();

  // Expand known terms
  for (const [term, expansion] of Object.entries(zoningTerms)) {
    if (enhancedQuery.includes(term)) {
      enhancedQuery = enhancedQuery.replace(
        new RegExp(`\\b${term}\\b`, "gi"),
        expansion
      );
    }
  }

  return enhancedQuery;
}
