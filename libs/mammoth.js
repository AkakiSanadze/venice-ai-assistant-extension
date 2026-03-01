/**
 * mammoth.js - Minimal DOCX text extraction
 * Based on mammoth.js library (https://github.com/mwilliamson/mammoth.js)
 * Only includes extractRawText functionality for Chrome Extension use
 */

var mammoth = (function () {
    'use strict';

    // ZIP file parsing constants
    var ZIP_SIGNATURE_LOCAL_FILE_HEADER = 0x04034b50;
    var ZIP_SIGNATURE_CENTRAL_DIRECTORY = 0x02014b50;
    var ZIP_SIGNATURE_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

    // XML namespaces
    var NS_WORDS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    // Utility functions
    function readUInt16LE(data, offset) {
        return data[offset] | (data[offset + 1] << 8);
    }

    function readUInt32LE(data, offset) {
        return data[offset] |
            (data[offset + 1] << 8) |
            (data[offset + 2] << 16) |
            (data[offset + 3] << 24);
    }

    async function findZipEntries(arrayBuffer) {
        var data = new Uint8Array(arrayBuffer);
        var entries = [];
        var offset = 0;

        while (offset < data.length) {
            var signature = readUInt32LE(data, offset);

            if (signature === ZIP_SIGNATURE_LOCAL_FILE_HEADER) {
                var fileNameLength = readUInt16LE(data, offset + 26);
                var extraFieldLength = readUInt16LE(data, offset + 28);
                var compressedSize = readUInt32LE(data, offset + 18);
                var uncompressedSize = readUInt32LE(data, offset + 24);
                var compressionMethod = readUInt16LE(data, offset + 8);

                var fileName = '';
                for (var i = 0; i < fileNameLength; i++) {
                    fileName += String.fromCharCode(data[offset + 46 + i]);
                }

                var dataOffset = offset + 46 + fileNameLength + extraFieldLength;
                var fileData;

                if (compressionMethod === 0) {
                    // Stored (no compression)
                    fileData = data.slice(dataOffset, dataOffset + uncompressedSize);
                } else if (compressionMethod === 8) {
                    // Deflate - Use native DecompressionStream if available
                    try {
                        const compressedData = data.slice(dataOffset, dataOffset + compressedSize);
                        const ds = new DecompressionStream('deflate-raw');
                        const decompressedStream = new Response(compressedData).body.pipeThrough(ds);
                        const arrBuf = await new Response(decompressedStream).arrayBuffer();
                        fileData = new Uint8Array(arrBuf);
                    } catch (err) {
                        console.error('mammoth: DecompressionStream failed', err);
                        // Return empty data - caller should handle this as an error
                        fileData = new Uint8Array(0);
                    }
                } else {
                    // Unknown compression method - return empty data
                    fileData = new Uint8Array(0);
                }

                entries.push({
                    name: fileName,
                    data: fileData
                });

                offset = dataOffset + compressedSize;
            } else if (signature === ZIP_SIGNATURE_CENTRAL_DIRECTORY ||
                signature === ZIP_SIGNATURE_END_OF_CENTRAL_DIRECTORY) {
                break;
            } else {
                offset++;
            }
        }

        return entries;
    }

    function readXmlText(element) {
        if (!element) return '';

        var text = '';

        if (element.nodeType === 3) { // Text node
            text += element.nodeValue;
        } else if (element.nodeType === 1) { // Element node
            if (element.localName === 't' && element.namespaceURI === NS_WORDS) {
                text += element.textContent || '';
            }

            // Process children
            var child = element.firstChild;
            while (child) {
                text += readXmlText(child);
                child = child.nextSibling;
            }

            // Add space after block elements
            if (['p', 'pPr', 'tbl', 'tr', 'tc'].indexOf(element.localName) !== -1) {
                text += '\n';
            }
        }

        return text;
    }

    function parseDocumentXml(xmlText) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(xmlText, 'application/xml');

        // Find all paragraphs
        var paragraphs = doc.getElementsByTagNameNS(NS_WORDS, 'p');
        var text = '';

        for (var i = 0; i < paragraphs.length; i++) {
            text += readXmlText(paragraphs[i]) + '\n';
        }

        return text;
    }

    // Main API
    return {
        /**
         * Extract raw text from a DOCX file
         * @param {Object} options - Options object
         * @param {ArrayBuffer|Uint8Array} options.arrayBuffer - DOCX file data
         * @returns {Promise<{value: string, messages: Array}>} Extracted text
         */
        extractRawText: async function (options) {
            var arrayBuffer = options.arrayBuffer;

            try {
                var entries = await findZipEntries(arrayBuffer);

                // Find word/document.xml
                var documentEntry = null;
                for (var i = 0; i < entries.length; i++) {
                    if (entries[i].name === 'word/document.xml') {
                        documentEntry = entries[i];
                        break;
                    }
                }

                if (!documentEntry) {
                    return { value: '', messages: [{ type: 'warning', message: 'No document.xml found in DOCX' }] };
                }

                // Convert Uint8Array to string
                var xmlText = '';
                var data = documentEntry.data;
                for (var j = 0; j < data.length; j++) {
                    xmlText += String.fromCharCode(data[j]);
                }

                var text = parseDocumentXml(xmlText);

                // Clean up whitespace
                text = text.replace(/\n{3,}/g, '\n\n').trim();

                return { value: text, messages: [] };

            } catch (error) {
                return { value: '', messages: [{ type: 'error', message: error.message }] };
            }
        },

        /**
         * Extract raw text from ArrayBuffer
         * @param {ArrayBuffer} arrayBuffer - DOCX file data
         * @returns {Promise<{value: string, messages: Array}>} Extracted text
         */
        extractRawTextFromArrayBuffer: function (arrayBuffer) {
            return this.extractRawText({ arrayBuffer: arrayBuffer });
        }
    };

})();

// Export for use in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = mammoth;
}
