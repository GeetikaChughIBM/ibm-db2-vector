require('dotenv').config();
const ibmdb = require('ibm_db');
const axios = require('axios');
const readline = require('readline');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Ollama configuration
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text:latest',
    
    // Retrieval configuration
    topK: parseInt(process.env.TOP_K) || 5,
    distanceMetric: process.env.DISTANCE_METRIC || 'EUCLIDEAN',
    
    // DB2 configuration
    db2: {
        database: process.env.DB2_DATABASE,
        host: process.env.DB2_HOST,
        port: process.env.DB2_PORT,
        user: process.env.DB2_USER,
        password: process.env.DB2_PASSWORD,
        ssl: process.env.DB2_SSL === 'true',
        sslCert: process.env.DB2_SSL_CERT,
        table: process.env.DB2_TABLE
    }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate embedding for a query using Ollama
 */
async function generateQueryEmbedding(query, modelName, ollamaUrl) {
    console.log(`\nGenerating embedding for query using Ollama model: ${modelName}`);
    console.log(`   Query: "${query}"`);
    
    try {
        const response = await axios.post(`${ollamaUrl}/api/embeddings`, {
            model: modelName,
            prompt: query
        });
        
        const embedding = response.data.embedding;
        
        if (!embedding || !Array.isArray(embedding)) {
            throw new Error('Invalid embedding response from Ollama');
        }
        
        console.log(`Generated query embedding (dimension: ${embedding.length})`);
        return embedding;
        
    } catch (error) {
        console.error(`Error generating query embedding:`, error.message);
        throw error;
    }
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

/**
 * Search for similar chunks using vector similarity
 */
async function searchSimilarChunks(conn, tableName, queryEmbedding, topK, distanceMetric) {
    console.log(`\nSearching for top ${topK} similar chunks using ${distanceMetric} distance...`);
    
    // Format embedding as array string for VECTOR constructor
    const embeddingList = `[${queryEmbedding.join(',')}]`;
    const vectorDimension = queryEmbedding.length;
    
    // Use VECTOR_DISTANCE for similarity search
    // Lower distance = more similar
    // Supported metrics: EUCLIDEAN, COSINE, DOT_PRODUCT, etc.
    const searchQuery = `
        SELECT
            ID,
            TEXT_CONTENT,
            VECTOR_DISTANCE(EMBEDDING, VECTOR('${embeddingList}', ${vectorDimension}, FLOAT32), ${distanceMetric}) AS DISTANCE
        FROM ${tableName}
        ORDER BY DISTANCE ASC
        FETCH FIRST ${topK} ROWS ONLY
    `;
    
    return new Promise((resolve, reject) => {
        conn.query(searchQuery, (err, results) => {
            if (err) {
                return reject(err);
            }
            resolve(results);
        });
    });
}

/**
 * Display search results
 */
function displayResults(results) {
    console.log('\n' + '='.repeat(70));
    console.log('SEARCH RESULTS');
    console.log('='.repeat(70));
    
    if (results.length === 0) {
        console.log('\nNo results found.');
        return;
    }
    
    results.forEach((result, index) => {
        console.log(`\n[${index + 1}] ID: ${result.ID} | Distance: ${result.DISTANCE.toFixed(6)}`);
        console.log('-'.repeat(70));
        console.log(result.TEXT_CONTENT);
    });
    
    console.log('\n' + '='.repeat(70));
}

/**
 * Interactive search mode
 */
async function interactiveSearch(conn) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const askQuestion = (query) => {
        return new Promise((resolve) => {
            rl.question(query, resolve);
        });
    };
    
    console.log('\n' + '='.repeat(70));
    console.log('🔍 INTERACTIVE SEARCH MODE');
    console.log('='.repeat(70));
    console.log('Enter your search queries. Type "exit" or "quit" to stop.\n');
    
    while (true) {
        const query = await askQuestion('Enter search query: ');
        
        if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
            console.log('\nExiting interactive search mode...');
            rl.close();
            break;
        }
        
        if (!query.trim()) {
            console.log('Please enter a valid query.\n');
            continue;
        }
        
        try {
            // Generate embedding for query
            const queryEmbedding = await generateQueryEmbedding(
                query,
                CONFIG.embeddingModel,
                CONFIG.ollamaUrl
            );
            
            // Search for similar chunks
            const results = await searchSimilarChunks(
                conn,
                CONFIG.db2.table,
                queryEmbedding,
                CONFIG.topK,
                CONFIG.distanceMetric
            );
            
            // Display results
            displayResults(results);
            
        } catch (error) {
            console.error('\nSearch failed:', error.message);
        }
    }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main() {
    console.log('='.repeat(70));
    console.log('SEMANTIC SEARCH WITH DB2 VECTOR');
    console.log('='.repeat(70));
    
    let conn = null;
    
    try {
        // Connect to DB2
        console.log(`\nConnecting to DB2...`);
        console.log(`  Host: ${CONFIG.db2.host}`);
        console.log(`  Database: ${CONFIG.db2.database}`);
        console.log(`  Table: ${CONFIG.db2.table}`);
        
        const connStr = buildConnectionString(CONFIG.db2);
        conn = await connectToDB2(connStr);
        console.log(`Connected to DB2`);
        
        // Check if running with a query argument
        const queryArg = process.argv[2];
        
        if (queryArg) {
            // Single query mode
            console.log(`\nQuery: "${queryArg}"`);
            
            // Generate embedding for query
            const queryEmbedding = await generateQueryEmbedding(
                queryArg,
                CONFIG.embeddingModel,
                CONFIG.ollamaUrl
            );
            
            // Search for similar chunks
            const results = await searchSimilarChunks(
                conn,
                CONFIG.db2.table,
                queryEmbedding,
                CONFIG.topK,
                CONFIG.distanceMetric
            );
            
            // Display results
            displayResults(results);
            
        } else {
            // Interactive mode
            await interactiveSearch(conn);
        }
        
    } catch (error) {
        console.error('\nSEARCH FAILED!');
        console.error('Error:', error.message);
        console.error('\nFull error:', error);
        process.exit(1);
        
    } finally {
        // Close connection
        if (conn) {
            console.log('\nClosing DB2 connection...');
            await closeConnection(conn);
            console.log('Connection closed');
        }
    }
}

// Run the search
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    generateQueryEmbedding,
    searchSimilarChunks
};
