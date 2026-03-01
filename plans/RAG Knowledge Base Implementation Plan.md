Created comprehensive RAG Knowledge Base implementation plan. Here's the complete document for `plans/rag-knowledge-base.md`:

```markdown
# RAG Knowledge Base Implementation Plan

## Overview
Implement a Retrieval-Augmented Generation (RAG) system that allows users to upload their own documents (PDF, DOCX, TXT, MD) and receive AI responses based solely on those documents. The system must support long-running sessions, dynamic file management, and adapt to model context window changes.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    RAG Knowledge Base                       │
├─────────────────────────────────────────────────────────────┤
│  File Upload → Text Extraction → Chunking → Embeddings      │
│       ↓                                                        │
│  IndexedDB Storage (Chunks + Vectors)                         │
│       ↓                                                        │
│  User Query → Embedding → Similarity Search → Top K Results   │
│       ↓                                                        │
│  Context Assembly → AI Response                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Storage Architecture

### 1.1 Database Schema (IndexedDB)

```javascript
// Database: VeniceRAG
// Version: 1

const stores = {
  // Knowledge bases collection
  knowledgeBases: {
    keyPath: 'id',
    indexes: ['name', 'createdAt', 'updatedAt']
  },
  
  // Documents within a KB
  documents: {
    keyPath: 'id',
    indexes: ['kbId', 'filename', 'uploadedAt', 'status']
  },
  
  // Text chunks with embeddings
  chunks: {
    keyPath: 'id',
    indexes: ['kbId', 'docId', 'embedding'] // embedding for vector search
  },
  
  // Conversation-KB associations
  conversationKB: {
    keyPath: 'conversationId',
    indexes: ['kbId', 'active']
  }
};
```

### 1.2 Data Structures

```typescript
interface KnowledgeBase {
  id: string;                    // UUID
  name: string;                  // User-defined name
  description?: string;          // Optional description
  createdAt: number;             // Timestamp
  updatedAt: number;             // Timestamp
  totalChunks: number;           // Cached count
  totalTokens: number;           // Cached token count
  embeddingModel: string;        // Model used for embeddings
}

interface Document {
  id: string;                    // UUID
  kbId: string;                  // Parent KB
  filename: string;              // Original filename
  fileType: 'pdf' | 'docx' | 'txt' | 'md';
  fileSize: number;              // Bytes
  extractedText: string;         // Full text (compressed if large)
  status: 'processing' | 'ready' | 'error';
  chunkCount: number;            // Number of chunks
  uploadedAt: number;
  lastAccessed: number;
  errorMessage?: string;
}

interface Chunk {
  id: string;                    // UUID
  kbId: string;                  // Parent KB
  docId: string;                 // Parent document
  content: string;               // Chunk text
  embedding: number[];           // Vector (384-dim for lightweight, 768/1536 for high quality)
  startIndex: number;            // Position in original doc
  endIndex: number;
  tokenCount: number;
  metadata: {
    pageNumber?: number;
    section?: string;
    heading?: string;
  };
}

interface ConversationKB {
  conversationId: string;
  kbId: string;
  active: boolean;               // Is this KB currently active for the conversation?
  addedAt: number;
}
```

### 1.3 Vector Storage Strategy

Since IndexedDB doesn't support native vector search, implement in-memory search with persistence:

```javascript
class VectorStore {
  constructor() {
    this.chunks = new Map();      // id -> chunk
    this.vectors = [];            // Array for similarity search
    this.kbIndex = new Map();     // kbId -> Set(chunkIds)
  }
  
  // Load all chunks for a KB into memory
  async loadKnowledgeBase(kbId) {
    const chunks = await db.getAllFromIndex('chunks', 'kbId', kbId);
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
      this.vectors.push({
        id: chunk.id,
        vector: chunk.embedding
      });
    }
    this.kbIndex.set(kbId, new Set(chunks.map(c => c.id)));
  }
  
  // Cosine similarity search
  search(queryEmbedding, topK = 5, kbIds = null) {
    const candidates = kbIds 
      ? kbIds.flatMap(kbId => Array.from(this.kbIndex.get(kbId) || []))
      : Array.from(this.chunks.keys());
    
    const scores = candidates.map(id => ({
      id,
      score: cosineSimilarity(queryEmbedding, this.chunks.get(id).embedding)
    }));
    
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(result => ({
        ...this.chunks.get(result.id),
        similarity: result.score
      }));
  }
  
  // Unload KB from memory (when switched off)
  unloadKnowledgeBase(kbId) {
    const chunkIds = this.kbIndex.get(kbId);
    if (!chunkIds) return;
    
    for (const id of chunkIds) {
      this.chunks.delete(id);
    }
    this.vectors = this.vectors.filter(v => !chunkIds.has(v.id));
    this.kbIndex.delete(kbId);
  }
}
```

---

## Phase 2: File Processing Pipeline

### 2.1 Text Extraction

```javascript
class DocumentProcessor {
  async extractText(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    
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
  
  async extractPDF(file) {
    // Use existing PDFParser
    const arrayBuffer = await file.arrayBuffer();
    const result = await PDFParser.extractText(arrayBuffer);
    return result.pages.map(p => p.text).join('\n\n');
  }
  
  async extractDOCX(file) {
    // Use mammoth.js or similar library
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }
}
```

### 2.2 Smart Chunking

```javascript
class ChunkingStrategy {
  // Option 1: Fixed size with overlap
  static fixedSize(text, chunkSize = 1000, overlap = 200) {
    const chunks = [];
    let start = 0;
    
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start = end - overlap;
    }
    
    return chunks;
  }
  
  // Option 2: Semantic chunking (by paragraphs/sections)
  static semantic(text) {
    // Split by headers, then paragraphs
    const sections = text.split(/(?=#{1,3}\s)/);  // Markdown headers
    const chunks = [];
    
    for (const section of sections) {
      const paragraphs = section.split('\n\n');
      let currentChunk = '';
      
      for (const para of paragraphs) {
        if (currentChunk.length + para.length > 1000) {
          chunks.push(currentChunk.trim());
          currentChunk = para;
        } else {
          currentChunk += '\n\n' + para;
        }
      }
      
      if (currentChunk) chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }
  
  // Option 3: Recursive character chunking (best for code)
  static recursive(text, separators = ['\n\n', '\n', '. ', ' ']) {
    // Implementation from LangChain's recursive splitter
  }
}
```

### 2.3 Embedding Generation

```javascript
class EmbeddingService {
  constructor(api) {
    this.api = api;
    this.cache = new Map(); // Cache embeddings to avoid re-computation
  }
  
  async generateEmbedding(text) {
    // Check cache first
    const hash = await this.hashText(text);
    if (this.cache.has(hash)) {
      return this.cache.get(hash);
    }
    
    // Use Venice AI's embedding endpoint (if available)
    // OR use a lightweight local model
    const response = await fetch('https://api.venice.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.api.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small', // or Venice's embedding model
        input: text
      })
    });
    
    const { data } = await response.json();
    const embedding = data[0].embedding;
    
    // Cache and return
    this.cache.set(hash, embedding);
    return embedding;
  }
  
  // Batch processing for efficiency
  async generateEmbeddingsBatch(texts, onProgress) {
    const embeddings = [];
    const batchSize = 10; // Process in batches
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await Promise.all(
        batch.map(text => this.generateEmbedding(text))
      );
      embeddings.push(...batchEmbeddings);
      
      if (onProgress) {
        onProgress(Math.min(i + batchSize, texts.length), texts.length);
      }
      
      // Rate limiting delay
      if (i + batchSize < texts.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    return embeddings;
  }
}
```

---

## Phase 3: Retrieval System

### 3.1 Query Processing

```javascript
class RAGRetrieval {
  constructor(vectorStore, embeddingService) {
    this.vectorStore = vectorStore;
    this.embeddingService = embeddingService;
  }
  
  async retrieve(query, options = {}) {
    const {
      kbIds = null,           // Which KBs to search
      topK = 5,               // Number of chunks to retrieve
      similarityThreshold = 0.7, // Minimum similarity score
      maxTokens = 2000,       // Max tokens to return (for context fitting)
      model = null            // Current model (for token limit adaptation)
    } = options;
    
    // 1. Generate query embedding
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);
    
    // 2. Search vector store
    let results = this.vectorStore.search(queryEmbedding, topK * 2, kbIds);
    
    // 3. Filter by similarity threshold
    results = results.filter(r => r.similarity >= similarityThreshold);
    
    // 4. Adapt to model context window
    if (model) {
      results = this.adaptToModelContext(results, model, maxTokens);
    }
    
    // 5. Rerank (optional - can use cross-encoder)
    results = this.rerankResults(query, results);
    
    return results.slice(0, topK);
  }
  
  adaptToModelContext(results, model, maxTokens) {
    const modelLimit = MODEL_CONTEXT_LIMITS[model] || 128000;
    const safeLimit = modelLimit * 0.3; // Use 30% of context for RAG
    
    let totalTokens = 0;
    const adapted = [];
    
    for (const result of results) {
      const tokens = estimateTokens(result.content);
      if (totalTokens + tokens > safeLimit) break;
      adapted.push(result);
      totalTokens += tokens;
    }
    
    return adapted;
  }
  
  rerankResults(query, results) {
    // Simple reranking by similarity + recency + diversity
    return results.sort((a, b) => {
      // Boost exact keyword matches
      const queryWords = query.toLowerCase().split(' ');
      const aMatches = queryWords.filter(w => a.content.toLowerCase().includes(w)).length;
      const bMatches = queryWords.filter(w => b.content.toLowerCase().includes(w)).length;
      
      const aScore = a.similarity + (aMatches * 0.1);
      const bScore = b.similarity + (bMatches * 0.1);
      
      return bScore - aScore;
    });
  }
}
```

### 3.2 Context Assembly

```javascript
class ContextAssembler {
  assembleContext(retrievedChunks, query) {
    // Deduplicate and sort by document
    const byDocument = this.groupByDocument(retrievedChunks);
    
    let context = '[Knowledge Base Context]\n\n';
    
    for (const [docId, chunks] of Object.entries(byDocument)) {
      const doc = getDocument(docId);
      context += `## Source: ${doc.filename}\n\n`;
      
      for (const chunk of chunks) {
        context += chunk.content + '\n\n';
      }
      
      context += '---\n\n';
    }
    
    context += `[User Query: ${query}]\n\n`;
    context += 'Please answer the user query using ONLY the information provided above. ';
    context += 'If the answer is not in the provided context, say "I cannot find information about this in your documents."';
    
    return context;
  }
  
  groupByDocument(chunks) {
    return chunks.reduce((acc, chunk) => {
      if (!acc[chunk.docId]) acc[chunk.docId] = [];
      acc[chunk.docId].push(chunk);
      return acc;
    }, {});
  }
}
```

---

## Phase 4: Long-Running Session Management

### 4.1 Knowledge Base Persistence

```javascript
class KnowledgeBaseManager {
  constructor() {
    this.activeKBs = new Map(); // conversationId -> Set(kbIds)
    this.vectorStore = new VectorStore();
  }
  
  // Load KB for a conversation
  async activateKBForConversation(conversationId, kbId) {
    // Load into memory if not already loaded
    if (!this.vectorStore.kbIndex.has(kbId)) {
      await this.vectorStore.loadKnowledgeBase(kbId);
    }
    
    // Associate with conversation
    if (!this.activeKBs.has(conversationId)) {
      this.activeKBs.set(conversationId, new Set());
    }
    this.activeKBs.get(conversationId).add(kbId);
    
    // Persist association
    await db.put('conversationKB', {
      conversationId,
      kbId,
      active: true,
      addedAt: Date.now()
    });
  }
  
  // Deactivate KB for conversation
  async deactivateKBForConversation(conversationId, kbId) {
    const kbs = this.activeKBs.get(conversationId);
    if (kbs) {
      kbs.delete(kbId);
    }
    
    // Update in DB
    const assoc = await db.get('conversationKB', conversationId);
    if (assoc && assoc.kbId === kbId) {
      assoc.active = false;
      await db.put('conversationKB', assoc);
    }
    
    // Unload from memory if no other conversation uses it
    const isUsedElsewhere = Array.from(this.activeKBs.values())
      .some(set => set.has(kbId));
    
    if (!isUsedElsewhere) {
      this.vectorStore.unloadKnowledgeBase(kbId);
    }
  }
  
  // Get active KBs for conversation
  getActiveKBs(conversationId) {
    return Array.from(this.activeKBs.get(conversationId) || []);
  }
  
  // Handle model switch - adjust retrieval parameters
  onModelSwitch(conversationId, newModel) {
    // Adjust topK and maxTokens based on new model's context window
    const modelLimit = MODEL_CONTEXT_LIMITS[newModel] || 128000;
    
    if (modelLimit < 64000) {
      // Small context model - reduce retrieved chunks
      return { topK: 3, maxTokens: 1000 };
    } else if (modelLimit > 200000) {
      // Large context model - can use more chunks
      return { topK: 10, maxTokens: 4000 };
    }
    
    return { topK: 5, maxTokens: 2000 }; // Default
  }
}
```

### 4.2 File Lifecycle Management

```javascript
class FileLifecycleManager {
  // Add file to KB
  async addFile(kbId, file) {
    const docId = crypto.randomUUID();
    
    // 1. Create document record
    const doc = {
      id: docId,
      kbId,
      filename: file.name,
      fileType: file.name.split('.').pop(),
      fileSize: file.size,
      status: 'processing',
      uploadedAt: Date.now()
    };
    
    await db.put('documents', doc);
    
    try {
      // 2. Extract text
      const text = await documentProcessor.extractText(file);
      doc.extractedText = text;
      
      // 3. Chunk text
      const chunks = ChunkingStrategy.semantic(text);
      
      // 4. Generate embeddings
      const embeddings = await embeddingService.generateEmbeddingsBatch(
        chunks,
        (current, total) => this.onProgress(docId, current, total)
      );
      
      // 5. Store chunks
      const chunkRecords = chunks.map((content, i) => ({
        id: crypto.randomUUID(),
        kbId,
        docId,
        content,
        embedding: embeddings[i],
        startIndex: 0, // Calculate actual positions
        endIndex: content.length,
        tokenCount: estimateTokens(content)
      }));
      
      for (const chunk of chunkRecords) {
        await db.put('chunks', chunk);
      }
      
      // 6. Update document status
      doc.status = 'ready';
      doc.chunkCount = chunks.length;
      await db.put('documents', doc);
      
      // 7. Update KB metadata
      await this.updateKBMetadata(kbId);
      
      return doc;
      
    } catch (error) {
      doc.status = 'error';
      doc.errorMessage = error.message;
      await db.put('documents', doc);
      throw error;
    }
  }
  
  // Remove file from KB
  async removeFile(kbId, docId) {
    // 1. Delete chunks
    const chunks = await db.getAllFromIndex('chunks', 'docId', docId);
    for (const chunk of chunks) {
      await db.delete('chunks', chunk.id);
    }
    
    // 2. Delete document
    await db.delete('documents', docId);
    
    // 3. Update KB metadata
    await this.updateKBMetadata(kbId);
    
    // 4. Reload KB in memory if active
    if (vectorStore.kbIndex.has(kbId)) {
      vectorStore.unloadKnowledgeBase(kbId);
      await vectorStore.loadKnowledgeBase(kbId);
    }
  }
  
  // Update file (re-process)
  async updateFile(kbId, docId, newFile) {
    // Remove old version
    await this.removeFile(kbId, docId);
    
    // Add new version
    return await this.addFile(kbId, newFile);
  }
  
  async updateKBMetadata(kbId) {
    const docs = await db.getAllFromIndex('documents', 'kbId', kbId);
    const chunks = await db.getAllFromIndex('chunks', 'kbId', kbId);
    
    const kb = await db.get('knowledgeBases', kbId);
    kb.totalChunks = chunks.length;
    kb.totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
    kb.updatedAt = Date.now();
    
    await db.put('knowledgeBases', kb);
  }
}
```

---

## Phase 5: UI/UX Design

### 5.1 Knowledge Base Manager UI

```html
<!-- New View: knowledge-base-view -->
<div id="knowledge-base-view" class="sub-view hidden">
  <div class="kb-header">
    <h2>Knowledge Bases</h2>
    <button id="create-kb-btn" class="btn btn-primary">Create New</button>
  </div>
  
  <div class="kb-list">
    <!-- List of knowledge bases -->
  </div>
  
  <!-- KB Detail Panel -->
  <div id="kb-detail-panel" class="hidden">
    <div class="kb-info">
      <input type="text" id="kb-name" placeholder="KB Name">
      <textarea id="kb-description" placeholder="Description"></textarea>
    </div>
    
    <div class="kb-files">
      <h3>Files</h3>
      <div id="kb-file-list"></div>
      <button id="add-file-btn" class="btn btn-secondary">Add Files</button>
    </div>
    
    <div class="kb-stats">
      <span>Total Chunks: <span id="kb-total-chunks">0</span></span>
      <span>Total Tokens: <span id="kb-total-tokens">0</span></span>
    </div>
  </div>
</div>
```

### 5.2 Chat Integration

```html
<!-- In chat view, add KB selector -->
<div class="kb-selector">
  <button id="kb-toggle-btn" class="btn btn-icon">
    📚 <span id="active-kb-count">0</span>
  </button>
  <div id="kb-dropdown" class="dropdown hidden">
    <div class="kb-dropdown-header">Active Knowledge Bases</div>
    <div id="kb-dropdown-list"></div>
    <div class="kb-dropdown-footer">
      <button id="manage-kb-btn">Manage Knowledge Bases</button>
    </div>
  </div>
</div>

<!-- Context indicator showing RAG status -->
<div id="rag-context-indicator" class="hidden">
  <span class="rag-badge">📄 <span id="rag-source-count">0</span> sources</span>
  <button id="view-rag-sources">View</button>
</div>
```

### 5.3 Source Citation in Responses

```javascript
// Add citation markers to retrieved chunks
function formatResponseWithCitations(response, sources) {
  // Find which sources were actually used in the response
  const usedSources = sources.filter(source => 
    response.toLowerCase().includes(source.content.slice(0, 50).toLowerCase())
  );
  
  if (usedSources.length === 0) return response;
  
  let formatted = response + '\n\n---\n\n**Sources:**\n';
  usedSources.forEach((source, i) => {
    formatted += `[${i + 1}] ${source.metadata.filename}`;
    if (source.metadata.pageNumber) {
      formatted += ` (Page ${source.metadata.pageNumber})`;
    }
    formatted += '\n';
  });
  
  return formatted;
}
```

---

## Phase 6: API Integration Strategy

### 6.1 Venice AI Embedding API

```javascript
// If Venice AI supports embeddings:
async function getEmbeddings(texts) {
  const response = await fetch('https://api.venice.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small', // Check Venice's available models
      input: texts
    })
  });
  
  const data = await response.json();
  return data.data.map(d => d.embedding);
}
```

### 6.2 Alternative: Local Embedding (Privacy)

```javascript
// Use transformers.js for local embeddings
import { pipeline } from '@xenova/transformers';

class LocalEmbeddingService {
  async init() {
    this.embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2' // 384-dim, lightweight
    );
  }
  
  async generate(text) {
    const output = await this.embedder(text, {
      pooling: 'mean',
      normalize: true
    });
    return output.data;
  }
}
```

---

## Implementation Checklist

### Phase 1: Core Storage ✅
- [ ] Set up IndexedDB schema
- [ ] Implement VectorStore class
- [ ] Create knowledge base CRUD operations

### Phase 2: Document Processing ✅
- [ ] Implement text extraction (PDF, DOCX, TXT)
- [ ] Create chunking strategies
- [ ] Integrate embedding service

### Phase 3: Retrieval ✅
- [ ] Implement similarity search
- [ ] Create context assembly
- [ ] Add model-aware adaptation

### Phase 4: Session Management ✅
- [ ] KB persistence across sessions
- [ ] File lifecycle management
- [ ] Model switch handling

### Phase 5: UI ✅
- [ ] Knowledge base manager view
- [ ] Chat integration
- [ ] Source citations

### Phase 6: Testing ✅
- [ ] Large file handling (100+ pages)
- [ ] Multiple KB switching
- [ ] Model context adaptation

---

## Key Challenges & Solutions

| Challenge | Solution |
|-----------|----------|
| **Memory limits** (Chrome Extension) | Load/unload KBs dynamically, use IndexedDB |
| **Embedding costs** | Cache embeddings, batch processing |
| **Search performance** | In-memory vectors, cosine similarity optimization in Web Worker |
| **File updates** | Versioning system, incremental updates |
| **Model context limits** | Adaptive retrieval based on model capacity |
| **Privacy** | Rely only on Venice API (local embeddings violate MV3 CSP) |

---

## Dependencies to Add

```json
{
  "dependencies": {
    "mammoth": "^1.6.0"        // DOCX parsing
  }
}
```
```

The complete RAG Knowledge Base plan has been created. It addresses all the complexities you mentioned:
- Long-running sessions with persistence
- Dynamic file management (add/remove/update)
- Model switching with context adaptation
- Memory management for Chrome Extension constraints
- Source citations and transparency