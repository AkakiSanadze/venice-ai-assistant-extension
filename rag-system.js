/**
 * rag-system.js
 * RAG (Retrieval-Augmented Generation) Knowledge Base System
 * Provides document upload, text extraction, embedding, and semantic search
 */

// ============================================
// IndexedDB Wrapper for RAG Data
// ============================================

const RAG_DATABASE_NAME = 'VeniceRAG';
const RAG_DATABASE_VERSION = 1;

class RAGDatabase {
    constructor() {
        this.db = null;
        this.dbName = RAG_DATABASE_NAME;
        this.version = RAG_DATABASE_VERSION;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('RAG Database open error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Knowledge bases store
                if (!db.objectStoreNames.contains('knowledgeBases')) {
                    const kbStore = db.createObjectStore('knowledgeBases', { keyPath: 'id' });
                    kbStore.createIndex('name', 'name', { unique: false });
                    kbStore.createIndex('createdAt', 'createdAt', { unique: false });
                    kbStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                }

                // Documents store
                if (!db.objectStoreNames.contains('documents')) {
                    const docStore = db.createObjectStore('documents', { keyPath: 'id' });
                    docStore.createIndex('kbId', 'kbId', { unique: false });
                    docStore.createIndex('filename', 'filename', { unique: false });
                    docStore.createIndex('uploadedAt', 'uploadedAt', { unique: false });
                    docStore.createIndex('status', 'status', { unique: false });
                }

                // Chunks store (with embedding for vector search)
                if (!db.objectStoreNames.contains('chunks')) {
                    const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
                    chunkStore.createIndex('kbId', 'kbId', { unique: false });
                    chunkStore.createIndex('docId', 'docId', { unique: false });
                }

                // Conversation-KB associations
                if (!db.objectStoreNames.contains('conversationKB')) {
                    const convKBStore = db.createObjectStore('conversationKB', { keyPath: 'conversationId' });
                    convKBStore.createIndex('kbId', 'kbId', { unique: false });
                    convKBStore.createIndex('active', 'active', { unique: false });
                }

                // Embedding cache store
                if (!db.objectStoreNames.contains('embeddingCache')) {
                    const cacheStore = db.createObjectStore('embeddingCache', { keyPath: 'hash' });
                    cacheStore.createIndex('expiresAt', 'expiresAt', { unique: false });
                }
            };
        });
    }

    // Generic CRUD operations
    async get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllFromIndex(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async deleteAllFromIndex(storeName, indexName, value) {
        const items = await this.getAllFromIndex(storeName, indexName, value);
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        for (const item of items) {
            store.delete(item.id);
        }

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async clear(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// ============================================
// Data Models / Interfaces
// ============================================

/**
 * @typedef {Object} KnowledgeBase
 * @property {string} id - UUID
 * @property {string} name - User-defined name
 * @property {string} [description] - Optional description
 * @property {number} createdAt - Timestamp
 * @property {number} updatedAt - Timestamp
 * @property {number} totalChunks - Cached chunk count
 * @property {number} totalTokens - Cached token count
 * @property {string} embeddingModel - Model used for embeddings
 */

/**
 * @typedef {Object} Document
 * @property {string} id - UUID
 * @property {string} kbId - Parent KB ID
 * @property {string} filename - Original filename
 * @property {'pdf'|'docx'|'txt'|'md'} fileType - File type
 * @property {number} fileSize - File size in bytes
 * @property {string} extractedText - Full extracted text
 * @property {'processing'|'ready'|'error'} status - Processing status
 * @property {number} chunkCount - Number of chunks
 * @property {number} uploadedAt - Upload timestamp
 * @property {number} lastAccessed - Last accessed timestamp
 * @property {string} [errorMessage] - Error message if status is 'error'
 */

/**
 * @typedef {Object} Chunk
 * @property {string} id - UUID
 * @property {string} kbId - Parent KB ID
 * @property {string} docId - Parent document ID
 * @property {string} content - Chunk text
 * @property {number[]} embedding - Vector embedding
 * @property {number} startIndex - Position in original document
 * @property {number} endIndex - End position in original document
 * @property {number} tokenCount - Estimated token count
 * @property {Object} metadata - Additional metadata
 * @property {number} [metadata.pageNumber] - Page number (for PDFs)
 * @property {string} [metadata.section] - Section name
 * @property {string} [metadata.heading] - Heading text
 */

/**
 * @typedef {Object} ConversationKB
 * @property {string} conversationId - Conversation ID
 * @property {string} kbId - Knowledge base ID
 * @property {boolean} active - Is KB active for this conversation
 * @property {number} addedAt - Timestamp when added
 */

// ============================================
// Vector Store with Cosine Similarity Search
// ============================================

class VectorStore {
    constructor(ragDb) {
        this.db = ragDb;
        this.chunks = new Map();           // id -> chunk
        this.kbIndex = new Map();           // kbId -> Set(chunkIds)
        this.loadedKBs = new Set();         // Track loaded KBs
    }

    /**
     * Load all chunks for a KB into memory
     * @param {string} kbId - Knowledge base ID
     */
    async loadKnowledgeBase(kbId) {
        if (this.loadedKBs.has(kbId)) {
            return; // Already loaded
        }

        const chunks = await this.db.getAllFromIndex('chunks', 'kbId', kbId);

        for (const chunk of chunks) {
            this.chunks.set(chunk.id, chunk);
        }

        this.kbIndex.set(kbId, new Set(chunks.map(c => c.id)));
        this.loadedKBs.add(kbId);

        console.log(`[VectorStore] Loaded ${chunks.length} chunks for KB ${kbId}`);
    }

    /**
     * Unload KB from memory
     * @param {string} kbId - Knowledge base ID
     */
    unloadKnowledgeBase(kbId) {
        const chunkIds = this.kbIndex.get(kbId);
        if (!chunkIds) return;

        for (const id of chunkIds) {
            this.chunks.delete(id);
        }

        this.kbIndex.delete(kbId);
        this.loadedKBs.delete(kbId);

        console.log(`[VectorStore] Unloaded KB ${kbId}`);
    }

    /**
     * Check if KB is loaded in memory
     * @param {string} kbId - Knowledge base ID
     * @returns {boolean}
     */
    isLoaded(kbId) {
        return this.loadedKBs.has(kbId);
    }

    /**
     * Calculate cosine similarity between two vectors
     * @param {number[]} a - First vector
     * @param {number[]} b - Second vector
     * @returns {number} Similarity score (-1 to 1)
     */
    cosineSimilarity(a, b) {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        if (normA === 0 || normB === 0) return 0;

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Search for similar chunks
     * @param {number[]} queryEmbedding - Query vector
     * @param {number} topK - Number of results to return
     * @param {string[]|null} kbIds - Optional array of KB IDs to search
     * @returns {Promise<Array>} Array of chunks with similarity scores
     */
    search(queryEmbedding, topK = 5, kbIds = null) {
        let candidates = [];

        if (kbIds && kbIds.length > 0) {
            // Search only in specified KBs
            for (const kbId of kbIds) {
                const chunkIds = this.kbIndex.get(kbId);
                if (chunkIds) {
                    for (const id of chunkIds) {
                        const chunk = this.chunks.get(id);
                        if (chunk) candidates.push(chunk);
                    }
                }
            }
        } else {
            // Search all loaded chunks
            candidates = Array.from(this.chunks.values());
        }

        // Calculate similarities
        const scored = candidates.map(chunk => ({
            ...chunk,
            similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding)
        }));

        // Sort by similarity and return top K
        return scored
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }

    /**
     * Add a chunk to the store
     * @param {Chunk} chunk - Chunk to add
     */
    addChunk(chunk) {
        this.chunks.set(chunk.id, chunk);

        if (!this.kbIndex.has(chunk.kbId)) {
            this.kbIndex.set(chunk.kbId, new Set());
        }
        this.kbIndex.get(chunk.kbId).add(chunk.id);
        this.loadedKBs.add(chunk.kbId);
    }

    /**
     * Remove a chunk from the store
     * @param {string} chunkId - Chunk ID to remove
     * @param {string} kbId - Knowledge base ID
     */
    removeChunk(chunkId, kbId) {
        this.chunks.delete(chunkId);

        const kbChunks = this.kbIndex.get(kbId);
        if (kbChunks) {
            kbChunks.delete(chunkId);
        }
    }

    /**
     * Get total chunk count for a KB
     * @param {string} kbId - Knowledge base ID
     * @returns {number}
     */
    getChunkCount(kbId) {
        const chunkIds = this.kbIndex.get(kbId);
        return chunkIds ? chunkIds.size : 0;
    }
}

// ============================================
// Document Processor - Text Extraction
// ============================================

class DocumentProcessor {
    constructor() {
        this.supportedTypes = ['pdf', 'docx', 'txt', 'md'];
    }

    /**
     * Extract text from a file based on its type
     * @param {File} file - File to extract text from
     * @returns {Promise<string>} Extracted text
     */
    async extractText(file) {
        const extension = file.name.split('.').pop().toLowerCase();

        if (!this.supportedTypes.includes(extension)) {
            throw new Error(`Unsupported file type: ${extension}`);
        }

        switch (extension) {
            case 'pdf':
                return await this.extractPDF(file);
            case 'docx':
                return await this.extractDOCX(file);
            case 'txt':
            case 'md':
                return await file.text();
            default:
                throw new Error(`Unsupported file type: ${extension}`);
        }
    }

    /**
     * Extract text from PDF
     * @param {File} file - PDF file
     * @returns {Promise<string>} Extracted text
     */
    async extractPDF(file) {
        const arrayBuffer = await file.arrayBuffer();

        // Use existing PDFParser from pdf-parser.js
        if (typeof PDFParser !== 'undefined') {
            const result = await PDFParser.extractText(arrayBuffer);
            return result.pages.map(p => p.text).join('\n\n');
        } else {
            throw new Error('PDFParser not available');
        }
    }

    /**
     * Extract text from DOCX
     * @param {File} file - DOCX file
     * @returns {Promise<string>} Extracted text
     */
    async extractDOCX(file) {
        // Check if mammoth is available
        if (typeof mammoth !== 'undefined') {
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            return result.value;
        } else {
            throw new Error('Mammoth.js not loaded');
        }
    }

    /**
     * Get file type from filename
     * @param {string} filename - Filename
     * @returns {string} File type
     */
    getFileType(filename) {
        return filename.split('.').pop().toLowerCase();
    }

    /**
     * Validate file type
     * @param {File} file - File to validate
     * @returns {boolean} True if supported
     */
    isSupported(file) {
        const extension = file.name.split('.').pop().toLowerCase();
        return this.supportedTypes.includes(extension);
    }
}

// ============================================
// Chunking Strategy
// ============================================

class ChunkingStrategy {
    /**
     * Fixed size chunking with overlap
     * @param {string} text - Text to chunk
     * @param {number} chunkSize - Characters per chunk (default: 1000)
     * @param {number} overlap - Overlap between chunks (default: 200)
     * @returns {string[]} Array of text chunks
     */
    static fixedSize(text, chunkSize = 1000, overlap = 200) {
        const chunks = [];
        let start = 0;

        while (start < text.length) {
            const end = Math.min(start + chunkSize, text.length);
            chunks.push(text.slice(start, end));
            start = end - overlap;

            // Prevent infinite loop for small texts
            if (start <= 0 || start >= text.length) break;
        }

        return chunks;
    }

    /**
     * Semantic chunking by paragraphs and sections
     * @param {string} text - Text to chunk
     * @param {number} maxChunkSize - Maximum chunk size (default: 1000)
     * @returns {string[]} Array of text chunks
     */
    static semantic(text, maxChunkSize = 1000) {
        // First split by markdown headers
        const sections = text.split(/(?=#{1,3}\s)/);
        const chunks = [];

        for (const section of sections) {
            // Split each section by paragraphs
            const paragraphs = section.split(/\n\n+/);
            let currentChunk = '';

            for (const para of paragraphs) {
                const trimmed = para.trim();
                if (!trimmed) continue;

                if (currentChunk.length + trimmed.length > maxChunkSize && currentChunk.length > 0) {
                    chunks.push(currentChunk.trim());
                    currentChunk = trimmed;
                } else {
                    currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
                }
            }

            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
        }

        return chunks;
    }

    /**
     * Recursive character chunking (best for code)
     * @param {string} text - Text to chunk
     * @param {string[]} separators - Separator优先级
     * @param {number} chunkSize - Target chunk size
     * @returns {string[]} Array of text chunks
     */
    static recursive(text, separators = ['\n\n', '\n', '. ', ' '], chunkSize = 1000) {
        if (!text || text.length <= chunkSize) {
            return text ? [text] : [];
        }

        const chunks = [];
        let start = 0;

        while (start < text.length) {
            let bestSplit = -1;

            // Find the best separator within the chunk size
            for (const sep of separators) {
                const searchStart = Math.max(0, start + chunkSize - 200);
                const searchEnd = Math.min(start + chunkSize, text.length);
                const searchText = text.slice(searchStart, searchEnd);

                const sepIndex = searchText.lastIndexOf(sep);
                if (sepIndex > -1) {
                    bestSplit = searchStart + sepIndex + sep.length;
                    break;
                }
            }

            const end = bestSplit > 0 ? Math.min(bestSplit, text.length) : Math.min(start + chunkSize, text.length);
            chunks.push(text.slice(start, end).trim());
            start = end;
        }

        return chunks.filter(c => c.length > 0);
    }

    /**
     * Estimate token count for text (rough approximation)
     * @param {string} text - Text to estimate
     * @returns {number} Estimated token count
     */
    static estimateTokens(text) {
        if (!text) return 0;
        // Rough estimate: ~4 characters per token
        return Math.ceil(text.length / 4);
    }
}

// ============================================
// Embedding Service
// ============================================

class EmbeddingService {
    constructor(api) {
        this.api = api;
        this.cache = new Map(); // hash -> embedding
        this.batchSize = 10;
        this.hasWarnedAboutFallback = false;
    }

    /**
     * Generate a simple hash for text caching
     * @param {string} text - Text to hash
     * @returns {string} Hash
     */
    async hashText(text) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Generate embedding for a single text
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     */
    async generateEmbedding(text) {
        // Check cache first
        const hash = await this.hashText(text);
        if (this.cache.has(hash)) {
            return this.cache.get(hash);
        }

        try {
            // Use Venice AI embeddings API if available
            const embedding = await this.getEmbeddingFromAPI(text);

            // Cache the result
            this.cache.set(hash, embedding);
            return embedding;
        } catch (error) {
            console.error('[EmbeddingService] API error, using fallback:', error);

            // Warn user about degraded search quality (once per session)
            if (!this.hasWarnedAboutFallback && typeof window !== 'undefined' && window.app && window.app.showToast) {
                window.app.showToast('Knowledge Base using offline mode - search quality may be reduced', 'warning', 5000);
                this.hasWarnedAboutFallback = true;
            }

            // Fallback: generate a simple hash-based pseudo-embedding for demo
            return this.generateFallbackEmbedding(text);
        }
    }

    /**
     * Discover a suitable embedding model from Venice API
     * Validates that the model actually works
     */
    async discoverEmbeddingModel() {
        if (this.embeddingModel) return; // Already discovered

        try {
            const apiKey = await this.getApiKey();
            if (!apiKey) return;

            const response = await fetch('https://api.venice.ai/api/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!response.ok) return;

            const data = await response.json();
            // Look for models with 'embed' in the ID
            const embedModels = data.data.filter(m =>
                m.id.toLowerCase().includes('embed') ||
                m.id.toLowerCase().includes('bge') ||
                m.id.toLowerCase().includes('ada')
            );
            if (embedModels.length > 0) {
                this.embeddingModel = embedModels[0].id;
                console.log('[EmbeddingService] Discovered model:', this.embeddingModel);
                
                // Validate the model works with a simple test
                const isValid = await this.validateModel(this.embeddingModel);
                if (!isValid) {
                    console.warn('[EmbeddingService] Model validation failed, will use fallback');
                    this.embeddingModel = null;
                }
            }
        } catch (e) {
            console.warn('[EmbeddingService] Model discovery failed:', e);
        }
    }
    
    /**
     * Validate that an embedding model works
     * @param {string} model - Model ID to validate
     * @returns {Promise<boolean>} True if model works
     */
    async validateModel(model) {
        try {
            const apiKey = await this.getApiKey();
            if (!apiKey) return false;
            
            const response = await fetch('https://api.venice.ai/api/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    input: 'test'
                })
            });
            
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get embedding from Venice AI API
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} Embedding vector
     */
    async getEmbeddingFromAPI(text) {
        // Ensure model is discovered
        if (!this.embeddingModel) {
            await this.discoverEmbeddingModel();
        }

        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new Error('No API key available');
        }

        const response = await fetch('https://api.venice.ai/api/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                // Use discovered model, or null to let API choose default
                model: this.embeddingModel || undefined,
                input: text
            })
        });

        if (!response.ok) {
            throw new Error(`Embedding API error: ${response.status}`);
        }

        const data = await response.json();
        return data.data[0].embedding;
    }

    /**
     * Get API key from storage
     * @returns {Promise<string|null>} API key
     */
    async getApiKey() {
        if (window.storage && window.storage.getApiKey) {
            return await window.storage.getApiKey();
        }
        return null;
    }

    /**
     * Generate a simple fallback embedding based on text content
     * This is a deterministic pseudo-embedding for demo/offline use
     * @param {string} text - Text to embed
     * @returns {number[]} 384-dimensional pseudo-embedding
     */
    generateFallbackEmbedding(text) {
        const dim = 384;
        const embedding = new Array(dim).fill(0);

        // Use character codes to generate a deterministic embedding
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            embedding[i % dim] += charCode;
            embedding[(i * 7) % dim] += charCode * 0.5;
            embedding[(i * 13) % dim] += charCode * 0.25;
        }

        // Normalize the vector
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        if (magnitude > 0) {
            for (let i = 0; i < dim; i++) {
                embedding[i] /= magnitude;
            }
        }

        return embedding;
    }

    /**
     * Generate embeddings for multiple texts in batches
     * @param {string[]} texts - Array of texts to embed
     * @param {function} onProgress - Progress callback (current, total)
     * @returns {Promise<number[][]>} Array of embeddings
     */
    async generateEmbeddingsBatch(texts, onProgress) {
        const embeddings = [];

        for (let i = 0; i < texts.length; i += this.batchSize) {
            const batch = texts.slice(i, i + this.batchSize);
            const batchEmbeddings = await Promise.all(
                batch.map(text => this.generateEmbedding(text))
            );
            embeddings.push(...batchEmbeddings);

            if (onProgress) {
                onProgress(Math.min(i + this.batchSize, texts.length), texts.length);
            }

            // Rate limiting delay
            if (i + this.batchSize < texts.length) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        return embeddings;
    }

    /**
     * Clear the embedding cache
     */
    clearCache() {
        this.cache.clear();
    }
}

// ============================================
// RAG Retrieval System
// ============================================

class RAGRetrieval {
    constructor(vectorStore, embeddingService) {
        this.vectorStore = vectorStore;
        this.embeddingService = embeddingService;
    }

    /**
     * Retrieve relevant chunks for a query
     * @param {string} query - User query
     * @param {Object} options - Retrieval options
     * @param {string[]} [options.kbIds] - KB IDs to search
     * @param {number} [options.topK=5] - Number of chunks to retrieve
     * @param {number} [options.similarityThreshold=0.5] - Minimum similarity
     * @param {number} [options.maxTokens=2000] - Max tokens in context
     * @param {string} [options.model] - Model ID for context adaptation
     * @returns {Promise<Array>} Retrieved chunks with similarity scores
     */
    async retrieve(query, options = {}) {
        const {
            kbIds = null,
            topK = 5,
            similarityThreshold = 0.5,
            maxTokens = 2000,
            model = null
        } = options;

        // Generate query embedding
        const queryEmbedding = await this.embeddingService.generateEmbedding(query);

        // Search vector store (get more results for filtering)
        let results = this.vectorStore.search(queryEmbedding, topK * 2, kbIds);

        // Filter by similarity threshold
        results = results.filter(r => r.similarity >= similarityThreshold);

        // Adapt to model context window
        if (model) {
            results = this.adaptToModelContext(results, model, maxTokens);
        }

        // Simple reranking
        results = this.rerankResults(query, results);

        return results.slice(0, topK);
    }

    /**
     * Adapt retrieved results to model context window
     * @param {Array} results - Retrieved chunks
     * @param {string} model - Model ID
     * @param {number} maxTokens - Max tokens to use
     * @returns {Array} Adapted results
     */
    adaptToModelContext(results, model, maxTokens) {
        // Use MODEL_CONTEXT_LIMITS from venice-api.js if available
        const modelLimit = (typeof MODEL_CONTEXT_LIMITS !== 'undefined' && MODEL_CONTEXT_LIMITS[model])
            ? MODEL_CONTEXT_LIMITS[model]
            : 128000;

        const safeLimit = Math.min(maxTokens, Math.floor(modelLimit * 0.3));

        let totalTokens = 0;
        const adapted = [];

        for (const result of results) {
            const tokens = ChunkingStrategy.estimateTokens(result.content);
            if (totalTokens + tokens > safeLimit) break;
            adapted.push(result);
            totalTokens += tokens;
        }

        return adapted;
    }

    /**
     * Rerank results based on keyword matching
     * @param {string} query - User query
     * @param {Array} results - Retrieved chunks
     * @returns {Array} Reranked results
     */
    rerankResults(query, results) {
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

        return results.sort((a, b) => {
            // Count keyword matches
            const aMatches = queryWords.filter(w =>
                a.content.toLowerCase().includes(w)
            ).length;
            const bMatches = queryWords.filter(w =>
                b.content.toLowerCase().includes(w)
            ).length;

            // Boost score by keyword matches (10% weight)
            const aScore = a.similarity + (aMatches * 0.1);
            const bScore = b.similarity + (bMatches * 0.1);

            return bScore - aScore;
        });
    }
}

// ============================================
// Context Assembler
// ============================================

class ContextAssembler {
    /**
     * Assemble context string from retrieved chunks
     * @param {Array} retrievedChunks - Retrieved chunks with similarity scores
     * @param {string} query - User query
     * @returns {Object} Context string and source metadata
     */
    assembleContext(retrievedChunks, query) {
        // Group chunks by document
        const byDocument = this.groupByDocument(retrievedChunks);

        let context = '[Knowledge Base Context]\n\n';
        const sources = [];

        for (const [docId, chunks] of Object.entries(byDocument)) {
            if (!chunks || chunks.length === 0) continue;

            const doc = chunks[0];
            const filename = doc?.filename || 'Unknown';
            context += `## Source: ${filename}\n\n`;

            for (const chunk of chunks) {
                if (chunk && chunk.content) {
                    context += chunk.content + '\n\n';
                }
            }

            sources.push({
                docId,
                filename: filename,
                pageNumber: doc?.metadata?.pageNumber,
                chunkCount: chunks.length
            });

            context += '---\n\n';
        }

        context += `[User Query: ${query}]\n\n`;
        context += 'Please answer the user query using ONLY the information provided above. ';
        context += 'If the answer is not in the provided context, say "I cannot find information about this in your documents."';

        return { context, sources };
    }

    /**
     * Group chunks by document ID
     * @param {Array} chunks - Array of chunks
     * @returns {Object} Groups by docId
     */
    groupByDocument(chunks) {
        return chunks.reduce((acc, chunk) => {
            if (!acc[chunk.docId]) acc[chunk.docId] = [];
            acc[chunk.docId].push(chunk);
            return acc;
        }, {});
    }

    /**
     * Format response with source citations
     * @param {string} response - AI response
     * @param {Array} sources - Source metadata
     * @returns {string} Formatted response with citations
     */
    formatWithCitations(response, sources) {
        if (!sources || sources.length === 0) return response;

        let formatted = response + '\n\n---\n\n**Sources:**\n';

        sources.forEach((source, i) => {
            formatted += `[${i + 1}] ${source.filename}`;
            if (source.pageNumber) {
                formatted += ` (Page ${source.pageNumber})`;
            }
            formatted += '\n';
        });

        return formatted;
    }
}

// ============================================
// Knowledge Base Manager
// ============================================

class KnowledgeBaseManager {
    constructor(ragDb, vectorStore) {
        this.db = ragDb;
        this.vectorStore = vectorStore;
        this.activeKBs = new Map(); // conversationId -> Set(kbIds)
        this.activeKBId = null;     // Global active KB for current session
    }

    /**
     * Activate a KB globally
     * @param {string} kbId - KB ID
     */
    async activateKB(kbId) {
        if (!this.vectorStore.isLoaded(kbId)) {
            await this.vectorStore.loadKnowledgeBase(kbId);
        }
        this.activeKBId = kbId;
    }

    /**
     * Deactivate global KB
     */
    async deactivateKB() {
        this.activeKBId = null;
    }

    /**
     * Create a new knowledge base
     * @param {string} name - KB name
     * @param {string} [description] - Optional description
     * @returns {Promise<KnowledgeBase>} Created KB
     */
    async createKnowledgeBase(name, description = '') {
        const kb = {
            id: crypto.randomUUID(),
            name,
            description,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            documentCount: 0,
            totalChunks: 0,
            totalTokens: 0,
            embeddingModel: 'text-embedding-3-small'
        };

        await this.db.put('knowledgeBases', kb);
        return kb;
    }

    /**
     * Get all knowledge bases
     * @returns {Promise<KnowledgeBase[]>} Array of KBs
     */
    async getAllKnowledgeBases() {
        return await this.db.getAll('knowledgeBases');
    }

    /**
     * Get a knowledge base by ID
     * @param {string} kbId - KB ID
     * @returns {Promise<KnowledgeBase|null>} KB or null
     */
    async getKnowledgeBase(kbId) {
        return await this.db.get('knowledgeBases', kbId);
    }

    /**
     * Update a knowledge base
     * @param {KnowledgeBase} kb - KB to update
     * @returns {Promise<void>}
     */
    async updateKnowledgeBase(kb) {
        kb.updatedAt = Date.now();
        await this.db.put('knowledgeBases', kb);
    }

    /**
     * Delete a knowledge base and all its data
     * @param {string} kbId - KB ID
     * @returns {Promise<void>}
     */
    async deleteKnowledgeBase(kbId) {
        // Delete all chunks
        await this.db.deleteAllFromIndex('chunks', 'kbId', kbId);

        // Delete all documents
        await this.db.deleteAllFromIndex('documents', 'kbId', kbId);

        // Delete KB
        await this.db.delete('knowledgeBases', kbId);

        // Unload from memory
        this.vectorStore.unloadKnowledgeBase(kbId);

        // Remove from active KBs
        for (const [convId, kbIds] of this.activeKBs.entries()) {
            if (kbIds.has(kbId)) {
                kbIds.delete(kbId);
                if (kbIds.size === 0) {
                    this.activeKBs.delete(convId);
                }
            }
        }
    }

    /**
     * Activate a KB for a conversation
     * @param {string} conversationId - Conversation ID
     * @param {string} kbId - KB ID
     * @returns {Promise<void>}
     */
    async activateKBForConversation(conversationId, kbId) {
        // Load KB into memory if not already
        if (!this.vectorStore.isLoaded(kbId)) {
            await this.vectorStore.loadKnowledgeBase(kbId);
        }

        // Associate with conversation
        if (!this.activeKBs.has(conversationId)) {
            this.activeKBs.set(conversationId, new Set());
        }
        this.activeKBs.get(conversationId).add(kbId);

        // Persist association
        await this.db.put('conversationKB', {
            conversationId,
            kbId,
            active: true,
            addedAt: Date.now()
        });
    }

    /**
     * Deactivate a KB for a conversation
     * @param {string} conversationId - Conversation ID
     * @param {string} kbId - KB ID
     * @returns {Promise<void>}
     */
    async deactivateKBForConversation(conversationId, kbId) {
        const kbs = this.activeKBs.get(conversationId);
        if (kbs) {
            kbs.delete(kbId);
        }

        // Update in DB
        const assoc = await this.db.get('conversationKB', conversationId);
        if (assoc && assoc.kbId === kbId) {
            assoc.active = false;
            await this.db.put('conversationKB', assoc);
        }

        // Unload from memory if not used elsewhere
        const isUsedElsewhere = Array.from(this.activeKBs.values())
            .some(set => set.has(kbId));

        if (!isUsedElsewhere) {
            this.vectorStore.unloadKnowledgeBase(kbId);
        }
    }

    /**
     * Get active KBs for a conversation
     * @param {string} conversationId - Conversation ID
     * @returns {string[]} Array of active KB IDs
     */
    getActiveKBs(conversationId) {
        return Array.from(this.activeKBs.get(conversationId) || []);
    }

    /**
     * Load active KBs for a conversation from storage
     * @param {string} conversationId - Conversation ID
     * @returns {Promise<void>}
     */
    async loadActiveKBs(conversationId) {
        const assoc = await this.db.get('conversationKB', conversationId);
        if (assoc && assoc.active) {
            await this.activateKBForConversation(conversationId, assoc.kbId);
        }
    }

    /**
     * Handle model switch - adjust retrieval parameters
     * @param {string} conversationId - Conversation ID
     * @param {string} newModel - New model ID
     * @returns {Object} Adjusted retrieval parameters
     */
    onModelSwitch(conversationId, newModel) {
        const modelLimit = (typeof MODEL_CONTEXT_LIMITS !== 'undefined' && MODEL_CONTEXT_LIMITS[newModel])
            ? MODEL_CONTEXT_LIMITS[newModel]
            : 128000;

        if (modelLimit < 64000) {
            return { topK: 3, maxTokens: 1000 };
        } else if (modelLimit > 200000) {
            return { topK: 10, maxTokens: 4000 };
        }

        return { topK: 5, maxTokens: 2000 };
    }

    /**
     * Update KB metadata after document changes
     * @param {string} kbId - KB ID
     * @returns {Promise<void>}
     */
    async updateKBMetadata(kbId) {
        const docs = await this.db.getAllFromIndex('documents', 'kbId', kbId);
        const chunks = await this.db.getAllFromIndex('chunks', 'kbId', kbId);

        const kb = await this.db.get('knowledgeBases', kbId);
        if (kb) {
            kb.documentCount = docs.length;
            kb.totalChunks = chunks.length;
            kb.totalTokens = chunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0);
            kb.updatedAt = Date.now();
            await this.db.put('knowledgeBases', kb);
        }
    }
}

// ============================================
// File Lifecycle Manager
// ============================================

class FileLifecycleManager {
    constructor(ragDb, vectorStore, embeddingService) {
        this.db = ragDb;
        this.vectorStore = vectorStore;
        this.embeddingService = embeddingService;
        this.documentProcessor = new DocumentProcessor();
        this.kbManager = null; // Will be set by RAGSystem
    }

    /**
     * Add a file to a knowledge base
     * @param {string} kbId - KB ID
     * @param {File} file - File to add
     * @param {function} onProgress - Progress callback
     * @returns {Promise<Document>} Created document
     */
    async addFile(kbId, file, onProgress) {
        const docId = crypto.randomUUID();

        // Create document record
        const doc = {
            id: docId,
            kbId,
            filename: file.name,
            fileType: this.documentProcessor.getFileType(file.name),
            fileSize: file.size,
            status: 'processing',
            uploadedAt: Date.now(),
            lastAccessed: Date.now()
        };

        await this.db.put('documents', doc);

        try {
            if (onProgress) onProgress({ status: 'extracting', progress: 10, message: 'Extracting text...' });

            // Extract text
            const text = await this.documentProcessor.extractText(file);
            doc.extractedText = text;

            if (onProgress) onProgress({ status: 'chunking', progress: 30, message: 'Splitting into chunks...' });

            // Chunk text (use semantic chunking)
            // Q3 Fix: Filter empty or too short chunks
            const chunks = ChunkingStrategy.semantic(text).filter(c => c.trim().length > 20);

            if (chunks.length === 0) {
                throw new Error('No valid text content found to index');
            }

            if (onProgress) onProgress({ status: 'embedding', progress: 50, message: 'Generating embeddings...' });

            // Generate embeddings
            const embeddings = await this.embeddingService.generateEmbeddingsBatch(
                chunks,
                (current, total) => {
                    if (onProgress) {
                        const progress = 50 + Math.floor((current / total) * 40);
                        onProgress({ status: 'embedding', progress, message: `Embedding chunks (${current}/${total})...` });
                    }
                }
            );

            if (onProgress) onProgress({ status: 'storing', progress: 90, message: 'Storing chunks...' });

            // Store chunks
            const chunkRecords = chunks.map((content, i) => ({
                id: crypto.randomUUID(),
                kbId,
                docId,
                content,
                embedding: embeddings[i],
                startIndex: 0,
                endIndex: content.length,
                tokenCount: ChunkingStrategy.estimateTokens(content),
                metadata: {
                    pageNumber: embeddings[i]?.metadata?.pageNumber,
                    chunkIndex: i
                }
            }));

            for (const chunk of chunkRecords) {
                await this.db.put('chunks', chunk);
                // Also add to in-memory store if KB is loaded
                if (this.vectorStore.isLoaded(kbId)) {
                    this.vectorStore.addChunk(chunk);
                }
            }

            // Update document status
            doc.status = 'ready';
            doc.chunkCount = chunks.length;
            await this.db.put('documents', doc);

            // Update KB metadata
            if (this.kbManager) {
                await this.kbManager.updateKBMetadata(kbId);
            }

            if (onProgress) onProgress({ status: 'complete', progress: 100, message: 'Complete!' });

            return doc;

        } catch (error) {
            doc.status = 'error';
            doc.errorMessage = error.message;
            await this.db.put('documents', doc);

            if (onProgress) onProgress({ status: 'error', progress: 0, message: error.message });
            throw error;
        }
    }

    /**
     * Remove a file from a knowledge base
     * @param {string} kbId - KB ID
     * @param {string} docId - Document ID
     * @returns {Promise<void>}
     */
    async removeFile(kbId, docId) {
        // Delete chunks
        const chunks = await this.db.getAllFromIndex('chunks', 'docId', docId);
        for (const chunk of chunks) {
            await this.db.delete('chunks', chunk.id);
            // Remove from in-memory store
            this.vectorStore.removeChunk(chunk.id, kbId);
        }

        // Delete document
        await this.db.delete('documents', docId);

        // Update KB metadata
        if (this.kbManager) {
            await this.kbManager.updateKBMetadata(kbId);
        }
    }

    /**
     * Update a file (re-process)
     * @param {string} kbId - KB ID
     * @param {string} docId - Document ID
     * @param {File} newFile - New file
     * @param {function} onProgress - Progress callback
     * @returns {Promise<Document>} Updated document
     */
    async updateFile(kbId, docId, newFile, onProgress) {
        await this.removeFile(kbId, docId);
        return await this.addFile(kbId, newFile, onProgress);
    }

    /**
     * Get all documents in a KB
     * @param {string} kbId - KB ID
     * @returns {Promise<Document[]>} Array of documents
     */
    async getDocuments(kbId) {
        return await this.db.getAllFromIndex('documents', 'kbId', kbId);
    }

    /**
     * Get a document by ID
     * @param {string} docId - Document ID
     * @returns {Promise<Document|null>} Document or null
     */
    async getDocument(docId) {
        return await this.db.get('documents', docId);
    }
}

// ============================================
// Main RAG System
// ============================================

class RAGSystem {
    constructor() {
        this.db = new RAGDatabase();
        this.vectorStore = null;
        this.embeddingService = null;
        this.ragRetrieval = null;
        this.contextAssembler = null;
        this.kbManager = null;
        this.fileManager = null;
        this.initialized = false;
    }

    /**
     * Initialize the RAG system
     * @param {VeniceAPI} api - Venice API instance
     * @returns {Promise<void>}
     */
    async init(api) {
        if (this.initialized) return;

        // Initialize database
        await this.db.init();

        // Initialize components
        this.vectorStore = new VectorStore(this.db);
        this.embeddingService = new EmbeddingService(api);

        // Discover embedding model in background
        this.embeddingService.discoverEmbeddingModel();

        this.ragRetrieval = new RAGRetrieval(this.vectorStore, this.embeddingService);
        this.contextAssembler = new ContextAssembler();
        this.kbManager = new KnowledgeBaseManager(this.db, this.vectorStore);
        this.lifecycle = new FileLifecycleManager(this.db, this.vectorStore, this.embeddingService);
        this.lifecycle.kbManager = this.kbManager;

        this.initialized = true;
        console.log('[RAGSystem] Initialized successfully');
    }

    /**
     * Check if system is initialized
     * @returns {boolean}
     */
    isReady() {
        return this.initialized;
    }

    /**
     * Query the knowledge base
     * @param {string} query - User query
     * @param {Object} options - Query options
     * @returns {Promise<Object>} Query result with context and sources
     */
    async query(query, options = {}) {
        if (!this.initialized) {
            throw new Error('RAG system not initialized');
        }

        const {
            kbIds = null,
            topK = 5,
            similarityThreshold = 0.5,
            maxTokens = 2000,
            model = null
        } = options;

        // Q1 Fix: Lower similarity threshold if we are in fallback mode
        let effectiveThreshold = similarityThreshold;
        if (this.embeddingService.hasWarnedAboutFallback) {
            effectiveThreshold = Math.min(similarityThreshold, 0.2); // Pseudo-embeddings have low similarity
        }

        // Retrieve relevant chunks
        const retrievedChunks = await this.ragRetrieval.retrieve(query, {
            kbIds,
            topK,
            similarityThreshold: effectiveThreshold,
            maxTokens,
            model
        });

        // Assemble context
        const { context, sources } = this.contextAssembler.assembleContext(retrievedChunks, query);

        return {
            context,
            sources,
            chunks: retrievedChunks
        };
    }

    /**
     * Query and get formatted response with citations
     * @param {string} query - User query
     * @param {string} aiResponse - AI response text
     * @param {Object} options - Query options
     * @returns {Promise<string>} Formatted response with citations
     */
    async queryWithCitations(query, aiResponse, options = {}) {
        const { context, sources } = await this.query(query, options);
        return this.contextAssembler.formatWithCitations(aiResponse, sources);
    }
}

// Create global instance
window.ragSystem = new RAGSystem();
