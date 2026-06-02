# File Ingestion & Embedding Pipeline for DB2

A Node.js pipeline that ingests text files, splits them into chunks, generates embeddings using Ollama, and stores them in IBM DB2 with native VECTOR support for efficient similarity search.

## Features

- 📄 **File Ingestion**: Read and process text files
- ✂️ **Text Splitting**: Recursive character-based text splitter with configurable chunk size and overlap
- 🧠 **Ollama Embeddings**: Generate embeddings using local Ollama models via HTTP API
- 💾 **DB2 Vector Storage**: Store embeddings using DB2's native VECTOR datatype
- 🔍 **Similarity Search Ready**: Use DB2's VECTOR_DISTANCE() for semantic search

## Prerequisites

1. **Node.js** (v14 or higher)
2. **IBM DB2** (v12.1.2 or higher with VECTOR support)
3. **Ollama** running locally at `http://localhost:11434`

### Installing Ollama

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull an embedding model:
   ```bash
   ollama pull nomic-embed-text
   ```
3. Verify Ollama is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

### Available Embedding Models

- `nomic-embed-text:latest` - 768 dimensions (recommended)
- `mxbai-embed-large` - 1024 dimensions
- `all-minilm` - 384 dimensions

## Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your DB2 credentials and settings

## Configuration

Edit the `.env` file with your settings:

```env
# DB2 Connection
DB2_HOST=your-db2-host.com
DB2_PORT=50001
DB2_DATABASE=TESTDB
DB2_USER=your-username
DB2_PASSWORD=your-password
DB2_SSL=true
DB2_SSL_CERT=/path/to/db2server.crt
DB2_TABLE=TEST_SCRATCH_IBMDB

# File Ingestion
INPUT_FILE=./sample.txt

# Text Splitting
CHUNK_SIZE=500
CHUNK_OVERLAP=50

# Ollama Configuration
OLLAMA_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text:latest
```

### Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `INPUT_FILE` | Path to text file to ingest | `./sample.txt` |
| `CHUNK_SIZE` | Maximum characters per chunk | `500` |
| `CHUNK_OVERLAP` | Overlapping characters between chunks | `50` |
| `OLLAMA_URL` | Ollama API endpoint | `http://localhost:11434` |
| `EMBEDDING_MODEL` | Ollama embedding model to use | `nomic-embed-text:latest` |
| `TOP_K` | Number of top similar results to return | `5` |
| `DISTANCE_METRIC` | Distance metric for similarity search (EUCLIDEAN, COSINE, DOT) | `EUCLIDEAN` |
| `DB2_HOST` | DB2 server hostname | - |
| `DB2_PORT` | DB2 server port | `50001` |
| `DB2_DATABASE` | Database name | - |
| `DB2_USER` | Database username | - |
| `DB2_PASSWORD` | Database password | - |
| `DB2_SSL` | Enable SSL connection | `true` |
| `DB2_SSL_CERT` | Path to SSL certificate | - |
| `DB2_TABLE` | Table name for embeddings | `TEST_SCRATCH_IBMDB` |

## Usage

### 1. Ingestion Pipeline

Ingest and store text file embeddings:

```bash
node ingest-to-db2.js
# or
npm start
```

The script will:
1. ✅ Read the input file
2. ✅ Split text into chunks with overlap
3. ✅ Generate embeddings using Ollama
4. ✅ Connect to DB2
5. ✅ Create table if it doesn't exist
6. ✅ Insert embeddings into DB2

### 2. Semantic Search

Search for similar content using natural language queries:

**Interactive Mode:**
```bash
node retrieve-from-db2.js
# or
npm run search
```

This starts an interactive session where you can enter multiple queries:
```
🔎 Enter search query: What are vector databases?
🔎 Enter search query: How does similarity search work?
🔎 Enter search query: exit
```

**Single Query Mode:**
```bash
node retrieve-from-db2.js "What are vector databases?"
# or
npm run search "What are vector databases?"
```

**Search Results Format:**
```
======================================================================
📊 SEARCH RESULTS
======================================================================

[1] ID: 3 | Distance: 0.234567
----------------------------------------------------------------------
Vector databases are specialized database systems designed to store
and query high-dimensional vector embeddings efficiently...

[2] ID: 7 | Distance: 0.345678
----------------------------------------------------------------------
Similarity search in vector databases uses distance metrics like
cosine similarity or Euclidean distance...
```

Lower distance values indicate higher similarity to your query.

## DB2 Table Schema

The script automatically creates a table with the following schema:

```sql
CREATE TABLE TEST_SCRATCH_IBMDB (
    ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1),
    TEXT_CONTENT CLOB(1M) NOT NULL,
    EMBEDDING VECTOR(dimension, FLOAT32) NOT NULL,
    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ID)
)
```

The `EMBEDDING` column uses DB2's native `VECTOR` datatype for efficient storage and similarity search.

## How It Works

### Ingestion Pipeline

1. **File Reading**: Reads text content from the specified file
2. **Text Splitting**: Splits text into overlapping chunks for better context preservation
3. **Embedding Generation**: Calls Ollama API to generate vector embeddings for each chunk
4. **DB2 Storage**: Stores text chunks and their embeddings using DB2's native VECTOR datatype

### Retrieval Pipeline

1. **Query Embedding**: Generates embedding for your search query using Ollama
2. **Vector Search**: Uses DB2's `VECTOR_DISTANCE()` function to find similar chunks
3. **Result Ranking**: Returns top-K most similar results ordered by distance
4. **Display**: Shows results with similarity scores and original text content

### Direct SQL Search (Advanced)

You can also perform searches directly using SQL:

```sql
-- Find the 5 most similar chunks to a query embedding
SELECT
    ID,
    TEXT_CONTENT,
    VECTOR_DISTANCE(EMBEDDING, VECTOR('[0.1,0.2,0.3,...]', 768, FLOAT32)) AS DISTANCE
FROM TEST_SCRATCH_IBMDB
ORDER BY DISTANCE ASC
FETCH FIRST 5 ROWS ONLY;
```

To get query embeddings manually:
```bash
curl http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text:latest",
  "prompt": "your search query here"
}'
```

## Pipeline Architecture

```
┌─────────────┐
│  Text File  │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│  File Ingestion     │
│  (Read file)        │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Text Splitting     │
│  (Chunks + Overlap) │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Ollama Embeddings  │
│  (HTTP API)         │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  DB2 Storage        │
│  (VECTOR datatype)  │
└─────────────────────┘
```

## Troubleshooting

### Ollama Connection Issues

If you get connection errors to Ollama:

1. Verify Ollama is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

2. Check if the model is available:
   ```bash
   ollama list
   ```

3. Pull the model if needed:
   ```bash
   ollama pull nomic-embed-text
   ```

### DB2 Connection Issues

1. Verify DB2 credentials in `.env`
2. Check if SSL certificate path is correct
3. Ensure DB2 port is accessible (default: 50001 for SSL, 50000 for non-SSL)
4. Test connection using the separate test script if available

### VECTOR Datatype Not Supported

If you get errors about VECTOR datatype:
- Ensure you're using DB2 v12.1.2 or higher
- VECTOR support must be enabled in your DB2 instance

## Example Output

```
======================================================================
📚 FILE INGESTION & EMBEDDING PIPELINE
======================================================================

📄 Ingesting file: ./sample.txt
✅ File ingested successfully (2847 characters)

✂️  Splitting text into chunks (size: 500, overlap: 50)
✅ Text split into 6 chunks

🧠 Generating embeddings using Ollama model: nomic-embed-text:latest
   Ollama URL: http://localhost:11434
  Processing chunk 1/6...
  Processing chunk 2/6...
  Processing chunk 3/6...
  Processing chunk 4/6...
  Processing chunk 5/6...
  Processing chunk 6/6...
✅ Generated 6 embeddings (dimension: 768)

🔌 Connecting to DB2...
  Host: your-db2-host.com
  Database: TESTDB
  Table: TEST_SCRATCH_IBMDB
✅ Connected to DB2

🗄️  Ensuring table TEST_SCRATCH_IBMDB exists...
✅ Table TEST_SCRATCH_IBMDB already exists

💾 Inserting 6 embeddings into TEST_SCRATCH_IBMDB...
  ✅ Inserted chunk 1/6
  ✅ Inserted chunk 2/6
  ✅ Inserted chunk 3/6
  ✅ Inserted chunk 4/6
  ✅ Inserted chunk 5/6
  ✅ Inserted chunk 6/6
✅ All embeddings inserted successfully

======================================================================
✅ PIPELINE COMPLETED SUCCESSFULLY!
======================================================================

Summary:
  - File: ./sample.txt
  - Chunks: 6
  - Embeddings: 6
  - Embedding dimension: 768
  - DB2 table: TEST_SCRATCH_IBMDB
  - Storage: VECTOR(768, FLOAT32)

💡 You can now use VECTOR_DISTANCE() for similarity search!
   Example: SELECT * FROM TEST_SCRATCH_IBMDB ORDER BY VECTOR_DISTANCE(EMBEDDING, ?) FETCH FIRST 5 ROWS ONLY
```

## License

MIT

## Contributing

Feel free to submit issues and enhancement requests!
