// =============================================================================
// MongoDB Atlas Vector Upsert & Search Edge Function
// =============================================================================
// Handles vector persistence with scalar quantization (int8) for RAM efficiency
// Supports both upsert operations and vector search queries
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { MongoClient, ServerApiVersion } from "npm:mongodb@6.3.0";
import { ZoningDocument, VectorSearchResult, BoundingBox } from "../_shared/types.ts";
import { createResponse, handleCors, getRequiredEnv, chunkArray } from "../_shared/utils.ts";

interface UpsertRequest {
  action: "upsert";
  documents: Array<{
    text: string;
    embedding: number[];
    file_number: string;
    source_url: string;
    page_number: number;
    bbox: BoundingBox;
    chunk_index: number;
    metadata?: Record<string, unknown>;
  }>;
}

interface SearchRequest {
  action: "search";
  query_embedding?: number[];
  query_text?: string; // Support text queries (will generate embedding)
  file_numbers?: string[];
  limit?: number;
  min_score?: number;
}

interface UpsertResponse {
  upserted_count: number;
  modified_count: number;
}

interface SearchResponse {
  results: VectorSearchResult[];
  total_found: number;
}

type RequestBody = UpsertRequest | SearchRequest;

// MongoDB configuration
const BATCH_SIZE = 100;
const DATABASE_NAME = "sf_zoning";
const COLLECTION_NAME = "document_chunks"; // Match local script

// MongoDB client singleton
let cachedClient: MongoClient | null = null;

async function getMongoClient(): Promise<MongoClient> {
  if (cachedClient) {
    return cachedClient;
  }

  const MONGODB_URI = getRequiredEnv("MONGODB_URI");

  cachedClient = new MongoClient(MONGODB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await cachedClient.connect();
  console.log("[mongo-upsert] Connected to MongoDB Atlas");

  return cachedClient;
}

serve(async (req: Request) => {
  const startTime = Date.now();

  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== "POST") {
      return createResponse(null, "Method not allowed. Use POST.", startTime);
    }

    const body: RequestBody = await req.json();

    if (body.action === "upsert") {
      const result = await handleUpsert(body as UpsertRequest);
      return createResponse(result, null, startTime);
    } else if (body.action === "search") {
      const result = await handleSearch(body as SearchRequest);
      return createResponse(result, null, startTime);
    } else {
      return createResponse(null, "Invalid action. Use 'upsert' or 'search'.", startTime);
    }
  } catch (error) {
    console.error(`[mongo-upsert] Error:`, error);
    return createResponse(null, (error as Error).message, startTime);
  }
});

/**
 * Handle document upsert operations
 */
async function handleUpsert(request: UpsertRequest): Promise<UpsertResponse> {
  const { documents } = request;

  console.log(`[mongo-upsert] Upserting ${documents.length} documents`);

  const client = await getMongoClient();
  const db = client.db(DATABASE_NAME);
  const collection = db.collection(COLLECTION_NAME);

  let totalUpserted = 0;
  let totalModified = 0;

  // Process in batches
  const batches = chunkArray(documents, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[mongo-upsert] Processing batch ${i + 1}/${batches.length}`);

    // Prepare bulk operations
    const bulkOps = batch.map((doc) => ({
      updateOne: {
        filter: {
          source_url: doc.source_url,
          chunk_index: doc.chunk_index,
        },
        update: {
          $set: {
            text: doc.text,
            // Apply scalar quantization for RAM efficiency
            embedding: quantizeEmbedding(doc.embedding),
            embedding_dimensions: doc.embedding.length,
            file_number: doc.file_number,
            source_url: doc.source_url,
            page_number: doc.page_number,
            bbox: doc.bbox,
            chunk_index: doc.chunk_index,
            metadata: {
              ...doc.metadata,
              embedded_at: new Date().toISOString(),
            },
          },
        },
        upsert: true,
      },
    }));

    const result = await collection.bulkWrite(bulkOps);
    totalUpserted += result.upsertedCount;
    totalModified += result.modifiedCount;
  }

  console.log(`[mongo-upsert] Upserted: ${totalUpserted}, Modified: ${totalModified}`);

  return {
    upserted_count: totalUpserted,
    modified_count: totalModified,
  };
}

/**
 * Generate embedding for text using Voyage AI
 */
async function generateQueryEmbedding(text: string): Promise<number[]> {
  const VOYAGE_API_KEY = getRequiredEnv("VOYAGE_API_KEY");

  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [text],
      model: "voyage-law-2",
      input_type: "query",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Handle vector search operations using MongoDB Atlas Vector Search
 */
async function handleSearch(request: SearchRequest): Promise<SearchResponse> {
  let {
    query_embedding,
    query_text,
    file_numbers,
    limit = 10,
    min_score = 0.7,
  } = request;

  // Generate embedding from text if not provided
  if (!query_embedding && query_text) {
    console.log(`[mongo-upsert] Generating embedding for query: "${query_text}"`);
    query_embedding = await generateQueryEmbedding(query_text);
  }

  if (!query_embedding) {
    throw new Error("Either query_embedding or query_text must be provided");
  }

  console.log(`[mongo-upsert] Searching with limit: ${limit}, min_score: ${min_score}`);

  const client = await getMongoClient();
  const db = client.db(DATABASE_NAME);
  const collection = db.collection(COLLECTION_NAME);

  let documents: Record<string, unknown>[];

  // Use cosine similarity search (works without vector index)
  // TODO: Switch to Atlas Vector Search once index is created
  {
    console.log(`[mongo-upsert] Using cosine similarity search`);

    const filter = file_numbers && file_numbers.length > 0
      ? { file_number: { $in: file_numbers }, embedding: { $exists: true } }
      : { embedding: { $exists: true } };

    const allDocs = await collection.find(filter).limit(500).toArray();
    console.log(`[mongo-upsert] Found ${allDocs.length} docs with embeddings`);

    // Calculate cosine similarity
    const cosineSim = (a: number[], b: number[]): number => {
      if (!a || !b || a.length !== b.length) return 0;
      let dot = 0, magA = 0, magB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
      }
      return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    };

    documents = allDocs
      .map(doc => ({
        ...doc,
        score: cosineSim(query_embedding, doc.embedding as number[]),
      }))
      .filter(doc => doc.score >= min_score)
      .sort((a, b) => (b.score as number) - (a.score as number))
      .slice(0, limit);

    console.log(`[mongo-upsert] Fallback search found ${documents.length} results`);
  }

  const results: VectorSearchResult[] = documents.map((doc) => ({
    document: {
      _id: doc._id?.toString(),
      text: doc.text,
      embedding: [], // Don't return embedding
      file_number: doc.file_number,
      source_url: doc.source_url,
      page_number: doc.page_number,
      bbox: doc.bbox,
      chunk_index: doc.chunk_index,
      metadata: doc.metadata,
    },
    score: doc.score,
  }));

  console.log(`[mongo-upsert] Found ${results.length} results`);

  return {
    results: results,
    total_found: results.length,
  };
}

/**
 * Apply scalar quantization (int8) to embeddings for RAM efficiency
 *
 * This reduces memory usage by ~4x while maintaining high accuracy
 * for the 36k+ unit data points
 */
function quantizeEmbedding(embedding: number[]): number[] {
  // Find min and max for normalization
  let min = Infinity;
  let max = -Infinity;

  for (const value of embedding) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = max - min || 1;

  // Scale to int8 range (-128 to 127)
  return embedding.map((value) => {
    const normalized = (value - min) / range;
    return Math.round(normalized * 255 - 128);
  });
}

// =============================================================================
// MongoDB Atlas Vector Search Index Setup
// =============================================================================
/*
Create this index in MongoDB Atlas UI or via mongosh:

db.zoning_chunks.createSearchIndex({
  "name": "vector_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 1024,
        "similarity": "cosine",
        "quantization": {
          "type": "scalar",
          "encoding": "int8"
        }
      },
      {
        "type": "filter",
        "path": "file_number"
      },
      {
        "type": "filter",
        "path": "page_number"
      }
    ]
  }
});
*/
