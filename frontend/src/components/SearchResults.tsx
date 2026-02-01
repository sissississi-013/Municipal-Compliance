// =============================================================================
// Search Results Component
// =============================================================================
// Displays search results with "View Source" buttons that open the PDF viewer
// and highlight the relevant bounding box.
// =============================================================================

import { FileText, ExternalLink, Hash, BookOpen } from "lucide-react";
import type { SearchResult } from "../types";

interface SearchResultsProps {
  results: SearchResult[];
  isLoading: boolean;
  processingTime: number | null;
  onViewSource: (result: SearchResult) => void;
}

export function SearchResults({
  results,
  isLoading,
  processingTime,
  onViewSource,
}: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500">Searching zoning documents...</p>
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Results Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          {results.length} Result{results.length !== 1 ? "s" : ""} Found
        </h2>
        {processingTime && (
          <span className="text-sm text-gray-500">
            {processingTime}ms
          </span>
        )}
      </div>

      {/* Results List */}
      <div className="space-y-3">
        {results.map((result, index) => (
          <SearchResultCard
            key={result._id || index}
            result={result}
            rank={index + 1}
            onViewSource={() => onViewSource(result)}
          />
        ))}
      </div>
    </div>
  );
}

interface SearchResultCardProps {
  result: SearchResult;
  rank: number;
  onViewSource: () => void;
}

function SearchResultCard({ result, rank, onViewSource }: SearchResultCardProps) {
  const scorePercent = Math.round(result.score * 100);
  const scoreColor =
    scorePercent >= 90
      ? "text-green-600 bg-green-50"
      : scorePercent >= 80
      ? "text-yellow-600 bg-yellow-50"
      : "text-orange-600 bg-orange-50";

  // Truncate text for display
  const displayText =
    result.text.length > 300
      ? result.text.substring(0, 300) + "..."
      : result.text;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="p-4">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 text-xs font-medium text-gray-500 bg-gray-100 rounded-full">
              {rank}
            </span>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary-700 bg-primary-50 rounded">
                <Hash size={12} />
                {result.file_number}
              </span>
              {result.metadata?.section && (
                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded">
                  <BookOpen size={12} />
                  {result.metadata.section}
                </span>
              )}
              {result.metadata?.table_detected && (
                <span className="px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 rounded">
                  Table
                </span>
              )}
            </div>
          </div>
          <span
            className={`px-2 py-1 text-xs font-semibold rounded ${scoreColor}`}
          >
            {scorePercent}% match
          </span>
        </div>

        {/* Text Content */}
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          {displayText}
        </p>

        {/* Footer Row */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <FileText size={14} />
              Page {result.page_number}
            </span>
          </div>

          <button
            onClick={onViewSource}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors"
          >
            <ExternalLink size={14} />
            View Source
          </button>
        </div>
      </div>
    </div>
  );
}

export default SearchResults;
