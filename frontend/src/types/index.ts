// =============================================================================
// Frontend Types for SF Zoning Compliance
// =============================================================================

export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SearchResult {
  _id: string;
  text: string;
  file_number: string;
  source_url: string;
  page_number: number;
  bbox: BoundingBox;
  chunk_index: number;
  score: number;
  metadata?: {
    section?: string;
    table_detected?: boolean;
    discovered_at?: string;
    parsed_at?: string;
    embedded_at?: string;
  };
}

export interface SearchResponse {
  success: boolean;
  data?: {
    search_results: SearchResult[];
    message: string;
  };
  error?: string;
  metadata?: {
    processing_time_ms: number;
    timestamp: string;
  };
}

export interface PipelineJob {
  job_id: string;
  status:
    | "pending"
    | "discovering"
    | "parsing"
    | "embedding"
    | "upserting"
    | "completed"
    | "failed";
  file_numbers: string[];
  discovered_pdfs: Array<{
    url: string;
    title: string;
    file_number: string;
    attachment_type: string;
  }>;
  parsed_chunks: number;
  embedded_chunks: number;
  upserted_chunks: number;
  started_at: string;
  completed_at?: string;
  error?: string;
}

export interface PipelineResponse {
  success: boolean;
  data?: {
    job: PipelineJob;
    message: string;
  };
  error?: string;
}

export interface PDFViewerProps {
  url: string;
  pageNumber: number;
  highlights: Array<{
    bbox: BoundingBox;
    id: string;
    active?: boolean;
  }>;
  onHighlightClick?: (id: string) => void;
}
