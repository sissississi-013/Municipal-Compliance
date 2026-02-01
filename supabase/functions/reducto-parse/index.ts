// =============================================================================
// Reducto PDF Parsing Edge Function
// =============================================================================
// Uses Reducto's pipeline API for layout-aware parsing with agentic enhancement
// Pipeline ID: k9733pyz0cwnsq8cjfnfvcd8wn808r22
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ReductoChunk, ReductoParseResult, BoundingBox } from "../_shared/types.ts";
import { createResponse, handleCors, getRequiredEnv, retryWithBackoff } from "../_shared/utils.ts";

// Your Reducto Pipeline ID
const PIPELINE_ID = "k976v77hd0bnc5sve8860njccs808hrz";

interface ParseRequest {
  pdf_url: string;
  file_number: string;
}

// Reducto Pipeline API response structure (flexible to handle different formats)
interface ReductoPipelineResponse {
  job_id: string;
  status: string;
  usage?: {
    pages_processed: number;
    credits_used: number;
  };
  result?: {
    chunks?: Array<{
      content: string;
      blocks?: Array<{
        type: string;
        content: string;
        bbox?: {
          left: number;
          top: number;
          width: number;
          height: number;
          page: number;
        };
      }>;
    }>;
    // Alternative format: direct blocks array
    blocks?: Array<{
      type: string;
      content: string;
      bbox?: {
        left: number;
        top: number;
        width: number;
        height: number;
        page: number;
      };
    }>;
    // Alternative: markdown or text output
    markdown?: string;
    text?: string;
  };
  // Some pipelines return data at top level
  chunks?: Array<Record<string, unknown>>;
  blocks?: Array<Record<string, unknown>>;
  markdown?: string;
  text?: string;
  studio_link?: string;
  error?: string;
}

serve(async (req: Request) => {
  const startTime = Date.now();

  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const REDUCTO_API_KEY = getRequiredEnv("REDUCTO_API_KEY");

    // Parse request
    if (req.method !== "POST") {
      return createResponse(null, "Method not allowed. Use POST.", startTime);
    }

    const body: ParseRequest = await req.json();

    if (!body.pdf_url) {
      return createResponse(null, "Missing required field: pdf_url", startTime);
    }

    const { pdf_url, file_number } = body;

    console.log(`[reducto-parse] Starting parse for: ${pdf_url}`);
    console.log(`[reducto-parse] File number: ${file_number}`);
    console.log(`[reducto-parse] Using pipeline: ${PIPELINE_ID}`);

    // Call Reducto Parse API
    const pipelineResponse = await retryWithBackoff(async () => {
      const response = await fetch("https://platform.reducto.ai/parse", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${REDUCTO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document_url: pdf_url,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Reducto API error: ${response.status} - ${errorText}`);
      }

      return response.json() as Promise<ReductoPipelineResponse>;
    });

    if (pipelineResponse.error) {
      throw new Error(`Reducto pipeline failed: ${pipelineResponse.error}`);
    }

    console.log(`[reducto-parse] Job ID: ${pipelineResponse.job_id}`);
    console.log(`[reducto-parse] Full response:`, JSON.stringify(pipelineResponse).substring(0, 2000));
    if (pipelineResponse.studio_link) {
      console.log(`[reducto-parse] Studio link: ${pipelineResponse.studio_link}`);
    }

    // Transform Reducto response to our chunk format
    const chunks = transformPipelineResponse(
      pipelineResponse,
      pdf_url,
      file_number
    );

    const totalPages = pipelineResponse.usage?.pages_processed ||
      Math.max(...chunks.map(c => c.page_number), 1);

    console.log(`[reducto-parse] Extracted ${chunks.length} chunks from ${totalPages} pages`);

    const result: ReductoParseResult = {
      source_url: pdf_url,
      file_number: file_number,
      total_pages: totalPages,
      chunks: chunks,
      parsed_at: new Date().toISOString(),
    };

    return createResponse(result, null, startTime);
  } catch (error) {
    console.error(`[reducto-parse] Error:`, error);
    return createResponse(null, (error as Error).message, startTime);
  }
});

/**
 * Transform Reducto Pipeline response to our standardized chunk format
 * Handles multiple possible response formats
 */
function transformPipelineResponse(
  response: ReductoPipelineResponse,
  sourceUrl: string,
  fileNumber: string
): ReductoChunk[] {
  const chunks: ReductoChunk[] = [];
  let chunkIndex = 0;

  // Try different response formats

  // Format 1: result.chunks[].blocks[]
  if (response.result?.chunks && response.result.chunks.length > 0) {
    console.log(`[reducto-parse] Using format: result.chunks`);
    for (const chunk of response.result.chunks) {
      for (const block of chunk.blocks || []) {
        chunks.push(createChunkFromBlock(block, chunkIndex++));
      }
      // Include chunk content if no blocks
      if (chunk.content && (!chunk.blocks || chunk.blocks.length === 0)) {
        chunks.push(createChunkFromText(chunk.content, chunkIndex++));
      }
    }
  }

  // Format 2: result.blocks[] (direct blocks array)
  else if (response.result?.blocks && response.result.blocks.length > 0) {
    console.log(`[reducto-parse] Using format: result.blocks`);
    for (const block of response.result.blocks) {
      chunks.push(createChunkFromBlock(block, chunkIndex++));
    }
  }

  // Format 3: Top-level chunks or blocks
  else if (response.chunks && Array.isArray(response.chunks)) {
    console.log(`[reducto-parse] Using format: top-level chunks`);
    for (const chunk of response.chunks) {
      const text = (chunk as Record<string, unknown>).content ||
                   (chunk as Record<string, unknown>).text ||
                   JSON.stringify(chunk);
      chunks.push(createChunkFromText(String(text), chunkIndex++));
    }
  }

  // Format 4: Markdown or text output
  else if (response.result?.markdown || response.result?.text || response.markdown || response.text) {
    const text = response.result?.markdown || response.result?.text || response.markdown || response.text || "";
    console.log(`[reducto-parse] Using format: markdown/text (${text.length} chars)`);
    // Split into reasonable chunks
    const paragraphs = text.split(/\n\n+/);
    for (const para of paragraphs) {
      if (para.trim().length > 10) {
        chunks.push(createChunkFromText(para.trim(), chunkIndex++));
      }
    }
  }

  else {
    console.warn(`[reducto-parse] No recognized data format in response`);
  }

  return chunks;
}

function createChunkFromBlock(block: Record<string, unknown>, index: number): ReductoChunk {
  const bboxData = block.bbox as Record<string, number> | undefined;
  const bbox: BoundingBox = bboxData
    ? {
        left: bboxData.left || 0,
        top: bboxData.top || 0,
        width: bboxData.width || 612,
        height: bboxData.height || 792,
      }
    : { left: 0, top: 0, width: 612, height: 792 };

  const content = String(block.content || block.text || "");
  const pageNumber = bboxData?.page || 1;

  return {
    text: cleanText(content),
    page_number: pageNumber,
    bbox: bbox,
    chunk_index: index,
    metadata: {
      section: detectSection(content),
      table_detected: block.type === "table" || detectTableContent(content),
    },
  };
}

function createChunkFromText(text: string, index: number): ReductoChunk {
  return {
    text: cleanText(text),
    page_number: 1,
    bbox: { left: 0, top: 0, width: 612, height: 792 },
    chunk_index: index,
    metadata: {
      section: detectSection(text),
      table_detected: detectTableContent(text),
    },
  };
}

/**
 * Detect section headers from content
 */
function detectSection(content: string): string | undefined {
  // Common EIR section patterns
  const sectionPatterns = [
    { pattern: /(?:SECTION|CHAPTER)\s*(\d+[.\d]*)\s*[-:.]?\s*(.+)/i, group: 2 },
    { pattern: /^(\d+[.\d]*)\s+([A-Z][A-Z\s]+)$/m, group: 2 },
    { pattern: /^(EXECUTIVE SUMMARY|INTRODUCTION|BACKGROUND|ENVIRONMENTAL SETTING)/im, group: 1 },
    { pattern: /^(NOISE|WIND|SHADOW|TRANSPORTATION|AIR QUALITY|AESTHETICS)/im, group: 1 },
    { pattern: /^(GEOTECHNICAL|HAZARDS|HYDROLOGY|UTILITIES)/im, group: 1 },
    { pattern: /^(ALTERNATIVES|MITIGATION|CUMULATIVE IMPACTS)/im, group: 1 },
    { pattern: /^(RTO-C|RESIDENTIAL|ZONING|LAND USE)/im, group: 1 },
  ];

  for (const { pattern, group } of sectionPatterns) {
    const match = content.match(pattern);
    if (match && match[group]) {
      return match[group].trim();
    }
  }

  return undefined;
}

/**
 * Detect if content contains table data
 */
function detectTableContent(content: string): boolean {
  const tableIndicators = [
    /\|.*\|.*\|/,           // Pipe-delimited
    /\t.*\t.*\t/,           // Tab-delimited
    /^\s*\d+\s+\d+\s+\d+/m, // Numeric columns
    /dB[A]?\s*$/m,          // Decibel measurements (noise studies)
    /mph\s*$/m,             // Wind speed measurements
    /feet\s+\d+/i,          // Distance measurements
  ];

  return tableIndicators.some((pattern) => pattern.test(content));
}

/**
 * Clean and normalize text content
 */
function cleanText(content: string): string {
  return content
    .replace(/\s+/g, " ")
    .replace(/Page\s+\d+\s+of\s+\d+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
