#!/usr/bin/env npx ts-node
/**
 * Local PDF Processing Script
 * Bypasses Edge Function timeouts by running locally
 *
 * Usage: npx ts-node scripts/process-pdf.ts <pdf_url> <file_number>
 */

import * as dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

// Load environment variables from parent directory
dotenv.config({ path: '../.env' });

const REDUCTO_API_KEY = process.env.REDUCTO_API_KEY!;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!;
const MONGODB_URI = process.env.MONGODB_URI!;

interface Chunk {
  text: string;
  page_number: number;
  bbox: { left: number; top: number; width: number; height: number };
  chunk_index: number;
  embedding?: number[];
  file_number: string;
  source_url: string;
}

async function main() {
  const pdfUrl = process.argv[2] || 'https://media.api.sf.gov/documents/250700_economic_impact_final.pdf';
  const fileNumber = process.argv[3] || '250700';

  console.log(`\n📄 Processing PDF: ${pdfUrl}`);
  console.log(`📁 File Number: ${fileNumber}\n`);

  // Step 1: Parse with Reducto
  console.log('⏳ Step 1: Parsing PDF with Reducto (this may take 2-3 minutes)...');
  const chunks = await parsePdfWithReducto(pdfUrl, fileNumber);
  console.log(`✅ Parsed ${chunks.length} chunks\n`);

  if (chunks.length === 0) {
    console.log('❌ No chunks extracted. PDF may be image-based or empty.');
    return;
  }

  // Step 2: Generate embeddings with Voyage
  console.log('⏳ Step 2: Generating embeddings with Voyage AI...');
  const embeddedChunks = await generateEmbeddings(chunks);
  console.log(`✅ Generated ${embeddedChunks.length} embeddings\n`);

  // Step 3: Verify MongoDB storage
  console.log('⏳ Step 3: Verifying MongoDB storage...');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('sf_zoning');
  const collection = db.collection('document_chunks');
  const storedCount = await collection.countDocuments({ file_number: fileNumber });
  await client.close();
  console.log(`✅ Verified ${storedCount} chunks stored in MongoDB\n`);

  console.log('🎉 Processing complete!');
}

async function parsePdfWithReducto(pdfUrl: string, fileNumber: string): Promise<Chunk[]> {
  // Use AbortController for timeout (5 minutes)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);

  try {
    const response = await fetch('https://platform.reducto.ai/parse', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REDUCTO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_url: pdfUrl,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Reducto API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log('  Reducto response keys:', Object.keys(data));

    // Parse chunks from various possible response formats
    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    // Try to find content in different formats
    if (data.result?.chunks) {
      for (const chunk of data.result.chunks) {
        if (chunk.content) {
          chunks.push(createChunk(chunk.content, chunkIndex++, fileNumber, pdfUrl, chunk.blocks?.[0]?.bbox));
        }
        for (const block of chunk.blocks || []) {
          if (block.content) {
            chunks.push(createChunk(block.content, chunkIndex++, fileNumber, pdfUrl, block.bbox));
          }
        }
      }
    } else if (data.chunks) {
      for (const chunk of data.chunks) {
        chunks.push(createChunk(chunk.content || chunk.text || JSON.stringify(chunk), chunkIndex++, fileNumber, pdfUrl));
      }
    } else if (data.result?.markdown || data.markdown) {
      const text = data.result?.markdown || data.markdown;
      const paragraphs = text.split(/\n\n+/);
      for (const para of paragraphs) {
        if (para.trim().length > 20) {
          chunks.push(createChunk(para.trim(), chunkIndex++, fileNumber, pdfUrl));
        }
      }
    } else if (data.result?.text || data.text) {
      const text = data.result?.text || data.text;
      const paragraphs = text.split(/\n\n+/);
      for (const para of paragraphs) {
        if (para.trim().length > 20) {
          chunks.push(createChunk(para.trim(), chunkIndex++, fileNumber, pdfUrl));
        }
      }
    }

    return chunks;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error('Reducto API request timed out after 5 minutes');
    }
    throw error;
  }
}

function createChunk(
  text: string,
  index: number,
  fileNumber: string,
  sourceUrl: string,
  bbox?: { left: number; top: number; width: number; height: number; page?: number }
): Chunk {
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    page_number: bbox?.page || 1,
    bbox: bbox ? { left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height } : { left: 0, top: 0, width: 612, height: 792 },
    chunk_index: index,
    file_number: fileNumber,
    source_url: sourceUrl,
  };
}

async function generateEmbeddings(chunks: Chunk[]): Promise<Chunk[]> {
  // Voyage AI free tier: 3 RPM and 10K TPM limit
  const batchSize = 5;  // Very small batches to respect TPM
  const delayBetweenBatches = 25000;  // 25 seconds between batches
  const embeddedChunks: Chunk[] = [];

  // Connect to MongoDB for incremental storage
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('sf_zoning');
  const collection = db.collection('document_chunks');

  console.log(`  (Rate limited - this will take ~${Math.ceil(chunks.length / batchSize) * 25 / 60} minutes)`);

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);
    console.log(`  Embedding batch ${batchNum}/${totalBatches}...`);

    // Rate limit delay (skip on first batch)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }

    // Retry with exponential backoff
    let retries = 0;
    const maxRetries = 5;
    let response: Response | null = null;

    while (retries < maxRetries) {
      try {
        response = await fetch('https://api.voyageai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${VOYAGE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: batch.map(c => c.text.slice(0, 4000)), // Truncate to stay under token limit
            model: 'voyage-law-2',
            input_type: 'document',
          }),
        });

        if (response.status === 429) {
          retries++;
          const waitTime = Math.pow(2, retries) * 30000; // 30s, 60s, 120s, 240s, 480s
          console.log(`    Rate limited. Waiting ${waitTime / 1000}s before retry ${retries}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Voyage API error: ${response.status} - ${error}`);
        }

        break; // Success, exit retry loop
      } catch (err) {
        if (retries >= maxRetries - 1) throw err;
        retries++;
        console.log(`    Error, retrying (${retries}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    if (!response || !response.ok) {
      throw new Error('Failed to get embeddings after retries');
    }

    const data = await response.json();

    // Store each batch incrementally as they're embedded
    for (let j = 0; j < batch.length; j++) {
      const embeddedChunk = {
        ...batch[j],
        embedding: data.data[j].embedding,
      };
      embeddedChunks.push(embeddedChunk);

      // Upsert to MongoDB immediately
      const doc = {
        _id: `${embeddedChunk.file_number}_${embeddedChunk.chunk_index}`,
        ...embeddedChunk,
        created_at: new Date(),
      };
      await collection.updateOne(
        { _id: doc._id },
        { $set: doc },
        { upsert: true }
      );
    }
    console.log(`    Stored ${batch.length} chunks in MongoDB (total: ${embeddedChunks.length})`);
  }

  await client.close();
  return embeddedChunks;
}

async function storeInMongoDB(chunks: Chunk[]): Promise<number> {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db('sf_zoning');
    const collection = db.collection('document_chunks');

    // Prepare documents with unique IDs
    const documents = chunks.map(chunk => ({
      _id: `${chunk.file_number}_${chunk.chunk_index}`,
      ...chunk,
      created_at: new Date(),
    }));

    // Upsert each document
    let upsertedCount = 0;
    for (const doc of documents) {
      const result = await collection.updateOne(
        { _id: doc._id },
        { $set: doc },
        { upsert: true }
      );
      if (result.upsertedCount || result.modifiedCount) {
        upsertedCount++;
      }
    }

    return upsertedCount;
  } finally {
    await client.close();
  }
}

main().catch(console.error);
