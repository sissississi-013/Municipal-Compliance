// =============================================================================
// Pipeline Hook for SF Zoning Compliance
// =============================================================================

import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { runPipeline } from "../lib/api";
import type { PipelineJob } from "../types";

interface UsePipelineReturn {
  job: PipelineJob | null;
  isRunning: boolean;
  error: Error | null;
  startPipeline: (searchTerms?: string[], pdfLimit?: number) => void;
  clearJob: () => void;
}

export function usePipeline(): UsePipelineReturn {
  const [job, setJob] = useState<PipelineJob | null>(null);

  const mutation = useMutation({
    mutationFn: async ({
      searchTerms,
      pdfLimit,
    }: {
      searchTerms?: string[];
      pdfLimit?: number;
    }) => {
      // Pipeline now runs synchronously - wait for full completion
      const response = await runPipeline(searchTerms, pdfLimit);

      if (!response.success) {
        throw new Error(response.error || "Pipeline failed");
      }

      return response.data?.job || null;
    },
    onSuccess: (finalJob) => {
      setJob(finalJob);
    },
    onError: (error) => {
      // Create a failed job state for UI
      setJob({
        job_id: "error",
        status: "failed",
        file_numbers: [],
        discovered_pdfs: [],
        parsed_chunks: 0,
        embedded_chunks: 0,
        upserted_chunks: 0,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error: (error as Error).message,
      });
    },
  });

  const startPipeline = useCallback(
    (searchTerms?: string[], pdfLimit?: number) => {
      setJob({
        job_id: "running",
        status: "discovering",
        file_numbers: [],
        discovered_pdfs: [],
        parsed_chunks: 0,
        embedded_chunks: 0,
        upserted_chunks: 0,
        started_at: new Date().toISOString(),
      });
      mutation.mutate({ searchTerms, pdfLimit });
    },
    [mutation]
  );

  const clearJob = useCallback(() => {
    setJob(null);
  }, []);

  return {
    job,
    isRunning: mutation.isPending,
    error: mutation.error,
    startPipeline,
    clearJob,
  };
}
