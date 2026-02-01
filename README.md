# Municipal Compliance

Document intelligence system for San Francisco Board of Supervisors zoning compliance. Supports housing development review for Files #250700 and #250701 (36,200 units).

## Overview

This system automates the discovery, parsing, and semantic search of municipal zoning documents. PDF content is extracted with precise bounding box coordinates, embedded using legal-domain vectors, and indexed for semantic retrieval.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Discovery | Legistar OData API |
| PDF Parsing | Reducto API |
| Embeddings | Voyage AI (voyage-law-2, 1024 dim) |
| Database | MongoDB Atlas |
| Backend | Supabase Edge Functions |
| Frontend | React, TypeScript, Tailwind CSS |

## Project Structure

```
├── frontend/               React application
├── scripts/                Local processing utilities
└── supabase/functions/
    ├── firecrawl-discover/ PDF discovery service
    ├── reducto-parse/      PDF extraction with bbox
    ├── voyage-embed/       Vector embedding generation
    ├── mongo-upsert/       Database operations
    └── orchestrate/        Pipeline coordination
```

## Configuration

Required environment variables:

```
REDUCTO_API_KEY=
VOYAGE_API_KEY=
MONGODB_URI=
```

## Installation

```bash
# Frontend
cd frontend && npm install && npm run dev

# Edge Functions
npx supabase functions deploy
```

## API Reference

### Search Documents
```
POST /functions/v1/orchestrate
{
  "action": "search",
  "query": "housing zoning",
  "limit": 10,
  "min_score": 0.5
}
```

### Run Pipeline
```
POST /functions/v1/orchestrate
{
  "action": "run_pipeline",
  "search_terms": ["housing", "zoning"],
  "pdf_limit": 3
}
```

## Current Data

- 328 indexed document chunks from File #250700
- Source: SF Board of Supervisors Economic Impact Report

## License

Proprietary
