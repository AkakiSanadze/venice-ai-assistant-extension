# PDF & Image Limits Removal Plan

## Goal
Remove hard limits on PDF and image uploads. Users should be able to upload files of any size, while the system makes intelligent decisions based on the model's context limit.

---

## Expected User Experience

### Before Changes
- PDFs truncated at 15,000 characters (loss of content)
- No visibility into context usage
- Hard error when exceeding limits

### After Changes
| User Action | System Behavior |
|-------------|-----------------|
| Upload large PDF | Full PDF processed; context bar shows usage |
| Upload many images | Model-specific limits with "Force Upload" option |
| Context filling up | Color-coded bar (green→yellow→orange→red) |
| Context overflow | Smart modal with truncation options |
| Large PDF + text | Automatic chunking with user choice |

---

## Why Web Workers Are Critical

**Problem:** Token estimation on large PDFs (100+ pages) can freeze the UI for seconds.

**Solution:** Offload all token counting and PDF chunking to a Web Worker to keep the main thread responsive.

**Operations that MUST run in Web Worker:**
1. Token estimation for PDFs (any PDF over ~10 pages)
2. PDF chunking and strategy evaluation
3. Context validation before send

---

## Implementation Priority

| Priority | Item | Reason |
|----------|------|--------|
| 1 | Web Worker Setup | Foundation for everything else |
| 2 | Context Calculator | Powers all downstream features |
| **1.5** | **Multi-PDF Support** | **Enable multiple PDF uploads (array-based like images)** |
| 3 | Remove PDF Limit | Core code change |
| 4 | Image Limits | Model-specific validation |
| 5 | Context Bar + Colors | User-facing visibility |
| 6 | Smart Truncation | Handling overflow scenarios |

---

## Phase 1: Architecture & Foundation

### 1.1 Web Worker Setup

Create `pdf-worker.js` to handle heavy computation off the main thread:

```javascript
// pdf-worker.js
self.onmessage = async function(e) {
  const { action, payload } = e.data;
  
  switch (action) {
    case 'estimateTokens':
      const tokens = estimateTokens(payload.content);
      self.postMessage({ action: 'tokensEstimated', tokens });
      break;
      
    case 'chunkPDF':
      const chunks = chunkPDF(payload.content, payload.strategy, payload.maxTokens);
      self.postMessage({ action: 'pdfChunked', chunks });
      break;
      
    case 'validateContext':
      const validation = await validateContext(payload);
      self.postMessage({ action: 'contextValidated', validation });
      break;
  }
};

function estimateTokens(text) {
  // ~4 characters per token average
  return Math.ceil(text.length / 4);
}

function chunkPDF(content, strategy, maxTokens) {
  const pages = content.split('\n\n');
  let result = [];
  let currentChunk = '';
  let currentTokens = 0;
  
  for (const page of pages) {
    const pageTokens = estimateTokens(page);
    
    if (currentTokens + pageTokens > maxTokens && currentChunk) {
      result.push(currentChunk);
      currentChunk = page;
      currentTokens = pageTokens;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + page;
      currentTokens += pageTokens;
    }
  }
  
  if (currentChunk) result.push(currentChunk);
  return result;
}

async function validateContext(payload) {
  const { text, pdf, images, modelLimit } = payload;
  
  let estimatedTokens = estimateTokens(text);
  
  if (pdf) {
    estimatedTokens += estimateTokens(pdf);
  }
  
  if (images) {
    // Vision: ~765 tokens per image (standard size)
    estimatedTokens += images.length * 765;
  }
  
  return {
    willFit: estimatedTokens <= modelLimit,
    usedTokens: estimatedTokens,
    limit: modelLimit,
    overflow: Math.max(0, estimatedTokens - modelLimit)
  };
}
```

Initialize in `sidebar.js`:

```javascript
// In constructor or init method
this.pdfWorker = new Worker('pdf-worker.js');
this.pdfWorker.onmessage = this.handleWorkerMessage.bind(this);
```

### 1.2 Context Calculator

Add to `sidebar.js`:

```javascript
async validateContextBeforeSend(content, attachments) {
  return new Promise((resolve) => {
    const handler = (e) => {
      if (e.data.action === 'contextValidated') {
        this.pdfWorker.removeEventListener('message', handler);
        resolve(e.data.validation);
      }
    };
    
    this.pdfWorker.addEventListener('message', handler);
    this.pdfWorker.postMessage({
      action: 'validateContext',
      payload: {
        text: content,
        pdf: attachments?.pdf,
        images: attachments?.images,
        modelLimit: this.api.getContextLimit(this.currentModel)
      }
    });
  });
}
```

---

## Phase 1.5: Multi-PDF Support (Enable Multiple PDF Uploads)

### Problem Identified

| Current Behavior | Expected Behavior |
|------------------|-------------------|
| `this.attachedPdfContent = null` (single variable, Line 658 in sidebar.js) | `this.attachedPdfs = []` (array like images) |
| `handlePdfUpload(e)` only takes first file: `const file = e.target.files[0];` | Loop through ALL files like `handleImageUpload()` does |
| Single PDF display with one remove button | Multiple PDFs with per-file removal |
| No PDF labels on send | Labels like "[PDF 1: filename]", "[PDF 2: filename]" |

### Why This Matters

- Images already support multiple uploads via `this.attachedImages = []`
- PDFs should follow the same pattern for consistency
- Users frequently need to attach multiple documents for analysis
- Current implementation silently ignores all but the first PDF

### Implementation

#### 1. Storage Change (Line 658)

```javascript
// Before:
this.attachedPdfContent = null;

// After:
this.attachedPdfs = []; // Array like images
```

#### 2. PDF Upload Handler (Lines 6167-6168)

```javascript
// Before:
async handlePdfUpload(e) {
    const file = e.target.files[0];
    // ... single file logic
}

// After:
async handlePdfUpload(e) {
    for (const file of e.target.files) {
        if (file.type !== 'application/pdf') continue;
        await this.addPdfFile(file);
    }
    // Clear input to allow re-uploading same file
    this.els.pdfUpload.value = '';
}
```

#### 3. New `addPdfFile()` Method (similar to image handling)

```javascript
async addPdfFile(file) {
    // Check if PDF already attached
    if (this.attachedPdfs.some(p => p.name === file.name)) {
        this.showToast('PDF already attached', 'info');
        return;
    }
    
    try {
        const result = await this.extractPdfContent(file);
        const content = result.pages.map(p => p.text).join('\n\n');
        
        this.attachedPdfs.push({
            name: file.name,
            content: content,
            size: file.size,
            date: new Date(),
            pageCount: result.pages.length
        });
        
        this.renderAttachedPdfs();
        this.updateContextUsage();
    } catch (error) {
        console.error('PDF processing error:', error);
        this.showToast('Failed to process PDF', 'error');
    }
}
```

#### 4. New `renderAttachedPdfs()` Function

```javascript
renderAttachedPdfs() {
    const container = this.els.attachedPdfs;
    
    if (this.attachedPdfs.length === 0) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    
    container.classList.remove('hidden');
    container.innerHTML = this.attachedPdfs.map((pdf, index) => `
        <div class="attached-pdf-item" data-index="${index}">
            <div class="pdf-icon">📄</div>
            <div class="pdf-info">
                <span class="pdf-name">${pdf.name}</span>
                <span class="pdf-meta">${pdf.pageCount} pages</span>
            </div>
            <button class="remove-pdf-btn" data-index="${index}" aria-label="Remove PDF">×</button>
        </div>
    `).join('');
    
    // Bind remove buttons
    container.querySelectorAll('.remove-pdf-btn').forEach(btn => {
        btn.onclick = () => {
            const index = parseInt(btn.dataset.index);
            this.removePdf(index);
        };
    });
}

removePdf(index) {
    this.attachedPdfs.splice(index, 1);
    this.renderAttachedPdfs();
    this.updateContextUsage();
}
```

#### 5. Send Logic Update (Lines 4215-4220)

```javascript
// Before:
if (this.attachedPdfContent) {
    content += `\n\n[PDF Content for Analysis]:\n${this.attachedPdfContent.substring(0, 15000)}`;
    this.attachedPdfContent = null;
    this.els.attachedPdf.classList.add('hidden');
}

// After:
if (this.attachedPdfs.length > 0) {
    this.attachedPdfs.forEach((pdf, index) => {
        content += `\n\n[PDF ${index + 1}: ${pdf.name}]:\n${pdf.content}`;
    });
    this.attachedPdfs = [];
    this.renderAttachedPdfs();
}
```

#### 6. Context Calculator Update (for multiple PDFs)

```javascript
// In validateContext (Web Worker or main thread)
calculateContextUsage() {
    // ... existing code ...
    
    // Update PDF handling
    let pdfTokens = 0;
    this.attachedPdfs.forEach(pdf => {
        // ~4 characters per token
        pdfTokens += Math.ceil(pdf.content.length / 4);
    });
    
    return {
        // ... existing properties ...
        pdfTokens: pdfTokens,
        pdfCount: this.attachedPdfs.length
    };
}
```

### UI Updates Required

| File | Change |
|------|--------|
| `sidebar.html` | Change `#attached-pdf` to `#attached-pdfs` (plural), make it a container |
| `styles.css` | Add `.attached-pdf-item` styles similar to `.attached-image-preview` |

#### HTML Changes

```html
<!-- Before (Line 248): -->
<div id="attached-pdf" class="attached-pdf hidden" role="status" aria-live="polite"></div>

<!-- After: -->
<div id="attached-pdfs" class="attached-pdfs hidden" role="group" aria-label="Attached PDFs"></div>
```

#### CSS Additions

```css
/* Multi-PDF display */
.attached-pdfs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.attached-pdf-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  font-size: 13px;
}

.attached-pdf-item .pdf-icon {
  font-size: 16px;
}

.attached-pdf-item .pdf-info {
  display: flex;
  flex-direction: column;
  max-width: 150px;
}

.attached-pdf-item .pdf-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attached-pdf-item .pdf-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.attached-pdf-item .remove-pdf-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 18px;
  padding: 0 4px;
  line-height: 1;
}

.attached-pdf-item .remove-pdf-btn:hover {
  color: var(--error);
}
```

### Sidebar.js Element Binding Update

```javascript
// Line 750 - Update element reference
attachedPdfs: document.getElementById('attached-pdfs'),
```

---

## Phase 2: Remove PDF Limit

### Changes

**File:** `sidebar.js`  
**Line:** 4216

```javascript
// Current:
content += `\n\n[PDF Content for Analysis]:\n${this.attachedPdfContent.substring(0, 15000)}`;

// New:
content += `\n\n[PDF Content for Analysis]:\n${this.attachedPdfContent}`;
```

---

## Phase 3: Image Limits

### Vision API Limits (by model)

```javascript
const VISION_LIMITS = {
  'claude-sonnet-45': { maxImages: 20, maxSizeMB: 20 },
  'claude-opus-45': { maxImages: 20, maxSizeMB: 20 },
  'gpt-4o': { maxImages: 10, maxSizeMB: 20 },
  'default': { maxImages: 5, maxSizeMB: 20 }
};
```

### Validation

```javascript
validateImageCount(images, forceBypass = false) {
  const limits = VISION_LIMITS[this.currentModel] || VISION_LIMITS.default;
  
  if (!forceBypass && this.attachedImages.length + images.length > limits.maxImages) {
    // Add a fallback/bypass mechanism for VISION_LIMITS so users can force upload if the hardcoded limits are outdated.
    this.showToastWithAction(
      `Model "${this.currentModel}" accepts maximum ${limits.maxImages} images.`,
      'Force Upload',
      () => this.forceUploadImages(images)
    );
    return false;
  }
  
  // Size check
  for (const img of images) {
    const sizeMB = (img.base64.length * 0.75) / 1024 / 1024;
    if (sizeMB > limits.maxSizeMB) {
      this.showToast(`Image too large (max ${limits.maxSizeMB}MB)`, 'error');
      return false;
    }
  }
  
  return true;
}
```

---

## Phase 4: Context Bar UI (with Color System)

### New Context Bar Design

**CRITICAL: Use `transform: scaleX()` instead of animating the `width` property for performance (avoiding repaint/reflow).**

```javascript
updateContextUsage() {
  const context = this.calculateContextUsage();
  
  const html = `
    <div class="context-bar-container">
      <div class="context-bar ${context.warningClass}"
           style="transform: scaleX(${context.percentage / 100}); transform-origin: left;"></div>
    </div>
    <div class="context-details">
      <span class="context-text">
        ${context.used.toLocaleString()} / ${context.limit.toLocaleString()} tokens
      </span>
      ${context.pdfTokens ? `<span class="context-badge">PDF: ${context.pdfTokens}</span>` : ''}
      ${context.imageTokens ? `<span class="context-badge">Images: ${context.imageTokens}</span>` : ''}
    </div>
  `;
  
  this.els.contextContainer.innerHTML = html;
}
```

### Smart Warnings (Context Bar Color System)

Context bar colors clearly indicate the situation to the user:

| Color | Percentage | Status | Message |
|-------|------------|--------|---------|
| 🟢 **Green** | < 60% | Normal | "Everything is good" |
| 🟡 **Yellow** | 60-80% | Warning | "Attention - context is filling up" |
| 🟠 **Orange** | 80-95% | Caution | "You may need to clear context" |
| 🔴 **Red** | > 95% | Critical | "Partial PDF/image upload recommended" |

### Implementation

```javascript
// CSS class assignment
getWarningClass(percentage) {
  if (percentage < 60) return 'context-normal';
  if (percentage < 80) return 'context-warning';
  if (percentage < 95) return 'context-caution';
  return 'context-critical';
}

// CSS styles
.context-normal { background: var(--success); }
.context-warning { background: var(--warning); }
.context-caution { background: var(--orange); }
.context-critical { background: var(--error); }

// Detailed message
getContextMessage(percentage) {
  const messages = {
    normal: 'Everything is good',
    warning: 'Attention - context is filling up',
    caution: 'You may need to clear context',
    critical: 'Partial PDF/image upload recommended'
  };
  
  if (percentage < 60) return messages.normal;
  if (percentage < 80) return messages.warning;
  if (percentage < 95) return messages.caution;
  return messages.critical;
}
```

### UX Behavior

| Context % | Behavior |
|-----------|----------|
| 🟢 < 60% | Normal operation, no restrictions |
| 🟡 60-80% | Soft warning, user is informed |
| 🟠 80-95% | Active warning + show "clear" button |
| 🔴 > 95% | Show modal before upload, suggest automatic truncation |

### Smart Handling Modal

New UI element for context overflow:

```javascript
showContextOverflowModal(contextInfo) {
  const options = [
    {
      label: 'Use First Pages',
      action: () => this.useFirstPages(contextInfo.pdfContent, contextInfo.limit)
    },
    {
      label: 'Use Last Pages (Conclusions)',
      action: () => this.useLastPages(contextInfo.pdfContent, contextInfo.limit)
    },
    {
      label: 'Split into Chunks',
      action: () => this.splitPDFIntoChunks(contextInfo.pdfContent)
    },
    {
      label: 'Switch to Larger Context Model',
      action: () => this.suggestLargerModel(contextInfo.usedTokens)
    }
  ];
  
  this.renderContextModal(options);
}
```

---

## Phase 5: Smart Truncation

### PDF Chunking Strategies

**CRITICAL: All chunking operations MUST run in the Web Worker to prevent UI freezing.**

```javascript
// In pdf-worker.js
class PDFChunker {
  static strategies = {
    firstPages: (content, maxTokens) => {
      const pages = content.split('\n\n');
      let result = [];
      let tokens = 0;
      
      for (const page of pages) {
        const pageTokens = estimateTokens(page);
        if (tokens + pageTokens > maxTokens) break;
        result.push(page);
        tokens += pageTokens;
      }
      
      return result.join('\n\n');
    },
    
    lastPages: (content, maxTokens) => {
      // Same logic, reverse order
    },
    
    summaryFirst: async (content, maxTokens) => {
      // Short summary + first pages
    }
  };
}
```

---

## Phase 6: Testing Plan

| Category | Tests |
|----------|-------|
| **PDF Tests** | Upload 100+ page PDF, check context overflow modal, verify smart truncation |
| **Image Tests** | Upload 20+ images with Claude, 10+ with GPT-4o, check size validation |
| **Integration** | PDF + Images + Text together, context calculator accuracy |
| **Performance** | Large PDF processing doesn't freeze UI (Web Worker verification) |

---

## Dependencies
- No new libraries required
- Uses existing `venice-api.js` for token estimation
- UI only requires new modal and context bar improvements
- **New:** `pdf-worker.js` for background processing

---

## Files to Modify

| File | Changes |
|------|---------|
| `sidebar.js` | Core logic: change `attachedPdfContent` to `attachedPdfs` array, update handlers, add `renderAttachedPdfs()`, update send logic |
| `styles.css` | Add `.attached-pdfs` container and `.attached-pdf-item` styles |
| `sidebar.html` | Change `#attached-pdf` to `#attached-pdfs` (plural), update class and aria attributes |
| `pdf-worker.js` | **NEW** - Token estimation and PDF chunking |

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Thread (UI)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Sidebar.js  │  │ Context Bar │  │ Modal Handlers      │  │
│  │ - PDFs []   │  │             │  │                     │  │
│  │ - Images [] │  │             │  │                     │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                          │                                   │
│                          ▼                                   │
│              ┌───────────────────────┐                       │
│              │   Message Passing     │                       │
│              └───────────┬───────────┘                       │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   Web Worker (Background)                      │
│  ┌──────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Token Estimation│  │ PDF Chunking   │  │ Validation   │  │
│  │ (multi-PDF)     │  │                │  │              │  │
│  └──────────────────┘  └────────────────┘  └──────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

This architecture ensures the UI remains responsive while processing large PDFs and calculating context usage.

---

## Phase 1.5 Summary

| Aspect | Details |
|--------|---------|
| **Goal** | Enable multiple PDF uploads (like images) |
| **Storage** | `attachedPdfs = []` (array, not single null) |
| **Upload** | Loop through all files in `handlePdfUpload()` |
| **Display** | `renderAttachedPdfs()` renders list with remove buttons |
| **Send** | Each PDF labeled `[PDF N: filename]` |
| **Consistency** | Follows same pattern as `attachedImages` |
