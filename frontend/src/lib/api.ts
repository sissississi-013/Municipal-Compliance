// =============================================================================
// API Client for SF Zoning Compliance Backend
// =============================================================================

import type { SearchResponse, PipelineResponse, PipelineJob } from "../types";

// Get API URL from environment or use default
const API_BASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "http://localhost:54321/functions/v1";

interface APIOptions {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
}

async function apiRequest<T>(
  endpoint: string,
  options: APIOptions = {}
): Promise<T> {
  const { method = "POST", body } = options;

  const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// =============================================================================
// Search API
// =============================================================================

export async function searchDocuments(
  query: string,
  options: {
    fileNumbers?: string[];
    limit?: number;
    minScore?: number;
  } = {}
): Promise<SearchResponse> {
  const { fileNumbers, limit = 10, minScore = 0.5 } = options;

  console.log("[API] searchDocuments called with:", { query, fileNumbers, limit, minScore });
  console.log("[API] API_BASE_URL:", API_BASE_URL);

  const result = await apiRequest<SearchResponse>("orchestrate", {
    body: {
      action: "search",
      query,
      file_numbers: fileNumbers,
      limit,
      min_score: minScore,
    },
  });

  console.log("[API] searchDocuments result:", result);
  return result;
}

// =============================================================================
// Pipeline API
// =============================================================================

export async function runPipeline(
  searchTerms?: string[],
  pdfLimit: number = 2  // Limit to avoid timeouts
): Promise<PipelineResponse> {
  return apiRequest<PipelineResponse>("orchestrate", {
    body: {
      action: "run_pipeline",
      search_terms: searchTerms || ["housing", "zoning", "EIR", "CEQA"],
      pdf_limit: pdfLimit,
    },
  });
}

export async function checkPipelineStatus(
  jobId: string
): Promise<PipelineResponse> {
  return apiRequest<PipelineResponse>("orchestrate", {
    body: {
      action: "check_status",
      job_id: jobId,
    },
  });
}

// =============================================================================
// Helper: Poll pipeline until completion
// =============================================================================

export async function pollPipelineUntilComplete(
  jobId: string,
  onUpdate?: (job: PipelineJob) => void,
  pollInterval: number = 2000
): Promise<PipelineJob> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await checkPipelineStatus(jobId);

        if (!response.success || !response.data?.job) {
          reject(new Error(response.error || "Failed to get job status"));
          return;
        }

        const job = response.data.job;
        onUpdate?.(job);

        if (job.status === "completed") {
          resolve(job);
          return;
        }

        if (job.status === "failed") {
          reject(new Error(job.error || "Pipeline failed"));
          return;
        }

        // Continue polling
        setTimeout(poll, pollInterval);
      } catch (error) {
        reject(error);
      }
    };

    poll();
  });
}
