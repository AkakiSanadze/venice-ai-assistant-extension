/**
 * pdf-export.js
 * HTML-to-PDF Export using browser's built-in print functionality
 * 
 * This module handles exporting conversations to PDF format via HTML.
 * Supports Georgian and all Unicode characters natively.
 */

const PDFExport = {
    /**
     * Format timestamp to readable date string
     */
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },
    
    /**
     * Escape HTML special characters to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Convert markdown to simple HTML for print output
     * Basic conversion for better readability in printed documents
     */
    markdownToHtml(text) {
        if (!text) return '';
        
        // Escape HTML first
        let html = this.escapeHtml(text);
        
        // Convert code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
            return `<pre class="code-block"><code>${code}</code></pre>`;
        });
        
        // Convert inline code
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        
        // Convert headers
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        
        // Convert bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        
        // Convert italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
        
        // Convert links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        
        // Convert unordered lists
        html = html.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
        
        // Convert ordered lists
        html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li>$1</li>');
        
        // Convert horizontal rules
        html = html.replace(/^[-*_]{3,}$/gm, '<hr>');
        
        // Convert line breaks to paragraphs (for non-block content)
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');
        
        // Wrap in paragraph if not already wrapped
        if (!html.startsWith('<')) {
            html = '<p>' + html + '</p>';
        }
        
        return html;
    },
    
    /**
     * Generate the complete HTML document for printing
     */
    generateHTML(conversation) {
        const title = conversation.title || 'Conversation';
        const exportDate = new Date().toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Build messages HTML
        let messagesHtml = '';
        
        for (const msg of conversation.messages) {
            const role = msg.role === 'user' ? 'User' : 'Assistant';
            const roleClass = msg.role === 'user' ? 'user-message' : 'assistant-message';
            const timestamp = this.formatTimestamp(msg.timestamp || Date.now());
            const modelName = msg.modelName || 'AI';
            const content = this.markdownToHtml(msg.content);
            
            messagesHtml += `
                <div class="message ${roleClass}">
                    <div class="message-header">
                        <span class="role-badge ${msg.role}">${role}</span>
                        ${msg.role === 'assistant' ? `<span class="model-name">${modelName}</span>` : ''}
                        <span class="timestamp">${timestamp}</span>
                    </div>
                    <div class="message-content">
                        ${content}
                    </div>
            `;
            
            // Add thinking section if present
            if (msg.role === 'assistant' && msg.thinking && msg.thinking.trim()) {
                const thinkingContent = this.escapeHtml(msg.thinking);
                messagesHtml += `
                    <div class="thinking-section">
                        <div class="thinking-header">💭 Thinking Process</div>
                        <div class="thinking-content">${thinkingContent.replace(/\n/g, '<br>')}</div>
                    </div>
                `;
            }
            
            messagesHtml += `</div>`;
        }
        
        // Complete HTML document with print styles
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(title)}</title>
    <style>
        /* Base styles */
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1a1a1a;
            background: #fff;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }
        
        /* Header */
        .document-header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e0e0e0;
        }
        
        .document-header h1 {
            font-size: 24px;
            color: #1a1a1a;
            margin-bottom: 8px;
        }
        
        .document-header .export-info {
            font-size: 12px;
            color: #666;
        }
        
        /* Messages */
        .message {
            margin-bottom: 24px;
            padding: 16px;
            border-radius: 8px;
            page-break-inside: avoid;
        }
        
        .user-message {
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
        }
        
        .assistant-message {
            background: #f5f5f5;
            border-left: 4px solid #4caf50;
        }
        
        .message-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            flex-wrap: wrap;
        }
        
        .role-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 16px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .role-badge.user {
            background: #2196f3;
            color: white;
        }
        
        .role-badge.assistant {
            background: #4caf50;
            color: white;
        }
        
        .model-name {
            font-size: 11px;
            color: #666;
            background: #e0e0e0;
            padding: 2px 8px;
            border-radius: 4px;
        }
        
        .timestamp {
            font-size: 11px;
            color: #888;
            margin-left: auto;
        }
        
        .message-content {
            font-size: 14px;
            line-height: 1.7;
            color: #333;
        }
        
        .message-content p {
            margin-bottom: 12px;
        }
        
        .message-content p:last-child {
            margin-bottom: 0;
        }
        
        /* Code blocks */
        .code-block {
            background: #f8f8f8;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 12px;
            margin: 12px 0;
            overflow-x: auto;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 13px;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .inline-code {
            background: #f0f0f0;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 13px;
        }
        
        /* Headers in content */
        .message-content h1,
        .message-content h2,
        .message-content h3 {
            margin: 16px 0 8px 0;
            color: #1a1a1a;
        }
        
        .message-content h1 { font-size: 18px; }
        .message-content h2 { font-size: 16px; }
        .message-content h3 { font-size: 14px; }
        
        /* Lists */
        .message-content ul,
        .message-content ol {
            margin: 12px 0;
            padding-left: 24px;
        }
        
        .message-content li {
            margin-bottom: 4px;
        }
        
        /* Links */
        .message-content a {
            color: #1976d2;
            text-decoration: none;
        }
        
        .message-content a:hover {
            text-decoration: underline;
        }
        
        /* Thinking section */
        .thinking-section {
            margin-top: 16px;
            padding: 12px;
            background: #fff8e1;
            border: 1px solid #ffcc80;
            border-radius: 6px;
            font-size: 13px;
        }
        
        .thinking-header {
            font-weight: 600;
            color: #e65100;
            margin-bottom: 8px;
        }
        
        .thinking-content {
            color: #666;
            font-style: italic;
            line-height: 1.6;
        }
        
        /* Footer */
        .document-footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
            text-align: center;
            font-size: 11px;
            color: #888;
        }
        
        /* Print button */
        .print-actions {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1000;
        }
        
        .print-btn {
            background: #1976d2;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .print-btn:hover {
            background: #1565c0;
        }
        
        .print-btn svg {
            width: 18px;
            height: 18px;
        }
        
        /* Auto-print notice */
        .auto-print-notice {
            position: fixed;
            top: 80px;
            right: 20px;
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 6px;
            padding: 8px 14px;
            font-size: 12px;
            color: #856404;
            z-index: 999;
        }
        
        /* Print styles */
        @media print {
            /* Hide print button */
            .print-actions {
                display: none !important;
            }
            
            /* Reset backgrounds for printing */
            body {
                padding: 0;
                max-width: none;
            }
            
            .user-message {
                background: #f5f5f5 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            
            .assistant-message {
                background: #fff !important;
                border: 1px solid #e0e0e0;
            }
            
            .role-badge.user {
                background: #2196f3 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            
            .role-badge.assistant {
                background: #4caf50 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            
            .thinking-section {
                background: #fff8e1 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            
            /* Page breaks */
            .message {
                page-break-inside: avoid;
                break-inside: avoid;
            }
            
            h1, h2, h3 {
                page-break-after: avoid;
            }
            
            .document-header {
                page-break-after: avoid;
            }
            
            /* Ensure proper margins */
            @page {
                margin: 1.5cm;
                size: A4;
            }
            
            /* Footer on each page */
            .document-footer {
                position: running(footer);
            }
            
            @page {
                @bottom-center {
                    content: "Exported from Venice AI Assistant";
                    font-size: 10px;
                    color: #888;
                }
            }
        }
        
        /* Mobile styles */
        @media screen and (max-width: 600px) {
            body {
                padding: 10px;
            }
            
            .message {
                padding: 12px;
            }
            
            .message-header {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .timestamp {
                margin-left: 0;
            }
            
            .print-actions {
                top: 10px;
                right: 10px;
            }
            
            .print-btn {
                padding: 10px 16px;
                font-size: 13px;
            }
        }
    </style>
</head>
<body>
    <div class="print-actions">
        <button id="print-btn" class="print-btn">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            🖨️ Print / Save as PDF
        </button>
    </div>
    
    <div class="document-header">
        <h1>${this.escapeHtml(title)}</h1>
        <div class="export-info">Exported on ${exportDate} · Venice AI Assistant</div>
    </div>
    
    <div class="messages-container">
        ${messagesHtml}
    </div>
    
    <div class="document-footer">
        <p>Generated by Venice AI Assistant</p>
    </div>
</body>
</html>`;
    },
    
    /**
     * Export conversation to HTML and open in the extension's dedicated print page.
     * Stores HTML in localStorage then opens print-page.html (an extension page)
     * which reads it, renders it, and auto-triggers window.print().
     * This avoids ALL CSP issues since print-page.js is a proper extension script.
     * @param {Object} conversation - The conversation object with title and messages
     * @returns {Promise<{success: boolean}>}
     */
    async exportToHTML(conversation) {
        if (!conversation || !conversation.messages || conversation.messages.length === 0) {
            throw new Error('Conversation is empty');
        }
        
        const html = this.generateHTML(conversation);
        
        // Store generated HTML in localStorage — shared across all extension pages
        localStorage.setItem('venice_print_content', html);
        
        // Open the extension's dedicated print page
        // print-page.js will read from localStorage and auto-print
        const printPageUrl = chrome.runtime.getURL('print-page.html');
        const newTab = window.open(printPageUrl, '_blank');
        
        if (!newTab) {
            localStorage.removeItem('venice_print_content');
            throw new Error('Could not open print window. Please allow popups for this extension.');
        }
        
        return { success: true };
    },
    
    /**
     * Export and download conversation as PDF via HTML
     * This is the main entry point, kept for compatibility with existing code
     */
    async downloadPDF(conversation) {
        try {
            const result = await this.exportToHTML(conversation);
            return { 
                success: true, 
                filename: `conversation-${new Date().toISOString().split('T')[0]}.pdf`,
                method: 'html-print'
            };
        } catch (error) {
            console.error('HTML export error:', error);
            throw error;
        }
    }
};

// Export for use in other modules
window.PDFExport = PDFExport;
