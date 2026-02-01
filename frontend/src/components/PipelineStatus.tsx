// =============================================================================
// Pipeline Status Component
// =============================================================================
// Shows progress of the discovery -> parse -> embed -> upsert pipeline
// =============================================================================

import {
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  Search,
  FileText,
  Cpu,
  Database,
} from "lucide-react";
import type { PipelineJob } from "../types";

interface PipelineStatusProps {
  job: PipelineJob | null;
  isRunning: boolean;
  error: Error | null;
  onStart: () => void;
  onDismiss: () => void;
}

const STATUS_STEPS = [
  { key: "discovering", label: "Discovery", icon: Search },
  { key: "parsing", label: "Parsing", icon: FileText },
  { key: "embedding", label: "Embedding", icon: Cpu },
  { key: "upserting", label: "Storage", icon: Database },
] as const;

export function PipelineStatus({
  job,
  isRunning,
  error,
  onStart,
  onDismiss,
}: PipelineStatusProps) {
  // Not started state
  if (!job && !isRunning && !error) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-900">Document Pipeline</h3>
            <p className="text-sm text-gray-500 mt-1">
              Discover and process PDFs from SF Board of Supervisors Files
              #250700 & #250701
            </p>
          </div>
          <button
            onClick={onStart}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
          >
            Run Pipeline
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-medium text-red-800">Pipeline Error</h3>
            <p className="text-sm text-red-600 mt-1">{error.message}</p>
          </div>
          <button
            onClick={onDismiss}
            className="text-sm text-red-600 hover:text-red-800"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (!job) return null;

  const currentStepIndex = STATUS_STEPS.findIndex(
    (step) => step.key === job.status
  );
  const isComplete = job.status === "completed";
  const isFailed = job.status === "failed";

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : isFailed ? (
            <AlertCircle className="w-5 h-5 text-red-500" />
          ) : (
            <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
          )}
          <h3 className="font-medium text-gray-900">
            {isComplete
              ? "Pipeline Complete"
              : isFailed
              ? "Pipeline Failed"
              : "Running Pipeline..."}
          </h3>
        </div>
        {(isComplete || isFailed) && (
          <button
            onClick={onDismiss}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-4">
        {STATUS_STEPS.map((step, index) => {
          const Icon = step.icon;
          const isPast = index < currentStepIndex || isComplete;
          const isCurrent = index === currentStepIndex && !isComplete;

          return (
            <div key={step.key} className="flex items-center">
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                  isPast
                    ? "bg-green-100 text-green-700"
                    : isCurrent
                    ? "bg-primary-100 text-primary-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {isPast ? (
                  <CheckCircle size={14} />
                ) : isCurrent ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Icon size={14} />
                )}
                {step.label}
              </div>
              {index < STATUS_STEPS.length - 1 && (
                <div
                  className={`w-4 h-0.5 mx-1 ${
                    isPast ? "bg-green-300" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-gray-900">
            {job.discovered_pdfs.length}
          </div>
          <div className="text-xs text-gray-500">PDFs Found</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">
            {job.parsed_chunks.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Chunks Parsed</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">
            {job.embedded_chunks.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Embeddings</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">
            {job.upserted_chunks.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Stored</div>
        </div>
      </div>

      {/* Timing */}
      {(job.started_at || job.completed_at) && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            Started: {new Date(job.started_at).toLocaleTimeString()}
          </span>
          {job.completed_at && (
            <span>
              Completed: {new Date(job.completed_at).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Error Message */}
      {job.error && (
        <div className="mt-4 p-3 bg-red-50 rounded-lg text-sm text-red-600">
          {job.error}
        </div>
      )}

      {/* Timeout Warning - when PDFs found but 0 chunks parsed */}
      {isComplete && job.discovered_pdfs.length > 0 && job.parsed_chunks === 0 && !job.error && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800">PDF Processing Timeout</p>
              <p className="text-amber-700 mt-1">
                The PDF parser (Reducto) takes 2-3 minutes per document, but Edge Functions timeout after ~60 seconds.
                A local processing job is running in the background. Once complete, use the search bar above to query the documents.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PipelineStatus;
