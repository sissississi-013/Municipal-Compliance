// =============================================================================
// Search Hook for SF Zoning Compliance - SIMPLIFIED
// =============================================================================

import { useState, useCallback } from "react";
import { searchDocuments } from "../lib/api";
import type { SearchResult } from "../types";

interface UseSearchOptions {
  fileNumbers?: string[];
  limit?: number;
  minScore?: number;
}

interface UseSearchReturn {
  results: SearchResult[];
  isLoading: boolean;
  error: Error | null;
  search: (query: string) => void;
  clearResults: () => void;
  processingTime: number | null;
}

export function useSearch(options: UseSearchOptions = {}): UseSearchReturn {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [processingTime, setProcessingTime] = useState<number | null>(null);

  const search = useCallback(
    async (query: string) => {
      if (!query.trim()) return;

      console.log("[useSearch] Starting search for:", query);
      setIsLoading(true);
      setError(null);

      try {
        const response = await searchDocuments(query, {
          fileNumbers: options.fileNumbers,
          limit: options.limit,
          minScore: options.minScore,
        });

        console.log("[useSearch] Got response:", response);

        if (!response.success) {
          throw new Error(response.error || "Search failed");
        }

        // Map from API format {document: {...}, score} to flat format
        const rawResults = response.data?.search_results || [];
        console.log("[useSearch] Raw results:", rawResults);

        const mappedResults = rawResults.map((r: any) => {
          if (r.document) {
            return { ...r.document, score: r.score ?? 0 };
          }
          return r;
        });

        console.log("[useSearch] Mapped results:", mappedResults);
        setResults(mappedResults);
        setProcessingTime(response.metadata?.processing_time_ms || null);
      } catch (err) {
        console.error("[useSearch] Error:", err);
        setError(err as Error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [options.fileNumbers, options.limit, options.minScore]
  );

  const clearResults = useCallback(() => {
    setResults([]);
    setProcessingTime(null);
    setError(null);
  }, []);

  return {
    results,
    isLoading,
    error,
    search,
    clearResults,
    processingTime,
  };
}
