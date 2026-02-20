/**
 * print-page.js
 * Reads stored conversation HTML from localStorage and renders it for printing.
 * This runs as an extension page script (no CSP issues with inline scripts).
 */

(function () {
    const htmlContent = localStorage.getItem('venice_print_content');

    if (!htmlContent) {
        document.body.innerHTML = '<p style="font-family:sans-serif;padding:40px;color:#666;">No content to print. Please try exporting again from the Venice AI sidebar.</p>';
        return;
    }

    // Parse the stored HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Update the page title
    document.title = doc.title || 'Venice AI — Print';

    // Copy <style> blocks into this page's <head>
    doc.querySelectorAll('style').forEach(function (styleEl) {
        const newStyle = document.createElement('style');
        newStyle.textContent = styleEl.textContent;
        document.head.appendChild(newStyle);
    });

    // Copy body content (only elements, no <script> tags)
    const container = document.getElementById('print-container');
    Array.from(doc.body.childNodes).forEach(function (node) {
        // Skip script elements — they're blocked anyway and not needed
        if (node.nodeName === 'SCRIPT') return;
        container.appendChild(document.importNode(node, true));
    });

    // Bind the print button (if present)
    var printBtn = document.getElementById('print-btn');
    if (printBtn) {
        printBtn.addEventListener('click', function () {
            window.print();
        });
    }

    // Clean up localStorage entry
    localStorage.removeItem('venice_print_content');

    // Auto-trigger print dialog after content renders
    window.addEventListener('load', function () {
        setTimeout(function () {
            window.print();
        }, 500);
    });
})();
