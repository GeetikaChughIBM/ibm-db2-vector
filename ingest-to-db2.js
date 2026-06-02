require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ibmdb = require('ibm_db');
const axios = require('axios');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // File to ingest
    inputFile: process.env.INPUT_FILE || './sample.txt',
    
    // Text splitting configuration
    chunkSize: parseInt(process.env.CHUNK_SIZE) || 500,
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP) || 50,
    
    // Ollama configuration
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text:latest',
    
    // DB2 configuration
    db2: {
        database: process.env.DB2_DATABASE,
        host: process.env.DB2_HOST,
        port: process.env.DB2_PORT,
        user: process.env.DB2_USER,
        password: process.env.DB2_PASSWORD,
        ssl: process.env.DB2_SSL === 'true',
        sslCert: process.env.DB2_SSL_CERT,
        table: process.env.DB2_TABLE || 'TEST_SCRATCH_IBMDB'
    }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Read file content
 */
function ingestFile(filePath) {
    console.log(`\n📄 Ingesting file: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    console.log(`✅ File ingested successfully (${content.length} characters)`);
    
    return content;
}

/**
 * Recursive character text splitter
 * Splits text into chunks with overlap
 */
function recursiveCharacterTextSplitter(text, chunkSize, chunkOverlap) {
    console.log(`\nSplitting text into chunks (size: ${chunkSize}, overlap: ${chunkOverlap})`);
    
    const chunks = [];
    let startIndex = 0;
    
    while (startIndex < text.length) {
        const endIndex = Math.min(startIndex + chunkSize, text.length);
        const chunk = text.slice(startIndex, endIndex);
        
        if (chunk.trim().length > 0) {
            chunks.push({
                text: chunk.trim(),
                startIndex: startIndex,
                endIndex: endIndex
            });
        }
        
        // Move forward by (chunkSize - overlap) to create overlap
        startIndex += (chunkSize - chunkOverlap);
        
        // Prevent infinite loop if overlap >= chunkSize
        if (chunkOverlap >= chunkSize) {
            startIndex = endIndex;
        }
    }
    
    console.log(`✅ Text split into ${chunks.length} chunks`);
    return chunks;
}

/**
 * Generate embeddings for text chunks using Ollama
 */
async function generateEmbeddings(chunks, modelName, ollamaUrl) {
    console.log(`\n🧠 Generating embeddings using Ollama model: ${modelName}`);
    console.log(`   Ollama URL: ${ollamaUrl}`);
    
    const embeddings = [];
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`  Processing chunk ${i + 1}/${chunks.length}...`);
        
        try {
            // Call Ollama embeddings API
            const response = await axios.post(`${ollamaUrl}/api/embeddings`, {
                model: modelName,
                prompt: chunk.text
            });
            
            const embedding = response.data.embedding;
            
            if (!embedding || !Array.isArray(embedding)) {
                throw new Error('Invalid embedding response from Ollama');
            }
            
            embeddings.push({
                text: chunk.text,
                embedding: embedding,
                embeddingDim: embedding.length
            });
        } catch (error) {
            console.error(`❌ Error generating embedding for chunk ${i + 1}:`, error.message);
            throw error;
        }
    }
    
    console.log(`✅ Generated ${embeddings.length} embeddings (dimension: ${embeddings[0].embeddingDim})`);
    return embeddings;
}

/**
 * Build DB2 connection string
 */
function buildConnectionString(config) {
    let connStr = `DATABASE=${config.database};` +
                  `HOSTNAME=${config.host};` +
                  `PORT=${config.port};` +
                  `PROTOCOL=TCPIP;` +
                  `UID=${config.user};` +
                  `PWD=${config.password};`;
    
    if (config.ssl) {
        connStr += `SECURITY=SSL;`;
        if (config.sslCert) {
            connStr += `SSLServerCertificate=${config.sslCert};`;
        }
    }
    
    return connStr;
}

/**
 * Create table if it doesn't exist
 * Uses DB2 VECTOR datatype for efficient embedding storage and similarity search
 */
async function ensureTableExists(conn, tableName, vectorDimension) {
    console.log(`\n🗄️  Ensuring table ${tableName} exists...`);
    
    // Check if table exists
    const checkQuery = `
        SELECT COUNT(*) AS CNT 
        FROM SYSCAT.TABLES 
        WHERE TABNAME = '${tableName.toUpperCase()}'
    `;
    
    return new Promise((resolve, reject) => {
        conn.query(checkQuery, (err, result) => {
            if (err) {
                return reject(err);
            }
            
            const tableExists = result[0].CNT > 0;
            
            if (tableExists) {
                console.log(`✅ Table ${tableName} already exists`);
                return resolve();
            }
            
            // Create table with VECTOR datatype
            // Format: VECTOR(dimension, data_type)
            console.log(`📝 Creating table ${tableName} with VECTOR(${vectorDimension}, FLOAT32) datatype...`);
            const createQuery = `
                CREATE TABLE ${tableName} (
                    ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1),
                    TEXT_CONTENT CLOB(1M) NOT NULL,
                    EMBEDDING VECTOR(${vectorDimension}, FLOAT32) NOT NULL,
                    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (ID)
                )
            `;
            
            conn.query(createQuery, (err) => {
                if (err) {
                    return reject(err);
                }
                console.log(`✅ Table ${tableName} created successfully with VECTOR support`);
                resolve();
            });
        });
    });
}

/**
 * Insert embeddings into DB2
 * Uses VECTOR constructor: VECTOR('[1.0,2.0,3.0,...]', dimension, FLOAT32)
 */
async function insertEmbeddings(conn, tableName, embeddings) {
    console.log(`\n💾 Inserting ${embeddings.length} embeddings into ${tableName}...`);
    
    for (let i = 0; i < embeddings.length; i++) {
        const emb = embeddings[i];
        
        // Format embedding as array string: "[1.0,2.0,3.0,...]"
        const embeddingList = `[${emb.embedding.join(',')}]`;
        const vectorDimension = emb.embeddingDim;
        
        // Use VECTOR constructor: VECTOR('embeddingList', dimension, FLOAT32)
        const insertQuery = `
            INSERT INTO ${tableName} 
            (TEXT_CONTENT, EMBEDDING)
            VALUES (?, VECTOR('${embeddingList}', ${vectorDimension}, FLOAT32))
        `;
        
        await new Promise((resolve, reject) => {
            conn.query(insertQuery, [emb.text], (err) => {
                if (err) {
                    console.error(`❌ Error inserting chunk ${i + 1}:`, err.message);
                    return reject(err);
                }
                console.log(`  ✅ Inserted chunk ${i + 1}/${embeddings.length}`);
                resolve();
            });
        });
    }
    
    console.log(`✅ All embeddings inserted successfully`);
}

/**
 * Connect to DB2
 */
function connectToDB2(connStr) {
    return new Promise((resolve, reject) => {
        ibmdb.open(connStr, (err, conn) => {
            if (err) {
                return reject(err);
            }
            resolve(conn);
        });
    });
}

/**
 * Close DB2 connection
 */
function closeConnection(conn) {
    return new Promise((resolve, reject) => {
        conn.close((err) => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

async function main() {
    console.log('='.repeat(70));
    console.log('📚 FILE INGESTION & EMBEDDING PIPELINE');
    console.log('='.repeat(70));
    
    let conn = null;
    
    try {
        // Step 1: Ingest file
        const text = ingestFile(CONFIG.inputFile);
        
        // Step 2: Split text into chunks
        const chunks = recursiveCharacterTextSplitter(
            text,
            CONFIG.chunkSize,
            CONFIG.chunkOverlap
        );
        
        // Step 3: Generate embeddings
        const embeddings = await generateEmbeddings(chunks, CONFIG.embeddingModel, CONFIG.ollamaUrl);
        
        // Step 4: Connect to DB2
        console.log(`\n🔌 Connecting to DB2...`);
        console.log(`  Host: ${CONFIG.db2.host}`);
        console.log(`  Database: ${CONFIG.db2.database}`);
        console.log(`  Table: ${CONFIG.db2.table}`);
        
        const connStr = buildConnectionString(CONFIG.db2);
        conn = await connectToDB2(connStr);
        console.log(`✅ Connected to DB2`);
        
        // Step 5: Ensure table exists with proper vector dimension
        await ensureTableExists(conn, CONFIG.db2.table, embeddings[0].embeddingDim);
        
        // Step 6: Insert embeddings
        await insertEmbeddings(conn, CONFIG.db2.table, embeddings);
        
        // Success!
        console.log('\n' + '='.repeat(70));
        console.log('✅ PIPELINE COMPLETED SUCCESSFULLY!');
        console.log('='.repeat(70));
        console.log(`\nSummary:`);
        console.log(`  - File: ${CONFIG.inputFile}`);
        console.log(`  - Chunks: ${chunks.length}`);
        console.log(`  - Embeddings: ${embeddings.length}`);
        console.log(`  - Embedding dimension: ${embeddings[0].embeddingDim}`);
        console.log(`  - DB2 table: ${CONFIG.db2.table}`);
        console.log(`  - Storage: VECTOR(${embeddings[0].embeddingDim}, FLOAT32)`);
        console.log('\n💡 You can now use VECTOR_DISTANCE() for similarity search!');
        console.log('   Example: SELECT * FROM ${CONFIG.db2.table} ORDER BY VECTOR_DISTANCE(EMBEDDING, ?) FETCH FIRST 5 ROWS ONLY');
        console.log('');
        
    } catch (error) {
        console.error('\n❌ PIPELINE FAILED!');
        console.error('Error:', error.message);
        console.error('\nFull error:', error);
        process.exit(1);
        
    } finally {
        // Close connection
        if (conn) {
            console.log('🔌 Closing DB2 connection...');
            await closeConnection(conn);
            console.log('✅ Connection closed');
        }
    }
}

// Run the pipeline
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    ingestFile,
    recursiveCharacterTextSplitter,
    generateEmbeddings,
    insertEmbeddings
};

// Made with Bob
