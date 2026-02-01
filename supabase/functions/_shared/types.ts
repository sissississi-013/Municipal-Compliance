// =============================================================================
// Shared Types for SF Zoning Compliance Automation
// =============================================================================

// -----------------------------------------------------------------------------
// Firecrawl Types
// -----------------------------------------------------------------------------
export interface FirecrawlDiscoveryResult {
  url: string;
  title: string;
  file_number: string;
  attachment_type: string;
  discovered_at: string;
  metadata: {
    legistar_id?: string;
    meeting_date?: string;
    action?: string;
  };
}

export interface FirecrawlAgentRequest {
  url: string;
  prompt: string;
  model?: string;
  maxCredits?: number;
}

// -----------------------------------------------------------------------------
// Reducto Types
// -----------------------------------------------------------------------------
export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ReductoChunk {
  text: string;
  page_number: number;
  bbox: BoundingBox;
  chunk_index: number;
  metadata: {
    section?: string;
    table_detected?: boolean;
    confidence?: number;
  };
}

export interface ReductoParseResult {
  source_url: string;
  file_number: string;
  total_pages: number;
  chunks: ReductoChunk[];
  parsed_at: string;
}

// -----------------------------------------------------------------------------
// Voyage AI Types
// -----------------------------------------------------------------------------
export interface VoyageEmbeddingRequest {
  input: string[];
  model: string;
  input_type?: "document" | "query";
}

export interface VoyageEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

// -----------------------------------------------------------------------------
// MongoDB Document Types
// -----------------------------------------------------------------------------
export interface ZoningDocument {
  _id?: string;
  text: string;
  embedding: number[];
  file_number: string;
  source_url: string;
  page_number: number;
  bbox: BoundingBox;
  chunk_index: number;
  metadata: {
    section?: string;
    table_detected?: boolean;
    discovered_at: string;
    parsed_at: string;
    embedded_at: string;
  };
}

export interface VectorSearchQuery {
  query_text: string;
  file_numbers?: string[];
  limit?: number;
  min_score?: number;
}

export interface VectorSearchResult {
  document: ZoningDocument;
  score: number;
}

// -----------------------------------------------------------------------------
// Orchestration Types
// -----------------------------------------------------------------------------
export interface PipelineJob {
  job_id: string;
  status: "pending" | "discovering" | "parsing" | "embedding" | "upserting" | "completed" | "failed";
  file_numbers: string[];
  discovered_pdfs: FirecrawlDiscoveryResult[];
  parsed_chunks: number;
  embedded_chunks: number;
  upserted_chunks: number;
  started_at: string;
  completed_at?: string;
  error?: string;
}

// -----------------------------------------------------------------------------
// API Response Types
// -----------------------------------------------------------------------------
export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    processing_time_ms: number;
    timestamp: string;
  };
}
