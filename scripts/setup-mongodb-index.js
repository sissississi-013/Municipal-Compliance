// =============================================================================
// MongoDB Atlas Vector Search Index Setup Script
// =============================================================================
// Run this script once to create the required vector search index
// in your MongoDB Atlas cluster.
//
// Usage: node scripts/setup-mongodb-index.js
// =============================================================================

const { MongoClient } = require("mongodb");
require("dotenv").config();

const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE = process.env.MONGODB_DATABASE || "sf_zoning";
const COLLECTION = process.env.MONGODB_COLLECTION || "zoning_chunks";

async function createVectorSearchIndex() {
  if (!MONGODB_URI) {
    console.error("Error: MONGODB_URI environment variable is not set");
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB Atlas");

    const db = client.db(DATABASE);
    const collection = db.collection(COLLECTION);

    // Create the collection if it doesn't exist
    const collections = await db.listCollections({ name: COLLECTION }).toArray();
    if (collections.length === 0) {
      await db.createCollection(COLLECTION);
      console.log(`Created collection: ${COLLECTION}`);
    }

    // Vector Search Index Definition
    // Using scalar quantization (int8) for RAM efficiency
    const vectorIndexDefinition = {
      name: "vector_index",
      type: "vectorSearch",
      definition: {
        fields: [
          {
            type: "vector",
            path: "embedding",
            numDimensions: 1024, // voyage-law-2 produces 1024-dimensional embeddings
            similarity: "cosine",
            quantization: {
              type: "scalar",
              encoding: "int8", // Reduces RAM usage by ~4x
            },
          },
          {
            type: "filter",
            path: "file_number",
          },
          {
            type: "filter",
            path: "page_number",
          },
          {
            type: "filter",
            path: "source_url",
          },
        ],
      },
    };

    // Create the search index
    // Note: This uses the Atlas Search Index API
    console.log("Creating vector search index...");
    console.log("Index definition:", JSON.stringify(vectorIndexDefinition, null, 2));

    // For Atlas clusters, you need to use the createSearchIndex command
    // This may require Atlas admin privileges
    try {
      await collection.createSearchIndex(vectorIndexDefinition);
      console.log("Vector search index created successfully!");
    } catch (indexError) {
      if (indexError.code === 68 || indexError.message?.includes("already exists")) {
        console.log("Index already exists, skipping creation");
      } else {
        // If createSearchIndex fails, provide manual instructions
        console.log("\n" + "=".repeat(60));
        console.log("MANUAL INDEX CREATION REQUIRED");
        console.log("=".repeat(60));
        console.log("\nThe programmatic index creation failed. Please create the");
        console.log("index manually in MongoDB Atlas:");
        console.log("\n1. Go to MongoDB Atlas: https://cloud.mongodb.com/");
        console.log("2. Navigate to your cluster");
        console.log(`3. Go to Database > ${DATABASE} > ${COLLECTION}`);
        console.log("4. Click 'Search Indexes' tab");
        console.log("5. Click 'Create Search Index'");
        console.log("6. Choose 'JSON Editor'");
        console.log("7. Paste this index definition:\n");
        console.log(JSON.stringify(vectorIndexDefinition, null, 2));
        console.log("\n" + "=".repeat(60));
      }
    }

    // Create standard indexes for filtering
    console.log("\nCreating standard indexes...");
    await collection.createIndex({ file_number: 1 });
    await collection.createIndex({ source_url: 1, chunk_index: 1 }, { unique: true });
    await collection.createIndex({ page_number: 1 });
    await collection.createIndex({ "metadata.section": 1 });
    console.log("Standard indexes created successfully!");

    // Print collection stats
    const stats = await db.command({ collStats: COLLECTION });
    console.log("\nCollection stats:");
    console.log(`  Documents: ${stats.count}`);
    console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Indexes: ${stats.nindexes}`);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("\nDisconnected from MongoDB Atlas");
  }
}

createVectorSearchIndex();
