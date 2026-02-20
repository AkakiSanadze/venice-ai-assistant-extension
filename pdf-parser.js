/**
 * pdf-parser.js
 * PDF Text Extraction using PDF.js
 */

const PDFParser = {
    async extractText(source, pageNumbers = null) {
        // Wait for pdf.js to be loaded
        if (!window.pdfjsLib) {
            await new Promise((resolve, reject) => {
                const checkInterval = setInterval(() => {
                    if (window.pdfjsLib) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                setTimeout(() => {
                    clearInterval(checkInterval);
                    reject(new Error('PDF.js library not loaded'));
                }, 5000);
            });
        }

        try {
            // Specify worker source
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.mjs';

            const loadingTask = window.pdfjsLib.getDocument(source);
            const pdf = await loadingTask.promise;
            const totalPages = pdf.numPages;

            const result = {
                totalPages,
                pages: []
            };

            const pagesToProcess = pageNumbers || Array.from({ length: totalPages }, (_, i) => i + 1);

            for (const pageNum of pagesToProcess) {
                if (pageNum < 1 || pageNum > totalPages) continue;

                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                const text = textContent.items.map(item => item.str).join(' ');

                result.pages.push({
                    pageNum,
                    text: text.replace(/\s+/g, ' ').trim()
                });
            }

            return result;
        } catch (e) {
            console.error('PDF Parsing failed', e);
            throw new Error('PDF-ის წაკითხვა ვერ მოხერხდა: ' + e.message);
        }
    }
};
