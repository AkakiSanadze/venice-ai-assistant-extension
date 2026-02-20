/**
 * markdown-renderer.js
 * Lightweight Markdown to HTML parser with incremental rendering support
 */

const MarkdownRenderer = {
    // Cache for incremental rendering
    lastRenderedLength: 0,
    lastRenderedHtml: '',
    
    // Combined regex patterns for better performance
    patterns: {
        // All header levels in one pattern
        headers: /^(#{1,6})\s+(.*)$/gm,
        // Horizontal rule
        hr: /^\s*---+\s*$/gm,
        // Blockquote
        blockquote: /^>\s+(.*)$/gm,
        // Code blocks (multiline) - must be processed before inline code
        codeBlock: /```(?:(\w+)\n)?([\s\S]*?)```/g,
        // Inline code
        inlineCode: /`([^`]+)`/g,
        // Bold and italic combined
        boldItalic: /\*\*\*([^*]+)\*\*\*|___([^_]+)___/g,
        // Bold
        bold: /\*\*([^*]+)\*\*|__([^_]+)__/g,
        // Italic
        italic: /\*([^*]+)\*|_([^_]+)_/g,
        // Links
        link: /\[([^\]]+)\]\(([^)]+)\)/g,
        // Citations
        citation: /\[REF\](\d+)\[\/REF\]/g,
        // Unordered list
        unorderedList: /^\s*[-*]\s+(.*)$/gm,
        // Ordered list
        orderedList: /^\s*\d+\.\s+(.*)$/gm,
        // List items wrapper
        listItems: /(<li>.*<\/li>)+/g
    },

    render(markdown) {
        if (!markdown) return '';

        let html = markdown;
        
        // Step 1: Escape HTML (must be first)
        html = this.escapeHtml(html);
        
        // Step 2: Process code blocks first (they contain content that shouldn't be processed)
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
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
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
        // Headers (combined pattern for all levels)
        html = html.replace(this.patterns.headers, (match, hashes, content) => {
            const level = hashes.length;
            return `<h${level}>${content}</h${level}>`;
        });
        
        // Horizontal rule
        html = html.replace(this.patterns.hr, '<hr>');
        
        // Blockquotes
        html = html.replace(this.patterns.blockquote, '<blockquote>$1</blockquote>');
        
        // Lists (process both types)
        html = this.processLists(html);
        
        return html;
    },

    processLists(html) {
        // Convert list items
        html = html.replace(this.patterns.unorderedList, '<li>$1</li>');
        html = html.replace(this.patterns.orderedList, '<li>$1</li>');
        
        // Wrap consecutive list items
        html = html.replace(this.patterns.listItems, (match) => {
            // Check if this was an ordered list by looking at original markdown
            // Default to unordered since we can't easily determine after processing
            return `<ul>${match}</ul>`;
        });
        
        return html;
    },

    processInlineElements(html) {
        // Bold and italic (must be before individual bold/italic)
        html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
        
        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        
        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
        
        // Inline code (after code blocks)
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
            if (trimmed.startsWith('<')) return block; // Already wrapped in HTML
            if (!trimmed) return '';
            return `<p>${block.replace(/\n/g, '<br>')}</p>`;
        }).join('\n');
    },

    /**
     * Incremental render - only processes new content
     * @param {string} newContent - The new markdown content to render
     * @param {string} fullContent - The full markdown content
     * @returns {object} - { newHtml: string, isIncremental: boolean }
     */
    incrementalRender(newContent, fullContent) {
        // For incremental rendering, we need to handle partial markdown elements
        // This is complex because markdown elements can span multiple chunks
        
        const newLength = fullContent.length;
        
        // If content got shorter (e.g., regeneration), do full render
        if (newLength < this.lastRenderedLength) {
            this.lastRenderedLength = 0;
            this.lastRenderedHtml = '';
            return {
                html: this.render(fullContent),
                isIncremental: false
            };
        }
        
        // Get only the new part
        const newPart = fullContent.slice(this.lastRenderedLength);
        
        // Check for incomplete markdown elements at the boundary
        const processedNew = this.renderNewPart(newPart, fullContent);
        
        this.lastRenderedLength = newLength;
        this.lastRenderedHtml = this.lastRenderedHtml + processedNew;
        
        return {
            html: this.lastRenderedHtml,
            isIncremental: true,
            newPart: processedNew
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
                // Incomplete code block - render what we have so far as partial
                // We'll render it as a partial code block
                const beforeCode = newPart.slice(0, codeBlockStart);
                const codeContent = afterStart.slice(3); // Remove opening ```
                const rendered = this.render(beforeCode);
                return rendered + `<div class="code-block-container partial"><pre><code>${this.escapeHtml(codeContent)}</code></pre></div>`;
            }
        }
        
        // Check for incomplete inline code
        const backtickCount = (newPart.match(/`/g) || []).length;
        if (backtickCount % 2 !== 0) {
            // Odd number of backticks - likely incomplete inline code
            // Find the last backtick and render everything before it
            const lastBacktick = newPart.lastIndexOf('`');
            const beforeBacktick = newPart.slice(0, lastBacktick);
            const afterBacktick = newPart.slice(lastBacktick);
            return this.render(beforeBacktick) + afterBacktick;
        }
        
        // Check for incomplete bold/italic
        const asteriskCount = (newPart.match(/\*\*|\*/g) || []).length;
        if (asteriskCount % 2 !== 0) {
            // Incomplete - render what we can
            // This is a simplification - proper handling would be more complex
        }
        
        // No incomplete elements detected, render normally
        return this.render(newPart);
    },

    /**
     * Reset incremental rendering state
     */
    resetIncremental() {
        this.lastRenderedLength = 0;
        this.lastRenderedHtml = '';
    },

    // Attach event listeners for copy buttons after rendering
    setupListeners(container) {
        container.querySelectorAll('.copy-code-btn').forEach(btn => {
            btn.onclick = () => {
                const code = btn.nextElementSibling.querySelector('code').textContent;
                navigator.clipboard.writeText(code).then(() => {
                    btn.textContent = '✅';
                    setTimeout(() => btn.textContent = '📋', 2000);
                });
            };
        });
    }
};
