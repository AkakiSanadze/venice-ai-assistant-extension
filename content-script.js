/**
 * content-script.js
 * Page Interaction Layer for Venice AI Assistant
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {
        case 'getPageContent':
            const mainContent = extractMainContent();
            sendResponse({
                title: document.title,
                url: location.href,
                content: mainContent
            });
            break;

        case 'getYouTubeTranscript':
            getYouTubeTranscript().then(transcript => {
                sendResponse({ transcript, title: document.title });
            }).catch(err => {
                sendResponse({ error: err.message });
            });
            return true; // Keep channel open for async

        case 'getTwitterData':
            getTwitterPosts(msg.options || {}).then(posts => {
                sendResponse({ success: true, tweets: posts, url: location.href });
            }).catch(err => {
                sendResponse({ success: false, error: err.message });
            });
            return true; // Keep channel open for async
    }
});

function extractMainContent() {
    // Simple heuristic to extract main text
    const selectors = ['article', 'main', '.content', '#content', '.post', '.article'];
    let container = null;

    for (const s of selectors) {
        container = document.querySelector(s);
        if (container) break;
    }

    if (!container) container = document.body;

    // Clone and clean
    const clone = container.cloneNode(true);
    const toRemove = clone.querySelectorAll('nav, footer, aside, script, style, ad, .ad, .social');
    toRemove.forEach(el => el.remove());

    return clone.innerText.replace(/\s+/g, ' ').trim().slice(0, 15000); // Limit context
}

/**
 * Extract JSON object from YouTube script content using brace matching
 * This handles nested objects and strings containing semicolons
 */
function extractYouTubeJson(scriptContent, variableName) {
    // Method 1: Try regex extraction with brace matching
    const patterns = [
        new RegExp(`${variableName}\\s*=\\s*\\{`, 'g'),
        new RegExp(`var\\s+${variableName}\\s*=\\s*\\{`, 'g')
    ];
    
    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(scriptContent);
        if (match) {
            const startIndex = match.index + match[0].length - 1; // Position of opening brace
            const jsonStr = extractJsonObject(scriptContent, startIndex);
            if (jsonStr) {
                console.log(`[Transcript] Extracted JSON via ${pattern.source}`);
                return jsonStr;
            }
        }
    }
    
    // Method 2: Fallback to improved split method
    try {
        const parts = scriptContent.split(`${variableName} = `);
        if (parts.length > 1) {
            const afterVar = parts[1];
            const jsonStr = extractJsonObject(afterVar, 0);
            if (jsonStr) {
                console.log('[Transcript] Extracted JSON via split fallback');
                return jsonStr;
            }
        }
    } catch (e) {
        console.warn('[Transcript] Fallback extraction failed:', e);
    }
    
    return null;
}

/**
 * Extract a complete JSON object starting from a given position
 * Uses brace counting to handle nested objects
 */
function extractJsonObject(str, startPos) {
    if (str[startPos] !== '{') {
        // Find the first opening brace
        const bracePos = str.indexOf('{', startPos);
        if (bracePos === -1) return null;
        startPos = bracePos;
    }
    
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = startPos; i < str.length; i++) {
        const char = str[i];
        
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        
        if (char === '\\' && inString) {
            escapeNext = true;
            continue;
        }
        
        if (char === '"') {
            inString = !inString;
            continue;
        }
        
        if (!inString) {
            if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) {
                    // Found the closing brace
                    return str.substring(startPos, i + 1);
                }
            }
        }
    }
    
    console.warn('[Transcript] Could not find closing brace, JSON may be truncated');
    return null;
}

/**
 * Fetch transcript via MAIN world execution (page context with cookies)
 * Routes through background service worker which uses chrome.scripting.executeScript
 * with world: 'MAIN' to run fetch in the page context (bypasses CSP, includes cookies).
 */
function fetchInPageContext(url) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { action: 'fetchInPageContext', url },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response) {
                    reject(new Error('No response from background'));
                    return;
                }
                // Log diagnostic info
                console.log(`[Transcript] MAIN world fetch result: status=${response.status}, length=${response.length}, ok=${response.ok}`);
                if (response.error) {
                    reject(new Error(response.error));
                    return;
                }
                resolve(response.text);
            }
        );
    });
}

/**
 * Get fresh caption tracks from MAIN world's live player response
 * This avoids stale URLs from cached script tags
 */
function getFreshCaptionTracks() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { action: 'getPlayerResponseFromMainWorld' },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Transcript] Failed to get MAIN world player response:', chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                }
                if (response && response.captionTracks) {
                    console.log('[Transcript] Got fresh caption tracks from MAIN world:', response.captionTracks.length, 'tracks');
                    if (response.source) {
                        console.log('[Transcript] Source:', response.source);
                    }
                    resolve(response.captionTracks);
                } else {
                    console.warn('[Transcript] No caption tracks from MAIN world:', response?.error);
                    resolve(null);
                }
            }
        );
    });
}

/**
 * Parse YouTube caption XML response
 */
function parseCaptionXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    
    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        console.warn('[Transcript] XML parse error:', parseError.textContent);
        return null;
    }
    
    // Extract text from <text> elements
    const textElements = doc.querySelectorAll('text');
    if (textElements.length === 0) {
        // Try <p> elements (timedtext format)
        const pElements = doc.querySelectorAll('p');
        if (pElements.length > 0) {
            return Array.from(pElements)
                .map(p => p.textContent)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
        return null;
    }
    
    return Array.from(textElements)
        .map(t => {
            // Decode HTML entities
            const text = t.textContent
                .replace(/&/g, '&')
                .replace(/</g, '<')
                .replace(/>/g, '>')
                .replace(/'/g, "'")
                .replace(/"/g, '"');
            return text;
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Try fetching transcript with different format parameters
 * Uses page context fetch to include YouTube session cookies
 */
async function fetchTranscriptWithFormats(baseUrl) {
    // Different format parameters to try
    const formats = [
        { param: 'json3', type: 'json' },
        { param: 'json', type: 'json' },
        { param: 'srv1', type: 'xml' },
        { param: 'srv2', type: 'xml' },
        { param: 'srv3', type: 'xml' },
        { param: '', type: 'xml' }  // No format param (default XML)
    ];
    
    // Clean the base URL - remove existing format parameter if present
    let cleanUrl = baseUrl.split('&fmt=')[0].split('&format=')[0];
    
    for (const format of formats) {
        try {
            const url = format.param ? `${cleanUrl}&fmt=${format.param}` : cleanUrl;
            console.log(`[Transcript] Trying format: ${format.param || 'default'}`);
            
            // Use page context fetch to include YouTube cookies
            const text = await fetchInPageContext(url);
            
            if (!text || text.trim().length === 0) {
                console.warn(`[Transcript] Empty response for format ${format.param}`);
                continue;
            }
            
            console.log(`[Transcript] Got response for format ${format.param}, length: ${text.length}`);
            
            // Try to parse based on expected type
            if (format.type === 'json') {
                try {
                    const data = JSON.parse(text);
                    if (data.events && Array.isArray(data.events)) {
                        console.log(`[Transcript] Successfully parsed JSON format: ${format.param}`);
                        return data.events
                            .filter(e => e.segs)
                            .map(e => e.segs.map(s => s.utf8).join(''))
                            .join(' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                    }
                } catch (jsonErr) {
                    console.warn(`[Transcript] JSON parse failed for ${format.param}:`, jsonErr.message);
                    // Might be XML despite json format param, try XML parsing
                    const xmlResult = parseCaptionXml(text);
                    if (xmlResult) {
                        console.log(`[Transcript] Parsed as XML despite JSON format param`);
                        return xmlResult;
                    }
                }
            } else {
                // Try XML parsing
                const xmlResult = parseCaptionXml(text);
                if (xmlResult) {
                    console.log(`[Transcript] Successfully parsed XML format: ${format.param || 'default'}`);
                    return xmlResult;
                }
            }
        } catch (e) {
            console.warn(`[Transcript] Failed for format ${format.param}:`, e.message);
        }
    }
    
    return null;
}

async function getYouTubeTranscript() {
    if (!location.hostname.includes('youtube.com') || !location.search.includes('v=')) {
        throw new Error('Not a YouTube video page');
    }

    // Method 0: Try to get transcript from DOM if panel is already open
    try {
        console.log('[Transcript] Method 0: Checking for visible transcript panel in DOM');
        const segments = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text, .cue-group .cue');
        if (segments.length > 0) {
            const text = Array.from(segments).map(s => s.innerText || s.textContent).filter(t => t && t.trim()).join(' ');
            if (text.length > 50) {
                console.log('[Transcript] Method 0 (DOM) succeeded, length:', text.length);
                return text.replace(/\s+/g, ' ').trim();
            }
        }
        
        // Also try transcript search panel
        const transcriptItems = document.querySelectorAll('.transcript-item, ytd-transcript-search-panel-renderer .segment-text');
        if (transcriptItems.length > 0) {
            const text = Array.from(transcriptItems).map(s => s.innerText || s.textContent).filter(t => t && t.trim()).join(' ');
            if (text.length > 50) {
                console.log('[Transcript] Method 0 (DOM transcript panel) succeeded, length:', text.length);
                return text.replace(/\s+/g, ' ').trim();
            }
        }
    } catch (e) {
        console.warn('[Transcript] Method 0 (DOM) failed:', e);
    }

    // Method 1: Use YouTube InnerTube API (get_transcript endpoint)
    // This is the most reliable method - it's what YouTube's own UI uses
    // and doesn't depend on timedtext URL tokens which expire
    try {
        const videoId = new URLSearchParams(location.search).get('v');
        if (videoId) {
            console.log('[Transcript] Method 1: Trying InnerTube API for video:', videoId);
            const innerTubeResult = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { action: 'fetchTranscriptViaInnerTube', videoId },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            console.warn('[Transcript] InnerTube message error:', chrome.runtime.lastError.message);
                            resolve(null);
                            return;
                        }
                        resolve(response);
                    }
                );
            });
            
            if (innerTubeResult && innerTubeResult.transcript && innerTubeResult.transcript.length > 0) {
                console.log('[Transcript] Method 1 (InnerTube) succeeded, length:', innerTubeResult.transcript.length);
                return innerTubeResult.transcript;
            }
            console.warn('[Transcript] Method 1 (InnerTube) failed:', innerTubeResult?.error, 'responseKeys:', innerTubeResult?.responseKeys);
        }
    } catch (e) {
        console.warn('[Transcript] Method 1 failed:', e);
    }

    // Method 2: Try timedtext URL from fresh MAIN world player response
    try {
        const freshTracks = await getFreshCaptionTracks();
        if (freshTracks && freshTracks.length > 0) {
            console.log('[Transcript] Method 2: Using fresh MAIN world caption tracks');
            console.log('[Transcript] Fresh baseUrl:', freshTracks[0].baseUrl.substring(0, 100) + '...');
            
            const transcript = await fetchTranscriptWithFormats(freshTracks[0].baseUrl);
            if (transcript && transcript.length > 0) {
                console.log('[Transcript] Method 2 succeeded, length:', transcript.length);
                return transcript;
            }
            console.warn('[Transcript] Method 2: All format attempts failed with fresh tracks');
        }
    } catch (e) {
        console.warn('[Transcript] Method 2 failed:', e);
    }

    // Method 3: Try timedtext URL from script tag (ytInitialPlayerResponse)
    try {
        const scripts = Array.from(document.querySelectorAll('script'));
        const playerScript = scripts.find(s => s.textContent.includes('ytInitialPlayerResponse ='));
        if (playerScript) {
            const scriptContent = playerScript.textContent;
            const jsonStr = extractYouTubeJson(scriptContent, 'ytInitialPlayerResponse');
            
            if (jsonStr) {
                console.log('[Transcript] Extracted JSON length:', jsonStr.length);
                const data = JSON.parse(jsonStr);
                const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;

                if (captions && captions.length > 0) {
                    console.log('[Transcript] Found', captions.length, 'caption tracks');
                    console.log('[Transcript] Caption track baseUrl:', captions[0].baseUrl.substring(0, 100) + '...');
                    
                    const transcript = await fetchTranscriptWithFormats(captions[0].baseUrl);
                    
                    if (transcript && transcript.length > 0) {
                        console.log('[Transcript] Method 3 succeeded, length:', transcript.length);
                        return transcript;
                    }
                    
                    console.warn('[Transcript] All format attempts failed for Method 3');
                }
            }
        }
    } catch (e) {
        console.warn('Transcript Method 3 failed', e);
    }

    // Method 4: DOM Interaction Fallback - Click "Show transcript" button
    try {
        // Click ...more if needed
        const moreBtn = document.querySelector('tp-yt-paper-button#expand');
        if (moreBtn) moreBtn.click();

        // Wait for description to expand, then find "Show transcript"
        await new Promise(r => setTimeout(r, 500));

        const showTranscriptBtn = Array.from(document.querySelectorAll('button'))
            .find(b => b.innerText.includes('Show transcript') || b.getAttribute('aria-label')?.includes('Show transcript'));

        if (showTranscriptBtn) {
            showTranscriptBtn.click();
            await new Promise(r => setTimeout(r, 1500));
            
            // Try multiple selectors for transcript segments
            const selectors = [
                'ytd-transcript-segment-renderer .segment-text',
                '.cue-group .cue',
                '.transcript-item .segment-text',
                'ytd-transcript-search-panel-renderer .segment-text'
            ];
            
            for (const selector of selectors) {
                const segments = document.querySelectorAll(selector);
                if (segments.length > 0) {
                    const text = Array.from(segments).map(s => s.innerText).join(' ');
                    if (text.length > 50) {
                        console.log('[Transcript] Method 4 (DOM interaction) succeeded, length:', text.length);
                        return text.replace(/\s+/g, ' ').trim();
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Transcript Method 4 failed', e);
    }

    throw new Error('transcript not found');
}

// === TWITTER/X POST EXTRACTION ===

/**
 * Check if current page is Twitter/X
 */
function isTwitterPage() {
    const hostname = location.hostname;
    return hostname === 'twitter.com' || 
           hostname === 'x.com' ||
           hostname === 'www.twitter.com' ||
           hostname === 'www.x.com';
}

/**
 * Check if current page is a single tweet page
 */
function isTweetPage() {
    return isTwitterPage() && 
           location.pathname.match(/\/\w+\/status\/\d+/);
}

/**
 * Extract tweet ID from URL
 */
function getTweetIdFromUrl() {
    const match = location.pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
}

/**
 * Wait for element to appear in DOM
 */
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
            resolve(element);
            return;
        }
        
        const observer = new MutationObserver((mutations, obs) => {
            const el = document.querySelector(selector);
            if (el) {
                obs.disconnect();
                resolve(el);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        setTimeout(() => {
            observer.disconnect();
            reject(new Error('Element not found within timeout'));
        }, timeout);
    });
}

/**
 * Extract data from a single tweet element
 */
function extractTweetData(tweetElement) {
    try {
        // Tweet text
        const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
        const text = textElement ? textElement.innerText : '';
        
        // Author info
        const userElement = tweetElement.querySelector('[data-testid="User-Name"]');
        const authorName = userElement?.querySelector('span')?.innerText || '';
        
        // Extract handle - look for @pattern
        const handleMatch = userElement?.innerText.match(/@[\w]+/);
        const handle = handleMatch ? handleMatch[0] : '';
        
        // Check for verified status (blue check, gold check, gray check)
        const verifiedBadge = tweetElement.querySelector('[data-testid="icon-verified"]') || 
                              tweetElement.querySelector('.r-1habvwh');
        let verified = false;
        let verifiedType = 'none';
        if (verifiedBadge) {
            // Check for different verification types by looking at the SVG or element
            const svg = verifiedBadge.querySelector('svg');
            if (svg) {
                const fill = svg.getAttribute('fill');
                if (fill === '#1d9bf0' || svg.innerHTML.includes('#1d9bf0')) {
                    verified = true;
                    verifiedType = 'blue';
                } else if (fill === '#ffd400' || svg.innerHTML.includes('#ffd400')) {
                    verified = true;
                    verifiedType = 'gold';
                } else if (fill === '#536471' || svg.innerHTML.includes('#536471')) {
                    verified = true;
                    verifiedType = 'gray';
                }
            } else {
                verified = true;
                verifiedType = 'blue';
            }
        }
        
        // Timestamp
        const timeElement = tweetElement.querySelector('time');
        const timestamp = timeElement?.getAttribute('datetime') || '';
        
        // Tweet link/ID
        const linkElement = tweetElement.querySelector('a[href*="/status/"]');
        const tweetPath = linkElement?.getAttribute('href') || '';
        const tweetId = tweetPath.match(/\/status\/(\d+)/)?.[1] || '';
        
        // Engagement metrics
        const replies = extractMetric(tweetElement, 'reply');
        const retweets = extractMetric(tweetElement, 'retweet');
        const likes = extractMetric(tweetElement, 'like');
        
        // Views count - try to extract from the metrics area
        let views = 0;
        const viewElement = tweetElement.querySelector('[data-testid="cellInnerDiv"]');
        if (viewElement) {
            const viewText = viewElement.textContent || '';
            const viewMatch = viewText.match(/([\d,.]+)[KkMm]?\s*views?/i);
            if (viewMatch) {
                views = parseMetricCount(viewMatch[1]);
            }
        }
        // Also try common aria-label patterns for views
        if (views === 0) {
            const viewButton = tweetElement.querySelector('[role="group"]');
            if (viewButton) {
                const ariaLabel = viewButton.getAttribute('aria-label') || '';
                const viewMatch = ariaLabel.match(/([\d,.]+)/);
                if (viewMatch) {
                    views = parseMetricCount(viewMatch[1]);
                }
            }
        }
        
        // Media
        const images = Array.from(tweetElement.querySelectorAll('[data-testid="tweetPhoto"] img'))
            .map(img => img.src)
            .filter(src => !src.includes('profile_images')); // Exclude profile pics
        
        const hasVideo = tweetElement.querySelector('[data-testid="videoPlayer"]') !== null;
        
        // Check if reply
        const isReply = tweetElement.closest('[data-testid="cellInnerDiv"]')?.previousElementSibling !== null;
        
        // Check for quote tweet - look for the quoted tweet element
        const quoteElement = tweetElement.querySelector('[data-testid="tweetQuoteLink"]') || 
                            tweetElement.querySelector('[data-testid="quoted tweet"]');
        let quotedTweet = null;
        const isQuote = quoteElement !== null;
        
        if (isQuote) {
            // Try to extract quoted tweet info
            const quoteContainer = tweetElement.querySelector('[data-testid="tweet"') || 
                                 tweetElement.parentElement?.querySelector('[data-testid="tweet"');
            if (quoteContainer) {
                const quoteText = quoteContainer.querySelector('[data-testid="tweetText"]')?.innerText || '';
                const quoteUser = quoteContainer.querySelector('[data-testid="User-Name"]')?.innerText || '';
                const quoteHandleMatch = quoteUser.match(/@[\w]+/);
                quotedTweet = {
                    text: quoteText,
                    author: quoteHandleMatch ? quoteHandleMatch[0] : ''
                };
            }
        }
        
        // Extract link cards
        let linkCard = null;
        const cardLink = tweetElement.querySelector('[data-testid="card.wrapper"] a');
        if (cardLink) {
            const cardTitle = cardLink.querySelector('[data-testid="cardTitle"]')?.innerText || 
                             cardLink.querySelector('.r-1habvwh')?.innerText || '';
            const cardDescription = cardLink.querySelector('[data-testid="cardDescription"]')?.innerText || '';
            const cardImage = cardLink.querySelector('img')?.src || '';
            linkCard = {
                url: cardLink.href,
                title: cardTitle,
                description: cardDescription,
                image: cardImage
            };
        }
        
        return {
            id: tweetId,
            text: text,
            author: {
                name: authorName,
                handle: handle,
                verified: verified,
                verifiedType: verifiedType
            },
            timestamp: timestamp,
            url: `https://twitter.com${tweetPath}`,
            media: {
                images: images,
                hasVideo: hasVideo
            },
            engagement: {
                replies: replies,
                retweets: retweets,
                likes: likes,
                views: views
            },
            isReply: isReply,
            isQuote: isQuote,
            quotedTweet: quotedTweet,
            linkCard: linkCard
        };
    } catch (e) {
        console.warn('Failed to extract tweet data:', e);
        return null;
    }
}

/**
 * Extract X Article content (long-form posts)
 */
function extractArticleData(articleElement) {
    try {
        // Article title
        const titleElement = articleElement.querySelector('[data-testid="articleTitle"]') ||
                            articleElement.querySelector('header h1') ||
                            articleElement.querySelector('h1');
        const title = titleElement ? titleElement.innerText : '';
        
        // Article body - try multiple selectors
        const bodyElement = articleElement.querySelector('[data-testid="articleBody"]') ||
                           articleElement.querySelector('[data-testid="articleContent"]') ||
                           articleElement.querySelector('article div[lang]') ||
                           articleElement.querySelector('div[dir="auto"]');
        const bodyText = bodyElement ? bodyElement.innerText : '';
        
        // Author info
        const userElement = articleElement.querySelector('[data-testid="User-Name"]');
        const authorName = userElement?.querySelector('span')?.innerText || '';
        const handleMatch = userElement?.innerText.match(/@[\w]+/);
        const handle = handleMatch ? handleMatch[0] : '';
        
        // Article URL
        const linkElement = articleElement.querySelector('a[href*="/status/"]');
        const articlePath = linkElement?.getAttribute('href') || '';
        const articleId = articlePath.match(/\/status\/(\d+)/)?.[1] || '';
        
        // Extract images
        const images = Array.from(articleElement.querySelectorAll('img'))
            .map(img => img.src)
            .filter(src => !src.includes('profile_images') && !src.includes('emoji'));
        
        // Timestamp
        const timeElement = articleElement.querySelector('time');
        const timestamp = timeElement?.getAttribute('datetime') || '';
        
        return {
            type: 'article',
            id: articleId,
            title: title,
            text: bodyText,
            author: {
                name: authorName,
                handle: handle
            },
            timestamp: timestamp,
            url: `https://x.com${articlePath}`,
            media: {
                images: images
            }
        };
    } catch (e) {
        console.warn('Failed to extract article data:', e);
        return null;
    }
}

/**
 * Extract engagement metric from tweet
 */
function extractMetric(tweetElement, type) {
    try {
        const button = tweetElement.querySelector(`[data-testid="${type}"]`);
        if (!button) return 0;
        
        const countSpan = button.querySelector('span');
        if (!countSpan || !countSpan.innerText) return 0;
        
        return parseMetricCount(countSpan.innerText);
    } catch (e) {
        return 0;
    }
}

/**
 * Parse Twitter metric strings like 1.2K, 5M
 * Supports multiple languages including Georgian
 */
function parseMetricCount(str) {
    if (!str || str === '') return 0;
    
    str = str.trim().toUpperCase();
    
    // Handle English suffixes
    if (str.includes('K')) return Math.round(parseFloat(str) * 1000);
    if (str.includes('M')) return Math.round(parseFloat(str) * 1000000);
    if (str.includes('B')) return Math.round(parseFloat(str) * 1000000000);
    
    // Handle Georgian suffixes
    // "ათასი" = thousand (1,000)
    // "მილიონი" = million (1,000,000)
    // "მილიარდი" = billion (1,000,000,000)
    // Also handle short forms: ათ., მლს, მლრდ
    if (str.includes('ათასი') || str.includes('ათ.')) {
        const num = parseFloat(str.replace(/[^0-9.,]/g, '').replace(',', '.'));
        return Math.round(num * 1000);
    }
    if (str.includes('მილიონი') || str.includes('მლ.')) {
        const num = parseFloat(str.replace(/[^0-9.,]/g, '').replace(',', '.'));
        return Math.round(num * 1000000);
    }
    if (str.includes('მილიარდი') || str.includes('მლრდ.')) {
        const num = parseFloat(str.replace(/[^0-9.,]/g, '').replace(',', '.'));
        return Math.round(num * 1000000000);
    }
    
    // Handle other European number formats (1.234 or 1,234)
    const cleanStr = str.replace(/[^0-9.,]/g, '');
    if (cleanStr.includes(',') && cleanStr.includes('.')) {
        // Both present - determine which is decimal separator
        if (cleanStr.lastIndexOf(',') > cleanStr.lastIndexOf('.')) {
            // Comma is thousand separator
            return parseInt(cleanStr.replace(/,/g, '')) || 0;
        } else {
            // Period is thousand separator
            return parseInt(cleanStr.replace(/\./g, '').replace(',', '.')) || 0;
        }
    } else if (cleanStr.includes(',')) {
        // Could be 1,000 or 1,5
        if (cleanStr.indexOf(',') === cleanStr.length - 2 || cleanStr.indexOf(',') === cleanStr.length - 3) {
            // Likely decimal separator (e.g., 1,5)
            return parseFloat(cleanStr.replace(',', '.')) || 0;
        } else {
            // Likely thousand separator
            return parseInt(cleanStr.replace(/,/g, '')) || 0;
        }
    }
    
    return parseInt(cleanStr) || 0;
}

/**
 * Extract all visible tweets on the page
 */
function extractAllVisibleTweets() {
    try {
        if (!isTwitterPage()) {
            return [];
        }
        
        const results = [];
        
        // Extract regular tweets
        const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
        tweetElements.forEach(el => {
            const data = extractTweetData(el);
            if (data) {
                data.type = 'tweet';
                results.push(data);
            }
        });
        
        // Extract X Articles
        const articleSelectors = [
            'article[data-testid="article"]',
            '[data-testid="articleBody"]',
            'div[data-testid="article"]'
        ];
        
        for (const selector of articleSelectors) {
            const articleElements = document.querySelectorAll(selector);
            if (articleElements.length > 0) {
                articleElements.forEach(el => {
                    const articleData = extractArticleData(el);
                    if (articleData) results.push(articleData);
                });
                break;
            }
        }
        
        return results;
    } catch (e) {
        console.warn('Failed to extract content:', e);
        return [];
    }
}

/**
 * Extract main tweet from a tweet page
 */
async function extractMainTweet() {
    if (!isTwitterPage()) {
        throw new Error('Not a Twitter/X page');
    }
    
    // Check if it's an article page
    const isArticle = location.pathname.includes('/status/') && 
                      (document.querySelector('article[data-testid="article"]') ||
                       document.querySelector('[data-testid="articleBody"]'));
    
    if (isArticle) {
        // Wait for article to load
        await waitForElement('[data-testid="articleBody"], article[data-testid="article"]');
        
        const articleElement = document.querySelector('article[data-testid="article"]') ||
                              document.querySelector('[data-testid="articleBody"]') ||
                              document.querySelector('div[data-testid="article"]');
        
        if (!articleElement) {
            throw new Error('Article not found');
        }
        
        return extractArticleData(articleElement);
    }
    
    // Wait for tweet to load
    await waitForElement('article[data-testid="tweet"]');
    
    const tweetArticle = document.querySelector('article[data-testid="tweet"]');
    if (!tweetArticle) {
        throw new Error('Tweet not found');
    }
    
    const tweetData = extractTweetData(tweetArticle);
    tweetData.type = 'tweet';
    return tweetData;
}

/**
 * Get all visible tweets with options
 */
async function getTwitterPosts(options = {}) {
    const { limit = 10, includeReplies = false } = options;
    
    if (!isTwitterPage()) {
        throw new Error('Not a Twitter/X page');
    }
    
    // Wait for tweets to load
    await waitForElement('article[data-testid="tweet"]');
    
    const results = [];
    
    // Extract regular tweets
    const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
    for (const element of tweetElements) {
        if (results.length >= limit) break;
        
        try {
            const tweetData = extractTweetData(element);
            
            // Skip if extraction failed
            if (!tweetData) continue;
            
            // Skip replies if not included
            if (!includeReplies && tweetData.isReply) continue;
            
            tweetData.type = 'tweet';
            results.push(tweetData);
        } catch (e) {
            console.warn('Failed to extract tweet:', e);
        }
    }
    
    // Extract X Articles if we haven't reached the limit
    if (results.length < limit) {
        const articleSelectors = [
            'article[data-testid="article"]',
            '[data-testid="articleBody"]',
            'div[data-testid="article"]'
        ];
        
        for (const selector of articleSelectors) {
            const articleElements = document.querySelectorAll(selector);
            if (articleElements.length > 0) {
                for (const element of articleElements) {
                    if (results.length >= limit) break;
                    
                    try {
                        const articleData = extractArticleData(element);
                        if (articleData) {
                            results.push(articleData);
                        }
                    } catch (e) {
                        console.warn('Failed to extract article:', e);
                    }
                }
                break;
            }
        }
    }
    
    return results;
}
