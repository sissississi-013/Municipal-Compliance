import { useState } from "react";
import { Building2, FileSearch, Search, ExternalLink, Hash } from "lucide-react";

interface SearchResult {
  _id: string;
  text: string;
  file_number: string;
  source_url: string;
  page_number: number;
  score: number;
}

const API_URL = "https://xaexvwrnkmjvsypqndhd.supabase.co/functions/v1/orchestrate";

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "search",
          query: q,
          limit: 10,
          min_score: 0.5,
        }),
      });

      const data = await response.json();

      if (data.success && data.data?.search_results) {
        const mapped = data.data.search_results.map((r: any) => ({
          _id: r.document?._id || r._id,
          text: r.document?.text || r.text,
          file_number: r.document?.file_number || r.file_number,
          source_url: r.document?.source_url || r.source_url,
          page_number: r.document?.page_number || r.page_number,
          score: r.score,
        }));
        setResults(mapped);
      } else {
        setResults([]);
        if (data.error) setError(data.error);
      }
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">SF Zoning Compliance</h1>
              <p className="text-sm text-gray-500">Files #250700 & #250701 | 36,200 Housing Units</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Search Box */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <FileSearch className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Search Zoning Documents</h2>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Try: housing zoning, density bonus, height limits..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Search className="w-5 h-5" />
              )}
              Search
            </button>
          </form>

          {/* Quick search buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-xs text-gray-500">Try:</span>
            {["housing zoning", "density bonus", "height limits", "environmental impact"].map((tip) => (
              <button
                key={tip}
                onClick={() => { setQuery(tip); handleSearch(tip); }}
                className="px-2 py-1 text-xs text-blue-600 bg-blue-50 rounded hover:bg-blue-100"
              >
                {tip}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-600">
            {error}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">{results.length} Results Found</h3>
            {results.map((result, i) => (
              <div key={result._id || i} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 flex items-center justify-center bg-gray-100 rounded-full text-xs text-gray-600">
                      {i + 1}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded">
                      <Hash size={12} />
                      {result.file_number}
                    </span>
                  </div>
                  <span className="px-2 py-1 text-xs font-semibold text-orange-600 bg-orange-50 rounded">
                    {Math.round(result.score * 100)}% match
                  </span>
                </div>
                <p className="text-sm text-gray-700 mb-3">
                  {result.text.length > 300 ? result.text.substring(0, 300) + "..." : result.text}
                </p>
                <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-500">Page {result.page_number}</span>
                  <a
                    href={result.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                  >
                    <ExternalLink size={14} />
                    View PDF
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && results.length === 0 && !error && (
          <div className="text-center py-12 text-gray-500">
            <FileSearch className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>Enter a search query to find relevant zoning documents</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
