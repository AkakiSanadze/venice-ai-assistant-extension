/**
 * background.js
 * Service Worker for Venice AI Assistant
 */

// 1. Toggle Side Panel on Action Click
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidebar.html',
        enabled: true
    });
    chrome.sidePanel.open({ tabId: tab.id });
});

// 2. Keyboard Shortcut Listener (Ctrl+Shift+Y)
chrome.commands.onCommand.addListener((command) => {
    if (command === "_execute_action") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.sidePanel.open({ tabId: tabs[0].id });
            }
        });
    }
});

// 3. Handle transcript fetch requests from content scripts
// Uses chrome.scripting.executeScript with MAIN world to bypass CSP
// and include page cookies (needed for YouTube timedtext API)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'fetchInPageContext' && sender.tab) {
        const tabId = sender.tab.id;
        const url = msg.url;
        
        chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (fetchUrl) => {
                // Add headers that YouTube expects for timedtext API
                return fetch(fetchUrl, {
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json, text/xml, */*',
                        'Accept-Language': 'en-US,en;q=0.9',
                    }
                })
                    .then(resp => {
                        const status = resp.status;
                        const ok = resp.ok;
                        const contentType = resp.headers.get('content-type') || '';
                        return resp.text().then(text => ({ 
                            text, status, ok, 
                            length: text ? text.length : 0,
                            contentType,
                            error: null 
                        }));
                    })
                    .catch(err => ({ text: null, error: err.message, status: 0, ok: false, length: 0 }));
            },
            args: [url]
        }).then(results => {
            if (results && results[0] && results[0].result) {
                console.log('[Background] fetchInPageContext result:', {
                    status: results[0].result.status,
                    ok: results[0].result.ok,
                    length: results[0].result.length,
                    contentType: results[0].result.contentType,
                    error: results[0].result.error,
                    textPreview: results[0].result.text ? results[0].result.text.substring(0, 200) : '(null)'
                });
                sendResponse(results[0].result);
            } else {
                console.warn('[Background] No result from executeScript:', JSON.stringify(results));
                sendResponse({ text: null, error: 'No result from executeScript' });
            }
        }).catch(err => {
            console.error('[Background] executeScript error:', err.message);
            sendResponse({ text: null, error: err.message });
        });
        
        return true; // Keep channel open for async
    }
    
    // Handler to get fresh player response from MAIN world
    if (msg.action === 'getPlayerResponseFromMainWorld' && sender.tab) {
        const tabId = sender.tab.id;
        
        chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
                // Access the live ytInitialPlayerResponse from window context
                const playerResp = window.ytInitialPlayerResponse;
                if (playerResp && playerResp.captions) {
                    const tracks = playerResp.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (tracks && tracks.length > 0) {
                        return { 
                            captionTracks: tracks.map(t => ({
                                baseUrl: t.baseUrl,
                                languageCode: t.languageCode,
                                name: t.name?.simpleText || t.name?.runs?.map(r => r.text).join('') || ''
                            })),
                            error: null
                        };
                    }
                }
                
                // Also try movie_player element
                try {
                    const ytplayer = document.querySelector('#movie_player');
                    if (ytplayer && ytplayer.getPlayerResponse) {
                        const resp = ytplayer.getPlayerResponse();
                        const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                        if (tracks && tracks.length > 0) {
                            return {
                                captionTracks: tracks.map(t => ({
                                    baseUrl: t.baseUrl,
                                    languageCode: t.languageCode,
                                    name: t.name?.simpleText || t.name?.runs?.map(r => r.text).join('') || ''
                                })),
                                error: null,
                                source: 'playerElement'
                            };
                        }
                    }
                } catch (e) {
                    // Ignore
                }
                
                return { captionTracks: null, error: 'No caption tracks found in window context' };
            }
        }).then(results => {
            if (results && results[0] && results[0].result) {
                sendResponse(results[0].result);
            } else {
                sendResponse({ captionTracks: null, error: 'No result from executeScript' });
            }
        }).catch(err => {
            sendResponse({ captionTracks: null, error: err.message });
        });
        
        return true;
    }
    
    // Handler to fetch transcript via YouTube InnerTube API (get_transcript endpoint)
    // This is what YouTube's own frontend uses and doesn't depend on timedtext URLs
    if (msg.action === 'fetchTranscriptViaInnerTube' && sender.tab) {
        const tabId = sender.tab.id;
        const videoId = msg.videoId;
        
        chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (vidId) => {
                // Get InnerTube config from page context
                // YouTube InnerTube API key for transcript fetching
                // This is a public key used by YouTube's internal API
                // Note: This key is publicly known and used for YouTube transcript extraction
                let apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
                let clientVersion = '2.20240101.00.00';
                let clientName = 'WEB';
                let params = null;
                let debugInfo = {};
                
                try {
                    if (window.ytcfg && window.ytcfg.get) {
                        apiKey = window.ytcfg.get('INNERTUBE_API_KEY') || apiKey;
                        const ctx = window.ytcfg.get('INNERTUBE_CONTEXT');
                        if (ctx && ctx.client) {
                            clientVersion = ctx.client.clientVersion || clientVersion;
                            clientName = ctx.client.clientName || clientName;
                        }
                    }
                } catch (e) {
                    console.warn('[Transcript] Could not read ytcfg:', e);
                }
                
                // PHASE 1: Diagnostic logging to understand ytInitialData structure
                // Deep search for transcript params and log comprehensive debug info
                try {
                    const initialData = window.ytInitialData;
                    debugInfo.hasInitialData = !!initialData;
                    
                    if (initialData) {
                        // Log top-level keys for structure understanding
                        debugInfo.initialDataKeys = Object.keys(initialData);
                        
                        // Deep recursive search for transcript-related params
                        const searchForTranscriptParams = (obj, path = 'ytInitialData') => {
                            if (!obj || typeof obj !== 'object') return [];
                            
                            let results = [];
                            
                            // Check for getTranscriptEndpoint.params
                            if (obj.getTranscriptEndpoint?.params) {
                                results.push({
                                    params: obj.getTranscriptEndpoint.params,
                                    path: path + '.getTranscriptEndpoint'
                                });
                            }
                            
                            // Check for transcriptEntity.params
                            if (obj.transcriptEntity?.params) {
                                results.push({
                                    params: obj.transcriptEntity.params,
                                    path: path + '.transcriptEntity'
                                });
                            }
                            
                            // Recurse into nested objects (but limit depth to avoid circular refs)
                            const currentDepth = path.split('.').length;
                            if (currentDepth < 15) {
                                for (const [key, value] of Object.entries(obj)) {
                                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                                        results = results.concat(
                                            searchForTranscriptParams(value, `${path}.${key}`)
                                        );
                                    }
                                }
                                // Also check array elements
                                if (Array.isArray(obj)) {
                                    obj.forEach((item, idx) => {
                                        if (item && typeof item === 'object') {
                                            results = results.concat(
                                                searchForTranscriptParams(item, `${path}[${idx}]`)
                                            );
                                        }
                                    });
                                }
                            }
                            
                            return results;
                        };
                        
                        // Perform deep search
                        const foundParams = searchForTranscriptParams(initialData);
                        debugInfo.foundParamsPaths = foundParams;
                        
                        // Use first found params if any
                        if (foundParams.length > 0) {
                            params = foundParams[0].params;
                            debugInfo.paramsSource = foundParams[0].path;
                            console.log('[Transcript] Found params at:', foundParams[0].path);
                        }
                        
                        // Log full engagementPanels for manual inspection (first 2000 chars)
                        if (initialData.engagementPanels) {
                            try {
                                debugInfo.engagementPanelsPreview = JSON.stringify(initialData.engagementPanels).substring(0, 2000);
                                debugInfo.engagementPanelCount = initialData.engagementPanels.length;
                                debugInfo.engagementPanelIdentifiers = initialData.engagementPanels.map(p => 
                                    p?.engagementPanelSectionListRenderer?.panelIdentifier || 'unknown'
                                );
                            } catch (e) {
                                debugInfo.engagementPanelsPreview = 'Failed to stringify: ' + e.message;
                            }
                        }
                        
                        // Check alternative source: ytInitialPlayerResponse captions
                        try {
                            const playerResp = window.ytInitialPlayerResponse;
                            if (playerResp?.captions?.playerCaptionsTracklistRenderer) {
                                const captionRenderer = playerResp.captions.playerCaptionsTracklistRenderer;
                                debugInfo.playerCaptionsKeys = Object.keys(captionRenderer);
                                debugInfo.captionTracksCount = captionRenderer.captionTracks?.length || 0;
                            }
                        } catch (e) {
                            debugInfo.playerCaptionsError = e.message;
                        }
                        
                        // Check alternative source: TRANSCRIPT_CONFIG from ytcfg
                        try {
                            if (window.ytcfg && window.ytcfg.get) {
                                const transcriptConfig = window.ytcfg.get('TRANSCRIPT_CONFIG');
                                if (transcriptConfig) {
                                    debugInfo.transcriptConfigKeys = Object.keys(transcriptConfig);
                                    debugInfo.transcriptConfig = JSON.stringify(transcriptConfig).substring(0, 500);
                                }
                            }
                        } catch (e) {
                            debugInfo.transcriptConfigError = e.message;
                        }
                        
                        console.log('[Transcript] Diagnostic info:', {
                            hasInitialData: debugInfo.hasInitialData,
                            initialDataKeys: debugInfo.initialDataKeys,
                            foundParamsCount: foundParams.length,
                            foundParamsPaths: foundParams.map(p => p.path),
                            paramsSource: debugInfo.paramsSource
                        });
                    }
                } catch (e) {
                    console.warn('[Transcript] Could not extract params from ytInitialData:', e);
                    debugInfo.extractError = e.message;
                }
                
                // If no params found, try to build them manually
                if (!params) {
                    console.log('[Transcript] No params found in page data, building manually');
                    debugInfo.usingManualParams = true;
                    
                    // Helper: encode a protobuf varint
                    function encodeVarint(value) {
                        const bytes = [];
                        while (value > 0x7f) {
                            bytes.push((value & 0x7f) | 0x80);
                            value >>>= 7;
                        }
                        bytes.push(value & 0x7f);
                        return bytes;
                    }
                    
                    // Helper: encode a protobuf string field
                    function encodeStringField(fieldNumber, str) {
                        const encoded = new TextEncoder().encode(str);
                        const tag = (fieldNumber << 3) | 2;
                        return [...encodeVarint(tag), ...encodeVarint(encoded.length), ...encoded];
                    }
                    
                    // Helper: encode a protobuf nested message field
                    function encodeMessageField(fieldNumber, innerBytes) {
                        const tag = (fieldNumber << 3) | 2;
                        return [...encodeVarint(tag), ...encodeVarint(innerBytes.length), ...innerBytes];
                    }
                    
                    // Build correct protobuf params for get_transcript
                    // Based on YouTube.js library and InnerTube API reverse engineering:
                    // Field 1 (message): { Field 1 (string): videoId }
                    // Field 2 (message): { Field 1 (varint): 1 } - include auto-generated captions
                    // Field 3 (string): language code (optional, not included)
                    function buildTranscriptParams(videoId) {
                        // Field 1: Video context message { 1: videoId }
                        const videoContext = encodeStringField(1, videoId);
                        
                        // Field 2: Options message { 1: true } - include auto-generated if no manual captions
                        // Encode as varint field: tag (field 1, wire type 0) = (1 << 3) | 0 = 8, value = 1
                        const options = [0x08, 0x01]; // field 1, varint value 1 (true)
                        
                        // Combine into outer message:
                        // { 1: { 1: videoId }, 2: { 1: true } }
                        const outer = [
                            ...encodeMessageField(1, videoContext),
                            ...encodeMessageField(2, options)
                        ];
                        
                        return btoa(String.fromCharCode(...outer));
                    }
                    
                    params = buildTranscriptParams(vidId);
                    debugInfo.manualParams = params;
                    console.log('[Transcript] Built manual params with correct structure (field 1 + field 2)');
                }
                
                const url = `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`;
                debugInfo.url = url;
                debugInfo.apiKey = apiKey;
                debugInfo.clientVersion = clientVersion;
                
                console.log('[Transcript] InnerTube request debug:', debugInfo);
                
                return fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Visitor-Id': window.ytcfg?.get('VISITOR_DATA') || '',
                    },
                    body: JSON.stringify({
                        context: {
                            client: {
                                clientName: clientName,
                                clientVersion: clientVersion,
                            }
                        },
                        params: params
                    }),
                    credentials: 'include'
                })
                .then(resp => {
                    debugInfo.httpStatus = resp.status;
                    debugInfo.httpOk = resp.ok;
                    
                    // Check for HTTP errors
                    if (!resp.ok) {
                        return resp.text().then(text => {
                            debugInfo.errorBody = text.substring(0, 500);
                            console.error('[Transcript] InnerTube HTTP error:', debugInfo);
                            throw new Error(`HTTP ${resp.status}: ${text.substring(0, 200)}`);
                        });
                    }
                    return resp.json();
                })
                .then(data => {
                    debugInfo.responseKeys = Object.keys(data || {});
                    console.log('[Transcript] InnerTube response:', debugInfo);
                    
                    // Extract transcript text from InnerTube response
                    try {
                        const actions = data?.actions;
                        if (actions) {
                            debugInfo.actionsCount = actions.length;
                            for (const action of actions) {
                                const panel = action?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer;
                                const body = panel?.body?.transcriptSegmentListRenderer?.initialSegments ||
                                             action?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups;
                                
                                if (body && body.length > 0) {
                                    debugInfo.bodyLength = body.length;
                                    // Extract text from segments
                                    const texts = body.map(seg => {
                                        const cue = seg?.transcriptSectionHeaderRenderer?.snippet?.runs ||
                                                   seg?.transcriptSegmentRenderer?.snippet?.runs ||
                                                   seg?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer?.cue?.runs;
                                        if (cue) {
                                            return cue.map(r => r.text).join('');
                                        }
                                        return '';
                                    }).filter(t => t.length > 0);
                                    
                                    if (texts.length > 0) {
                                        return { transcript: texts.join(' ').replace(/\s+/g, ' ').trim(), error: null, debugInfo };
                                    }
                                }
                            }
                        }
                        
                        // Fallback: try to find transcript in different response structure
                        const body = data?.body?.transcriptBodyRenderer?.cueGroups;
                        if (body && body.length > 0) {
                            const texts = body.map(group => {
                                const cue = group?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer?.cue?.runs;
                                return cue ? cue.map(r => r.text).join('') : '';
                            }).filter(t => t.length > 0);
                            
                            if (texts.length > 0) {
                                return { transcript: texts.join(' ').replace(/\s+/g, ' ').trim(), error: null, debugInfo };
                            }
                        }
                        
                        return { transcript: null, error: 'No transcript data in InnerTube response', responseKeys: Object.keys(data || {}), debugInfo };
                    } catch (parseErr) {
                        return { transcript: null, error: 'Failed to parse InnerTube response: ' + parseErr.message, debugInfo };
                    }
                })
                .catch(err => ({ transcript: null, error: 'InnerTube fetch failed: ' + err.message, debugInfo }));
            },
            args: [videoId]
        }).then(results => {
            if (results && results[0] && results[0].result) {
                console.log('[Background] InnerTube transcript result:', {
                    hasTranscript: !!results[0].result.transcript,
                    length: results[0].result.transcript?.length || 0,
                    error: results[0].result.error,
                    debugInfo: results[0].result.debugInfo
                });
                sendResponse(results[0].result);
            } else {
                console.warn('[Background] No result from InnerTube executeScript');
                sendResponse({ transcript: null, error: 'No result from executeScript' });
            }
        }).catch(err => {
            console.error('[Background] InnerTube executeScript error:', err.message);
            sendResponse({ transcript: null, error: err.message });
        });
        
        return true;
    }
});
