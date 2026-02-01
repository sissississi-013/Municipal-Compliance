// =============================================================================
// PDF Viewer Component with Bounding Box Highlighting
// =============================================================================
// Displays PDF documents with overlay highlights based on bbox coordinates
// from Reducto parsing. Supports "View Source" functionality.
// =============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { BoundingBox } from "../types";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface Highlight {
  id: string;
  bbox: BoundingBox;
  active?: boolean;
}

interface PDFViewerProps {
  url: string;
  initialPage?: number;
  highlights?: Highlight[];
  activeHighlightId?: string;
  onClose?: () => void;
}

export function PDFViewer({
  url,
  initialPage = 1,
  highlights = [],
  activeHighlightId,
  onClose,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [scale, setScale] = useState(1.0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Update page when initialPage changes
  useEffect(() => {
    setPageNumber(initialPage);
  }, [initialPage]);

  // Scroll to active highlight
  useEffect(() => {
    if (activeHighlightId && containerRef.current) {
      const highlightEl = containerRef.current.querySelector(
        `[data-highlight-id="${activeHighlightId}"]`
      );
      if (highlightEl) {
        highlightEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [activeHighlightId, pageNumber]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages);
    },
    []
  );

  const onPageLoadSuccess = useCallback(
    ({ width, height }: { width: number; height: number }) => {
      setPageSize({ width, height });
    },
    []
  );

  const goToPreviousPage = () => {
    setPageNumber((prev) => Math.max(prev - 1, 1));
  };

  const goToNextPage = () => {
    setPageNumber((prev) => Math.min(prev + 1, numPages || prev));
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3.0));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  // Filter highlights for current page
  const pageHighlights = highlights.filter(() => {
    // Highlights don't have page info in bbox, so show all on current page
    // In a real implementation, you'd filter by page number from the search result
    return true;
  });

  // Convert bbox coordinates to CSS position
  // PDF coordinates: origin at bottom-left, in points (72 per inch)
  // Screen coordinates: origin at top-left, in pixels
  const bboxToStyle = (bbox: BoundingBox) => {
    // Scale factor from PDF points to rendered pixels
    const scaleFactor = scale;

    // PDF pages are typically 612x792 points (8.5x11 inches at 72 dpi)
    const pdfWidth = 612;
    const pdfHeight = 792;

    // Convert from PDF coordinates to screen coordinates
    // Note: PDF y-axis is inverted (0 at bottom)
    const left = (bbox.left / pdfWidth) * pageSize.width * scaleFactor;
    const top =
      ((pdfHeight - bbox.top - bbox.height) / pdfHeight) *
      pageSize.height *
      scaleFactor;
    const width = (bbox.width / pdfWidth) * pageSize.width * scaleFactor;
    const height = (bbox.height / pdfHeight) * pageSize.height * scaleFactor;

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousPage}
            disabled={pageNumber <= 1}
            className="p-2 text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Previous page"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-sm text-gray-300">
            Page {pageNumber} of {numPages || "..."}
          </span>
          <button
            onClick={goToNextPage}
            disabled={pageNumber >= (numPages || 1)}
            className="p-2 text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Next page"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            className="p-2 text-gray-300 hover:text-white"
            aria-label="Zoom out"
          >
            <ZoomOut size={20} />
          </button>
          <span className="text-sm text-gray-300 min-w-[60px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            className="p-2 text-gray-300 hover:text-white"
            aria-label="Zoom in"
          >
            <ZoomIn size={20} />
          </button>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="p-2 text-gray-300 hover:text-white"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* PDF Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex justify-center p-4"
      >
        <div className="relative">
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex items-center justify-center h-96 text-gray-400">
                Loading PDF...
              </div>
            }
            error={
              <div className="flex items-center justify-center h-96 text-red-400">
                Failed to load PDF. Check if the URL is accessible.
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              onLoadSuccess={onPageLoadSuccess}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>

          {/* Highlight Overlays */}
          {pageSize.width > 0 &&
            pageHighlights.map((highlight) => (
              <div
                key={highlight.id}
                data-highlight-id={highlight.id}
                className={`pdf-highlight ${
                  highlight.id === activeHighlightId ? "active" : ""
                }`}
                style={bboxToStyle(highlight.bbox)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

export default PDFViewer;
