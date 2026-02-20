/**
 * markdown-worker.js
 * Web Worker for offloading markdown processing from the main thread
 * This improves UI responsiveness during heavy markdown rendering
 */

// Inline markdown renderer for the worker (no DOM access needed)
const WorkerMarkdownRenderer = {
    // Combined regex patterns for better performance
    patterns: {
        headers: /^(#{1,6})\s+(.*)$/gm,
        hr: /^\s*---+\s*$/gm,
        blockquote: /^>\s+(.*)$/gm,
        codeBlock: /```(?:(\w+)\n)?([\s\S]*?)```/g,
        inlineCode: /`([^`]+)`/g,
        boldItalic: /\*\*\*([^*]+)\*\*\*|___([^_]+)___/g,
        bold: /\*\*([^*]+)\*\*|__([^_]+)__/g,
        italic: /\*([^*]+)\*|_([^_]+)_/g,
        link: /\[([^\]]+)\]\(([^)]+)\)/g,
        citation: /\[REF\](\d+)\[\/REF\]/g,
        unorderedList: /^\s*[-*]\s+(.*)$/gm,
        orderedList: /^\s*\d+\.\s+(.*)$/gm,
        listItems: /(<li>.*<\/li>)+/g
    },

    render(markdown) {
        if (!markdown) return '';

        let html = markdown;
        
        // Step 1: Escape HTML (must be first)
        html = this.escapeHtml(html);
        
        // Step 2: Process code blocks first
        html = this.processCodeBlocks(html);
        
        // Step 3: Process block-level elements
        html = this.processBlockElements(html);
        
        // Step 4: Process inline elements
        html = this.processInlineElements(html);
        
        // Step 5: Wrap in paragraphs
        html = this.wrapParagraphs(html);
        
        return html;
    },

    escapeHtml(text) {
        return text
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>');
    },

    processCodeBlocks(html) {
        return html.replace(this.patterns.codeBlock, (match, lang, code) => {
            const languageClass = lang ? ` class="language-${lang}"` : '';
            return `<div class="code-block-container">
              <button class="copy-code-btn" title="Copy code">📋</button>
              <pre><code${languageClass}>${code.trim()}</code></pre>
            </div>`;
        });
    },

    processBlockElements(html) {
        // Headers
        html = html.replace(this.patterns.headers, (match, hashes, content) => {
            const level = hashes.length;
            return `<h${level}>${content}</h${level}>`;
        });
        
        // Horizontal rule
        html = html.replace(this.patterns.hr, '<hr>');
        
        // Blockquotes
        html = html.replace(this.patterns.blockquote, '<blockquote>$1</blockquote>');
        
        // Lists
        html = this.processLists(html);
        
        return html;
    },

    processLists(html) {
        html = html.replace(this.patterns.unorderedList, '<li>$1</li>');
        html = html.replace(this.patterns.orderedList, '<li>$1</li>');
        
        html = html.replace(this.patterns.listItems, (match) => {
            return `<ul>${match}</ul>`;
        });
        
        return html;
    },

    processInlineElements(html) {
        // Bold and italic
        html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
        
        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        
        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
        
        // Inline code
        html = html.replace(this.patterns.inlineCode, '<code>$1</code>');
        
        // Links
        html = html.replace(this.patterns.link, '<a href="$2" target="_blank">$1</a>');
        
        // Citations
        html = html.replace(this.patterns.citation, '<sup class="citation" data-ref="$1">$1</sup>');
        
        return html;
    },

    wrapParagraphs(html) {
        const blocks = html.split(/\n\n+/);
        return blocks.map(block => {
            const trimmed = block.trim();
            if (trimmed.startsWith('<')) return block;
            if (!trimmed) return '';
            return `<p>${block.replace(/\n/g, '<br>')}</p>`;
        }).join('\n');
    },

    /**
     * Incremental render - only processes new content
     */
    incrementalRender(newContent, fullContent, lastRenderedLength, lastRenderedHtml) {
        const newLength = fullContent.length;
        
        // If content got shorter, do full render
        if (newLength < lastRenderedLength) {
            return {
                html: this.render(fullContent),
                isIncremental: false,
                lastRenderedLength: 0,
                lastRenderedHtml: ''
            };
        }
        
        // Get only the new part
        const newPart = fullContent.slice(lastRenderedLength);
        
        // Check for incomplete markdown elements at the boundary
        const processedNew = this.renderNewPart(newPart, fullContent);
        
        const newHtml = lastRenderedHtml + processedNew;
        
        return {
            html: newHtml,
            isIncremental: true,
            newPart: processedNew,
            lastRenderedLength: newLength,
            lastRenderedHtml: newHtml
        };
    },

    /**
     * Render only the new part, handling partial elements
     */
    renderNewPart(newPart, fullContent) {
        // Check for incomplete code blocks
        const codeBlockStart = newPart.lastIndexOf('```');
        if (codeBlockStart !== -1) {
            const afterStart = newPart.slice(codeBlockStart);
            const codeBlockEnd = afterStart.indexOf('```', 3);
            if (codeBlockEnd === -1) {
                const beforeCode = newPart.slice(0, codeBlockStart);
                const codeContent = afterStart.slice(3);
                const rendered = this.render(beforeCode);
                return rendered + `<div class="code-block-container partial"><pre><code>${this.escapeHtml(codeContent)}</code></pre></div>`;
            }
        }
        
        // Check for incomplete inline code
        const backtickCount = (newPart.match(/`/g) || []).length;
        if (backtickCount % 2 !== 0) {
            const lastBacktick = newPart.lastIndexOf('`');
            const beforeBacktick = newPart.slice(0, lastBacktick);
            const afterBacktick = newPart.slice(lastBacktick);
            return this.render(beforeBacktick) + afterBacktick;
        }
        
        return this.render(newPart);
    }
};

// State for incremental rendering
let incrementalState = {
    lastRenderedLength: 0,
    lastRenderedHtml: ''
};

// Message handler
self.onmessage = function(e) {
    const { type, content, id, options } = e.data;
    
    switch (type) {
        case 'render':
            // Full render
            const html = WorkerMarkdownRenderer.render(content);
            self.postMessage({ type: 'rendered', result: html, id });
            break;
            
        case 'incremental':
            // Incremental render
            const result = WorkerMarkdownRenderer.incrementalRender(
                content.newContent,
                content.fullContent,
                incrementalState.lastRenderedLength,
                incrementalState.lastRenderedHtml
            );
            incrementalState.lastRenderedLength = result.lastRenderedLength;
            incrementalState.lastRenderedHtml = result.lastRenderedHtml;
            self.postMessage({ 
                type: 'rendered', 
                result: result.html, 
                id,
                isIncremental: result.isIncremental,
                newPart: result.newPart
            });
            break;
            
        case 'reset':
            // Reset incremental state
            incrementalState = {
                lastRenderedLength: 0,
                lastRenderedHtml: ''
            };
            self.postMessage({ type: 'reset', id });
            break;
            
        default:
            self.postMessage({ type: 'error', error: 'Unknown message type', id });
    }
};

// Signal that worker is ready
self.postMessage({ type: 'ready' });
