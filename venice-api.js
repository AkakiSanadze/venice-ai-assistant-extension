/**
 * venice-api.js
 * API Communication Layer for Venice AI
 */

// Model pricing data (per 1M tokens) - Updated from API Feb 2026
const MODEL_PRICING = {
    // Premium Models
    'grok-code-fast-1': { input: 0.25, output: 1.87, name: 'Grok Code Fast 1' },
    'deepseek-v3.2': { input: 0.40, output: 1.00, name: 'DeepSeek V3.2' },
    'minimax-m21': { input: 0.40, output: 1.60, name: 'MiniMax M2.1' },
    'grok-41-fast': { input: 0.50, output: 1.25, name: 'Grok 4.1 Fast' },
    'zai-org-glm-4.7': { input: 0.55, output: 2.65, name: 'GLM 4.7' },
    'gemini-3-flash-preview': { input: 0.70, output: 3.75, name: 'Gemini 3 Flash' },
    'kimi-k2-thinking': { input: 0.75, output: 3.20, name: 'Kimi K2 Thinking' },
    'zai-org-glm-5': { input: 1.00, output: 3.20, name: 'GLM 5' },
    'openai-gpt-52': { input: 2.19, output: 17.50, name: 'GPT-5.2' },
    'gemini-3-pro-preview': { input: 2.50, output: 15.00, name: 'Gemini 3 Pro' },
    'claude-opus-45': { input: 6.00, output: 30.00, name: 'Claude Opus 4.5' },
    'kimi-k2-5': { input: 0.75, output: 3.75, name: 'Kimi K2.5' },
    'openai-gpt-52-codex': { input: 2.19, output: 17.50, name: 'GPT-5.2 Codex' },
    'claude-sonnet-45': { input: 3.75, output: 18.75, name: 'Claude Sonnet 4.5' },
    'claude-opus-4-6': { input: 6.00, output: 30.00, name: 'Claude Opus 4.6' },

    // Standard Models
    'qwen3-4b': { input: 0.05, output: 0.15, name: 'Venice Small' },
    'google-gemma-3-27b-it': { input: 0.12, output: 0.20, name: 'Gemma 3 27B' },
    'qwen3-235b-a22b-instruct-2507': { input: 0.15, output: 0.75, name: 'Qwen 3 235B' },
    'llama-3.2-3b': { input: 0.15, output: 0.60, name: 'Llama 3.2 3B' },
    'venice-uncensored': { input: 0.20, output: 0.90, name: 'Venice Uncensored' },
    'qwen3-vl-235b-a22b': { input: 0.25, output: 1.50, name: 'Qwen3 VL 235B' },
    'qwen3-235b-a22b-thinking-2507': { input: 0.45, output: 3.50, name: 'Qwen 3 Thinking' },
    'mistral-31-24b': { input: 0.50, output: 2.00, name: 'Venice Medium' },
    'llama-3.3-70b': { input: 0.70, output: 2.80, name: 'Llama 3.3 70B' },
    'qwen3-coder-480b-a35b-instruct': { input: 0.75, output: 3.00, name: 'Qwen 3 Coder' },

    // Beta Models
    'openai-gpt-oss-120b': { input: 0.07, output: 0.30, name: 'GPT OSS 120B' },
    'zai-org-glm-4.7-flash': { input: 0.125, output: 0.50, name: 'GLM 4.7 Flash' },
    'qwen3-next-80b': { input: 0.35, output: 1.90, name: 'Qwen 3 Next' },
    'hermes-3-llama-3.1-405b': { input: 1.10, output: 3.00, name: 'Hermes 3 405B' }
};

// Model context window limits (in tokens) - Updated from API Feb 2026
const MODEL_CONTEXT_LIMITS = {
    // Premium Models
    'grok-code-fast-1': 256000,      // 256K
    'deepseek-v3.2': 160000,         // 160K
    'minimax-m21': 198000,           // 198K
    'grok-41-fast': 256000,          // 256K
    'zai-org-glm-4.7': 198000,       // 198K
    'gemini-3-flash-preview': 256000, // 256K
    'kimi-k2-thinking': 256000,      // 256K
    'zai-org-glm-5': 198000,         // 198K
    'openai-gpt-52': 256000,         // 256K
    'gemini-3-pro-preview': 198000,  // 198K
    'claude-opus-45': 198000,        // 198K
    'kimi-k2-5': 256000,             // 256K
    'openai-gpt-52-codex': 256000,   // 256K
    'claude-sonnet-45': 198000,      // 198K
    'claude-opus-4-6': 1000000,      // 1M

    // Standard Models
    'qwen3-4b': 32000,               // 32K
    'google-gemma-3-27b-it': 198000, // 198K
    'qwen3-235b-a22b-instruct-2507': 128000, // 128K
    'llama-3.2-3b': 128000,          // 128K
    'venice-uncensored': 32000,      // 32K
    'qwen3-vl-235b-a22b': 256000,    // 256K
    'qwen3-235b-a22b-thinking-2507': 128000, // 128K
    'mistral-31-24b': 128000,        // 128K
    'llama-3.3-70b': 128000,         // 128K
    'qwen3-coder-480b-a35b-instruct': 256000, // 256K

    // Beta Models
    'openai-gpt-oss-120b': 128000,   // 128K
    'zai-org-glm-4.7-flash': 128000, // 128K
    'qwen3-next-80b': 256000,        // 256K
    'hermes-3-llama-3.1-405b': 128000 // 128K
};

// Default context limit for unknown models
const DEFAULT_CONTEXT_LIMIT = 128000; // 128K

// Model patterns for smart defaults estimation
const MODEL_PATTERNS = {
    // Premium patterns (high cost)
    premium: {
        patterns: ['claude-opus', 'gpt-5', 'gemini-3-pro', 'kimi-k2-5'],
        pricing: { input: 3.00, output: 15.00 },
        contextLimit: 200000
    },
    // Standard patterns (medium cost)
    standard: {
        patterns: ['llama-3.3', 'qwen3-235', 'mistral', 'venice-uncensored'],
        pricing: { input: 0.50, output: 2.00 },
        contextLimit: 128000
    },
    // Budget patterns (low cost)
    budget: {
        patterns: ['qwen3-4b', 'gemma', 'llama-3.2-3b'],
        pricing: { input: 0.10, output: 0.30 },
        contextLimit: 32768
    },
    // Coder patterns
    coder: {
        patterns: ['coder', 'codex', 'code-'],
        pricing: { input: 0.75, output: 3.00 },
        contextLimit: 128000
    },
    // Thinking/reasoning models
    thinking: {
        patterns: ['thinking', 'reasoning', 'think'],
        pricing: { input: 0.50, output: 3.00 },
        contextLimit: 128000
    },
    // Vision models
    vision: {
        patterns: ['vl-', '-vl', 'vision'],
        pricing: { input: 0.25, output: 1.50 },
        contextLimit: 128000
    }
};

// Model list caching constants
const MODEL_CACHE_KEY = 'venice_models_cache_v3';
const MODEL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * TextChunker - Splits text into chunks suitable for TTS API
 * Handles text longer than the API character limit by splitting at natural boundaries
 */
class TextChunker {
    /**
     * Create a TextChunker instance
     * @param {number} maxChunkSize - Maximum characters per chunk (default: 4000, safety margin below 4096 API limit)
     */
    constructor(maxChunkSize = 4000) {
        this.maxChunkSize = maxChunkSize;
    }

    /**
     * Split text into chunks respecting natural boundaries
     * @param {string} text - The text to split
     * @returns {string[]} Array of text chunks, each under maxChunkSize
     */
    split(text) {
        // If text fits in a single chunk, return as-is
        if (text.length <= this.maxChunkSize) {
            return [text];
        }

        const chunks = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= this.maxChunkSize) {
                // Remaining text fits in one chunk
                const trimmed = remaining.trim();
                if (trimmed.length > 0) {
                    chunks.push(trimmed);
                }
                break;
            }

            // Find the best split point
            const splitPoint = this.findBestSplitPoint(remaining);

            // Extract the chunk
            const chunk = remaining.substring(0, splitPoint).trim();
            if (chunk.length > 0) {
                chunks.push(chunk);
            }

            // Move to remaining text
            remaining = remaining.substring(splitPoint).trim();
        }

        return chunks;
    }

    /**
     * Find the best position to split text, prioritizing natural boundaries
     * @param {string} text - The text to find a split point in
     * @returns {number} The position to split at
     */
    findBestSplitPoint(text) {
        const searchStart = Math.max(0, this.maxChunkSize - 500); // Look in last 500 chars for natural break

        // Priority 1: Double newline (paragraph break)
        const paragraphBreak = text.lastIndexOf('\n\n', this.maxChunkSize);
        if (paragraphBreak > searchStart) {
            return paragraphBreak + 2; // Include the double newlines
        }

        // Priority 2: Single newline (line break)
        const lineBreak = text.lastIndexOf('\n', this.maxChunkSize);
        if (lineBreak > searchStart) {
            return lineBreak + 1;
        }

        // Priority 3: Sentence end (. ! ? followed by space or quote)
        const sentenceEnd = this.findLastSentenceEnd(text, this.maxChunkSize);
        if (sentenceEnd > searchStart) {
            return sentenceEnd + 1;
        }

        // Priority 4: Clause end (, ; :)
        const clauseEnd = this.findLastClauseEnd(text, this.maxChunkSize);
        if (clauseEnd > searchStart) {
            return clauseEnd + 1;
        }

        // Priority 5: Word boundary (space)
        const wordBoundary = text.lastIndexOf(' ', this.maxChunkSize);
        if (wordBoundary > searchStart) {
            return wordBoundary + 1;
        }

        // Priority 6: Hard split (last resort - no natural boundary found)
        // Add ellipsis to indicate continuation
        return this.maxChunkSize;
    }

    /**
     * Find the last sentence ending punctuation within the limit
     * @param {string} text - The text to search
     * @param {number} maxLength - Maximum position to search
     * @returns {number} Position of last sentence end, or -1 if not found
     */
    findLastSentenceEnd(text, maxLength) {
        // Match sentence endings: . ! ? possibly followed by quotes, then space
        const sentenceEnders = ['. ', '! ', '? ', '." ', '!" ', '?" ', ".' ", "!' ", "?' "];
        let lastEnd = -1;

        for (const ender of sentenceEnders) {
            const pos = text.lastIndexOf(ender, maxLength);
            if (pos > lastEnd) {
                lastEnd = pos;
            }
        }

        return lastEnd;
    }

    /**
     * Find the last clause ending punctuation within the limit
     * @param {string} text - The text to search
     * @param {number} maxLength - Maximum position to search
     * @returns {number} Position of last clause end, or -1 if not found
     */
    findLastClauseEnd(text, maxLength) {
        const clauseEnders = [', ', '; ', ': '];
        let lastEnd = -1;

        for (const ender of clauseEnders) {
            const pos = text.lastIndexOf(ender, maxLength);
            if (pos > lastEnd) {
                lastEnd = pos;
            }
        }

        return lastEnd;
    }
}

/**
 * AudioConcatenator - Combines multiple audio blobs into a single blob
 * MP3 blobs can be directly concatenated as MP3 frames are independent
 */
class AudioConcatenator {
    /**
     * Concatenate multiple audio blobs into a single blob
     * For MP3 format, direct concatenation works because frames are self-contained
     * @param {Blob[]} blobs - Array of audio blobs to concatenate
     * @returns {Blob} Single combined audio blob
     */
    concatenate(blobs) {
        if (!blobs || blobs.length === 0) {
            throw new Error('No audio blobs to concatenate');
        }

        // Single blob - return as-is
        if (blobs.length === 1) {
            return blobs[0];
        }

        // Direct concatenation for MP3 - frames are independent
        return new Blob(blobs, { type: 'audio/mpeg' });
    }
}

class VeniceAPI {
    constructor() {
        this.baseUrl = 'https://api.venice.ai/api/v1';
        this.apiKey = null;
        this.abortController = null;
        this.modelsCache = null; // In-memory cache
        this.dynamicPricing = {}; // Pricing from API (text models)
        this.dynamicImagePricing = {}; // Pricing from API (image models)
        this.dynamicContextLimits = {}; // Context limits from API
    }

    setApiKey(key) {
        this.apiKey = key;
    }

    // Alias for getPricing - used by sidebar.js tooltip
    getModelPricing(modelId) {
        return this.getPricing(modelId);
    }

    // Get pricing for a model (priority: API > hardcoded > smart estimation)
    getPricing(modelId) {
        // First check dynamic pricing from API
        if (this.dynamicPricing[modelId]) {
            return this.dynamicPricing[modelId];
        }

        // Then check hardcoded pricing
        if (MODEL_PRICING[modelId]) {
            return MODEL_PRICING[modelId];
        }

        // Finally try smart estimation based on model patterns
        const estimated = this.estimateModelDefaults(modelId);
        return estimated.pricing;
    }

    // Estimate model defaults based on model ID patterns
    estimateModelDefaults(modelId) {
        const id = modelId.toLowerCase();

        // Check each pattern category
        for (const [category, config] of Object.entries(MODEL_PATTERNS)) {
            for (const pattern of config.patterns) {
                if (id.includes(pattern)) {
                    return {
                        pricing: {
                            input: config.pricing.input,
                            output: config.pricing.output,
                            name: modelId
                        },
                        contextLimit: config.contextLimit,
                        estimated: true,
                        category
                    };
                }
            }
        }

        // Default fallback for unknown models
        return {
            pricing: { input: 0.20, output: 1.00, name: modelId },
            contextLimit: DEFAULT_CONTEXT_LIMIT,
            estimated: true,
            category: 'unknown'
        };
    }

    // Calculate cost for tokens
    calculateCost(modelId, inputTokens, outputTokens) {
        const pricing = this.getPricing(modelId);
        const inputCost = (inputTokens / 1000000) * pricing.input;
        const outputCost = (outputTokens / 1000000) * pricing.output;
        return {
            inputCost,
            outputCost,
            totalCost: inputCost + outputCost,
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens
        };
    }

    // Estimate tokens from text (rough approximation: ~4 chars per token)
    estimateTokens(text) {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    // Get context limit for a model (priority: API > hardcoded > smart estimation)
    getContextLimit(modelId) {
        // First check dynamic context limits from API
        if (this.dynamicContextLimits[modelId]) {
            return this.dynamicContextLimits[modelId];
        }

        // Then check hardcoded limits
        if (MODEL_CONTEXT_LIMITS[modelId]) {
            return MODEL_CONTEXT_LIMITS[modelId];
        }

        // Finally try smart estimation based on model patterns
        const estimated = this.estimateModelDefaults(modelId);
        return estimated.contextLimit;
    }

    // Calculate total context usage for a conversation
    calculateContextUsage(messages, modelId) {
        const contextLimit = this.getContextLimit(modelId);

        // Sum all prompt tokens from assistant messages
        // Note: prompt_tokens represents the input context for each API call
        let totalContextTokens = 0;

        for (const msg of messages) {
            if (msg.role === 'assistant' && msg.usage?.prompt_tokens) {
                // The last assistant message has the most accurate prompt_tokens
                // which includes all previous conversation context
                totalContextTokens = msg.usage.prompt_tokens;
            }
        }

        // If no assistant messages yet, estimate from user messages
        if (totalContextTokens === 0) {
            for (const msg of messages) {
                if (msg.role === 'user') {
                    totalContextTokens += this.estimateTokens(msg.content || '');
                }
            }
        }

        const percentage = (totalContextTokens / contextLimit) * 100;
        const remaining = contextLimit - totalContextTokens;

        return {
            used: totalContextTokens,
            limit: contextLimit,
            percentage: Math.min(percentage, 100), // Cap at 100%
            remaining: Math.max(remaining, 0), // Floor at 0
            warningLevel: this.getWarningLevel(percentage)
        };
    }

    // Determine warning level based on usage percentage
    getWarningLevel(percentage) {
        if (percentage >= 90) return 'critical';
        if (percentage >= 80) return 'warning';
        if (percentage >= 60) return 'caution';
        return 'normal';
    }

    async validateKey() {
        if (!this.apiKey) return false;
        try {
            const resp = await fetch(`${this.baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });
            return resp.ok;
        } catch (e) {
            return false;
        }
    }

    async fetchModels() {
        // Check in-memory cache first (fastest)
        if (this.modelsCache) {
            return this.modelsCache;
        }

        // Check localStorage cache
        try {
            const cached = localStorage.getItem(MODEL_CACHE_KEY);
            if (cached) {
                const { data, timestamp, pricing, imagePricing, contextLimits } = JSON.parse(cached);
                // Check if cache is still valid AND has image models (structural validation)
                if (Date.now() - timestamp < MODEL_CACHE_TTL && data?.imageModels?.length > 0) {
                    this.modelsCache = data;
                    // Restore dynamic pricing and context limits from cache
                    if (pricing) this.dynamicPricing = pricing;
                    if (imagePricing) this.dynamicImagePricing = imagePricing;
                    if (contextLimits) this.dynamicContextLimits = contextLimits;
                    return data;
                }
                // Cache expired, remove it
                localStorage.removeItem(MODEL_CACHE_KEY);
            }
        } catch (e) {
            // localStorage might not be available or data corrupted
            console.warn('Model cache read error:', e);
        }

        // Fetch text and image models in parallel
        // Venice API /models only returns text models; image models require ?type=image
        const authHeaders = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept-Encoding': 'gzip, deflate, br'
        };

        const [textResp, imageResp] = await Promise.all([
            fetch(`${this.baseUrl}/models`, { headers: authHeaders }),
            fetch(`${this.baseUrl}/models?type=image`, { headers: authHeaders })
        ]);

        if (!textResp.ok) throw new Error('Failed to fetch models');
        const textData = (await textResp.json()).data || [];

        let imageData = [];
        if (imageResp.ok) {
            const imageJson = await imageResp.json();
            imageData = imageJson.data || [];
            console.log(`🖼️ Image models API response: ${imageData.length} models, type=${imageJson.type}`);
        } else {
            console.warn('⚠️ Failed to fetch image models, status:', imageResp.status);
        }

        // Extract text model pricing and context limits
        for (const model of textData) {
            if (model.model_spec) {
                if (model.model_spec.pricing) {
                    const inputPrice = model.model_spec.pricing.input?.usd || 0;
                    const outputPrice = model.model_spec.pricing.output?.usd || 0;
                    const modelName = model.model_spec.name || model.id;

                    this.dynamicPricing[model.id] = {
                        input: inputPrice,
                        output: outputPrice,
                        name: modelName
                    };
                }
                if (model.model_spec.availableContextTokens) {
                    this.dynamicContextLimits[model.id] = model.model_spec.availableContextTokens;
                }
            }
        }

        // Extract image model pricing
        for (const model of imageData) {
            if (model.model_spec?.pricing) {
                this.dynamicImagePricing[model.id] = model.model_spec.pricing;
            }
        }

        console.log(`📊 Loaded ${Object.keys(this.dynamicPricing).length} text model prices, ${Object.keys(this.dynamicImagePricing).length} image model prices from API`);

        // Filter text models (exclude offline)
        const textModels = textData.filter(m => m.type === 'text' && !m.model_spec?.offline);

        // Filter image models (exclude offline)
        let imageModels = imageData.filter(m => !m.model_spec?.offline);

        if (imageModels.length === 0) {
            console.warn('⚠️ No image models available after filtering');
        } else {
            console.log(`🖼️ ${imageModels.length} image models ready`);
        }

        // Enrich image models with a formatted display name that includes pricing
        imageModels = imageModels.map(m => {
            const priceLabel = this.getImageModelPriceLabel(m);
            const displayName = priceLabel
                ? `${m.model_spec?.name || m.id} (${priceLabel})`
                : (m.model_spec?.name || m.id);
            return { ...m, displayName };
        });

        const visionModels = textModels.filter(m => m.model_spec?.capabilities?.supportsVision);

        const result = { textModels, imageModels, visionModels };

        // Cache the result in memory
        this.modelsCache = result;

        // Cache in localStorage (including pricing and context limits)
        try {
            localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify({
                data: result,
                pricing: this.dynamicPricing,
                imagePricing: this.dynamicImagePricing,
                contextLimits: this.dynamicContextLimits,
                timestamp: Date.now()
            }));
        } catch (e) {
            // localStorage might be full or unavailable
            console.warn('Model cache write error:', e);
        }

        return result;
    }

    async streamChat(systemPrompts, messages, options, onChunk, onDone, onError) {
        this.abortController = new AbortController();

        const systemContent = Array.isArray(systemPrompts) ? systemPrompts.join('\n\n') : systemPrompts;
        const apiMessages = [];

        if (systemContent) {
            apiMessages.push({ role: 'system', content: systemContent });
        }

        for (const msg of messages) {
            // Handle messages with images (Vision)
            if (msg.role === 'user' && msg.images && msg.images.length > 0) {
                const content = [
                    { type: 'text', text: msg.content }
                ];
                for (const img of msg.images) {
                    if (img.type === 'url' || (typeof img.url === 'string' && !img.base64)) {
                        // Public URL (e.g., from Twitter)
                        content.push({
                            type: 'image_url',
                            image_url: {
                                url: img.url
                            }
                        });
                    } else if (img.base64) {
                        // Local/Uploaded base64 image
                        content.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${img.mimeType};base64,${img.base64}`
                            }
                        });
                    }
                }
                apiMessages.push({ role: 'user', content });
            } else {
                const apiMsg = { role: msg.role, content: msg.content };
                if (msg.role === 'assistant' && msg.modelName) {
                    apiMsg.name = msg.modelName;
                }
                apiMessages.push(apiMsg);
            }
        }

        const body = {
            model: options.model,
            messages: apiMessages,
            stream: true,
            venice_parameters: {
                include_venice_system_prompt: false,
                enable_web_search: options.webSearch ? 'on' : 'off',
                enable_web_citations: options.webSearch || false,
                strip_thinking_response: false  // Preserve thinking content for reasoning models
            }
        };

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept-Encoding': 'gzip, deflate, br'
                },
                body: JSON.stringify(body),
                signal: this.abortController.signal
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error?.message || `API Error: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullText = '';
            let thinkingText = '';
            let isThinking = false;
            let usage = null;

            // Thinking tag patterns used by different models
            const thinkingPatterns = [
                { start: '<think', end: '</think', name: 'think' },
                { start: '<|begin_of_thought|>', end: '<|end_of_thought|>', name: 'thought' },
                { start: '<reasoning>', end: '</reasoning>', name: 'reasoning' },
                { start: '<|reasoning|>', end: '</|reasoning|>', name: 'reasoning_alt' },
                { start: '<thinking>', end: '</thinking>', name: 'thinking' },
                { start: '【思考】', end: '【/思考】', name: 'chinese_thinking' },
                { start: '<|thought|>', end: '</|thought|>', name: 'thought_alt' },
                // Additional patterns for models like Qwen, Kimi, GLM, DeepSeek
                { start: '<｜', end: '｜>', name: 'qwen_thought' },
                { start: '<|user|>', end: '</|user|>', name: 'user_tag' },
                { start: '<|assistant|>', end: '</|assistant|>', name: 'assistant_tag' },
                // Kimi-specific patterns
                { start: '<kimthink>', end: '</kimthink>', name: 'kimthink' },
                { start: '<output>', end: '</output>', name: 'output_tag' },
                // Qwen analysis patterns
                { start: '<｜startofanalysis｜>', end: '<｜endofanalysis｜>', name: 'qwen_analysis' },
                { start: '<reserved_', end: '｜>', name: 'qwen_reserved' }
            ];

            // Helper function to detect thinking tags
            const detectThinkingTag = (text) => {
                for (const pattern of thinkingPatterns) {
                    if (text.includes(pattern.start)) {
                        return { pattern, type: 'start' };
                    }
                    if (text.includes(pattern.end)) {
                        return { pattern, type: 'end' };
                    }
                }
                return null;
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;

                    const jsonStr = trimmed.slice(6);
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(jsonStr);

                        const content = parsed.choices?.[0]?.delta?.content || '';

                        // Check for reasoning_content field (used by some thinking models like DeepSeek, GLM)
                        const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content || '';

                        // Check for usage info in response
                        if (parsed.usage) {
                            usage = parsed.usage;
                        }

                        // Handle reasoning_content (used by DeepSeek, GLM and other thinking models)
                        if (reasoningContent) {
                            thinkingText += reasoningContent;
                            // Don't add reasoning to fullText - it should be separate
                            // Call onChunk with updated thinking
                            onChunk(fullText, thinkingText);
                        }

                        if (content) {
                            // Detect thinking tags FIRST to determine what to add to fullText
                            const detected = detectThinkingTag(content);


                            if (detected) {
                                if (detected.type === 'start') {
                                    isThinking = true;
                                    // Extract content after the start tag
                                    const parts = content.split(detected.pattern.start);
                                    const afterStart = parts[1] || '';
                                    thinkingText += afterStart;
                                    // Don't add to fullText - it's thinking content
                                } else if (detected.type === 'end') {
                                    isThinking = false;
                                    const endPattern = detected.pattern.end;
                                    const endIdx = content.indexOf(endPattern);
                                    // Add content before end tag to thinking
                                    thinkingText += content.substring(0, endIdx) || '';
                                    // After closing tag, any remaining text is visible content
                                    const afterTag = content.substring(endIdx + endPattern.length);
                                    if (afterTag) {
                                        fullText += afterTag;
                                    }
                                }
                            } else if (isThinking) {
                                // We're in thinking mode, add to thinkingText
                                thinkingText += content;
                            } else {
                                // Not in thinking mode and no tag detected - this is visible content
                                fullText += content;
                            }

                            // Build clean visible text (strip all thinking blocks)
                            const cleanFullText = fullText
                                .replace(/<think[\s\S]*?<\/think>/gi, '')
                                .replace(/<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi, '')
                                .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
                                .replace(/<\|reasoning\|>[\s\S]*?<\/\|reasoning\|>/gi, '')
                                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                                .replace(/【思考】[\s\S]*?【\/思考】/g, '')
                                .replace(/<\|thought\|>[\s\S]*?<\/\|thought\|>/gi, '')
                                // Qwen-style thinking tags
                                .replace(/<｜[\s\S]*?｜>/g, '')
                                // Kimi-specific tags
                                .replace(/<kimthink>[\s\S]*?<\/kimthink>/gi, '')
                                .replace(/<output>[\s\S]*?<\/output>/gi, '')
                                // Qwen analysis tags
                                .replace(/<｜startofanalysis｜>[\s\S]*?<｜endofanalysis｜>/g, '')
                                // Strip any incomplete opening think tag (still streaming thinking)
                                .replace(/<think[^>]*>[\s\S]*/gi, '')
                                .replace(/<\|begin_of_thought\|>[\s\S]*/gi, '')
                                .replace(/<reasoning>[\s\S]*/gi, '')
                                .replace(/<thinking>[\s\S]*/gi, '')
                                .replace(/<｜[^>]*>[\s\S]*/gi, '')
                                .trim();

                            // Call onChunk with CLEAN visible text (no think tags)
                            onChunk(cleanFullText, thinkingText);

                            // Also apply the extraction fix during streaming for models without thinking tags
                            // If cleanFullText is empty but thinkingText has visible content, extract it
                            let streamingFullText = cleanFullText;
                            if (!cleanFullText && thinkingText) {
                                // Use the same logic as the final extraction - find LAST occurrences
                                const allMainIdeaMatches = [...thinkingText.matchAll(/Main Idea:\s*([\s\S]*?)(?:\n\n|Key Takeaway:|Watch If:|Skip If:)/gi)];
                                const allKeyTakeawayMatches = [...thinkingText.matchAll(/Key Takeaway:\s*([\s\S]*?)(?:\n\n|Watch If:|Skip If:)/gi)];
                                const allWatchIfMatches = [...thinkingText.matchAll(/Watch If:\s*([\s\S]*?)(?:\n\n|Skip If:)/gi)];
                                const allSkipIfMatches = [...thinkingText.matchAll(/Skip If:\s*([\s\S]*?)$/gim)];

                                if (allMainIdeaMatches.length > 0) {
                                    const lastMainIdea = allMainIdeaMatches[allMainIdeaMatches.length - 1];
                                    streamingFullText = 'Main Idea: ' + (lastMainIdea[1] ? lastMainIdea[1].trim() : '');

                                    if (allKeyTakeawayMatches.length > 0) {
                                        const lastKeyTakeaway = allKeyTakeawayMatches[allKeyTakeawayMatches.length - 1];
                                        if (lastKeyTakeaway[1]) streamingFullText += '\n\nKey Takeaway: ' + lastKeyTakeaway[1].trim();
                                    }
                                    if (allWatchIfMatches.length > 0) {
                                        const lastWatchIf = allWatchIfMatches[allWatchIfMatches.length - 1];
                                        if (lastWatchIf[1]) streamingFullText += '\n\nWatch If: ' + lastWatchIf[1].trim();
                                    }
                                    if (allSkipIfMatches.length > 0) {
                                        const lastSkipIf = allSkipIfMatches[allSkipIfMatches.length - 1];
                                        if (lastSkipIf[1]) streamingFullText += '\n\nSkip If: ' + lastSkipIf[1].trim();
                                    }
                                }
                            }
                            if (streamingFullText !== cleanFullText) {
                                onChunk(streamingFullText, thinkingText);
                            }
                        }
                    } catch (e) {
                        console.warn('Malformed stream chunk', e);
                    }
                }
            }

            // If no usage from API, estimate tokens
            if (!usage) {
                // Estimate input tokens from all messages
                let inputText = systemContent || '';
                for (const msg of messages) {
                    inputText += ' ' + (msg.content || '');
                }
                const estimatedInput = this.estimateTokens(inputText);
                const estimatedOutput = this.estimateTokens(fullText);
                usage = {
                    prompt_tokens: estimatedInput,
                    completion_tokens: estimatedOutput,
                    total_tokens: estimatedInput + estimatedOutput,
                    estimated: true
                };
            }


            // Build clean visible text (strip all thinking blocks) - same logic as in onChunk
            const cleanFullText = fullText
                .replace(/<think[\s\S]*?<\/think>/gi, '')
                .replace(/<\|begin_of_thought\|> [\s\S]*?<\|end_of_thought\|>/gi, '')
                .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
                .replace(/<\|reasoning\|>[\s\S]*?<\/\|reasoning\|>/gi, '')
                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                .replace(/【思考】[\s\S]*?【\/思考】/g, '')
                .replace(/<\|thought\|>[\s\S]*?<\/\|thought\|>/gi, '')
                // Qwen-style thinking tags
                .replace(/<｜[\s\S]*?｜>/g, '')
                // Kimi-specific tags
                .replace(/<kimthink>[\s\S]*?<\/kimthink>/gi, '')
                .replace(/<output>[\s\S]*?<\/output>/gi, '')
                // Qwen analysis tags
                .replace(/<｜startofanalysis｜>[\s\S]*?<｜endofanalysis｜>/g, '')
                // Strip any incomplete opening think tag (still streaming thinking)
                .replace(/<think[^>]*>[\s\S]*/gi, '')
                .replace(/<\|begin_of_thought\|>[\s\S]*/gi, '')
                .replace(/<reasoning>[\s\S]*/gi, '')
                .replace(/<thinking>[\s\S]*/gi, '')
                .replace(/<｜[^>]*>[\s\S]*/gi, '')
                .replace(/<kimthink>[\s\S]*/gi, '')
                .replace(/<output>[\s\S]*/gi, '')
                .trim();

            // FIX: Handle models that output thinking WITHOUT tags (like Qwen 3.5)
            // If fullText is empty but thinkingText contains what looks like final output,
            // try to extract visible content from thinkingText
            let finalCleanFullText = cleanFullText;
            if (!cleanFullText && thinkingText) {
                // Look for the FINAL occurrence of response markers (after thinking is done)
                // The thinking process typically has "Drafting", "Final Review", "Final Polish" sections
                // We want the content AFTER "Final Review" or "Final Selection"

                // First, check for explicit final output markers
                const finalSelectionMatch = thinkingText.match(/Final Selection:([\s\S]*)/i);
                const finalOutputMatch = thinkingText.match(/Output:([\s\S]*)/i);
                const finalAnswerMatch = thinkingText.match(/Final Answer:([\s\S]*)/i);

                // If no explicit markers, find the last occurrence of Main Idea (after all drafts)
                const allMainIdeaMatches = [...thinkingText.matchAll(/Main Idea:\s*([\s\S]*?)(?:\n\n|Key Takeaway:|Watch If:|Skip If:)/gi)];
                const allKeyTakeawayMatches = [...thinkingText.matchAll(/Key Takeaway:\s*([\s\S]*?)(?:\n\n|Watch If:|Skip If:)/gi)];
                const allWatchIfMatches = [...thinkingText.matchAll(/Watch If:\s*([\s\S]*?)(?:\n\n|Skip If:)/gi)];
                const allSkipIfMatches = [...thinkingText.matchAll(/Skip If:\s*([\s\S]*?)$/gim)];

                if (finalSelectionMatch || finalOutputMatch || finalAnswerMatch) {
                    // Use explicit final output marker
                    const match = finalSelectionMatch || finalOutputMatch || finalAnswerMatch;
                    finalCleanFullText = match[1] ? match[1].trim() : '';
                    // Also try to append other sections if they're near the end
                    if (allKeyTakeawayMatches.length > 0) {
                        const lastKeyTakeaway = allKeyTakeawayMatches[allKeyTakeawayMatches.length - 1];
                        if (lastKeyTakeaway[1]) finalCleanFullText += '\n\nKey Takeaway: ' + lastKeyTakeaway[1].trim();
                    }
                    if (allWatchIfMatches.length > 0) {
                        const lastWatchIf = allWatchIfMatches[allWatchIfMatches.length - 1];
                        if (lastWatchIf[1]) finalCleanFullText += '\n\nWatch If: ' + lastWatchIf[1].trim();
                    }
                    if (allSkipIfMatches.length > 0) {
                        const lastSkipIf = allSkipIfMatches[allSkipIfMatches.length - 1];
                        if (lastSkipIf[1]) finalCleanFullText += '\n\nSkip If: ' + lastSkipIf[1].trim();
                    }
                } else if (allMainIdeaMatches.length > 0) {
                    // Use the LAST occurrence of Main Idea (after all drafts)
                    const lastMainIdea = allMainIdeaMatches[allMainIdeaMatches.length - 1];
                    finalCleanFullText = 'Main Idea: ' + (lastMainIdea[1] ? lastMainIdea[1].trim() : '');

                    // Append the last occurrences of other sections too
                    if (allKeyTakeawayMatches.length > 0) {
                        const lastKeyTakeaway = allKeyTakeawayMatches[allKeyTakeawayMatches.length - 1];
                        if (lastKeyTakeaway[1]) finalCleanFullText += '\n\nKey Takeaway: ' + lastKeyTakeaway[1].trim();
                    }
                    if (allWatchIfMatches.length > 0) {
                        const lastWatchIf = allWatchIfMatches[allWatchIfMatches.length - 1];
                        if (lastWatchIf[1]) finalCleanFullText += '\n\nWatch If: ' + lastWatchIf[1].trim();
                    }
                    if (allSkipIfMatches.length > 0) {
                        const lastSkipIf = allSkipIfMatches[allSkipIfMatches.length - 1];
                        if (lastSkipIf[1]) finalCleanFullText += '\n\nSkip If: ' + lastSkipIf[1].trim();
                    }
                }

            }


            onDone(finalCleanFullText, thinkingText, usage);
        } catch (error) {
            if (error.name !== 'AbortError') onError(error);
        }
    }

    abortStream() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    /**
     * Clear models cache (both in-memory and localStorage)
     * Useful for forcing a fresh fetch from API
     */
    clearModelsCache() {
        // Clear in-memory cache
        this.modelsCache = null;

        // Clear dynamic pricing and context limits
        this.dynamicPricing = {};
        this.dynamicImagePricing = {};
        this.dynamicContextLimits = {};

        // Clear localStorage cache
        try {
            localStorage.removeItem(MODEL_CACHE_KEY);
            console.log('✅ Models cache cleared');
        } catch (e) {
            console.warn('Failed to clear models cache from localStorage:', e);
        }
    }

    /**
     * Build a human-readable price label for an image model.
     * Venice AI image models use two distinct pricing structures:
     *  - generation: flat per-image price  { usd: 0.04 }
     *  - resolutions: tiered pricing        { "1K": { usd: 0.10 }, "2K": { usd: 0.14 }, "4K": { usd: 0.19 } }
     * @param {object} model - A model object from the API
     * @returns {string} e.g. "$0.04/img" or "$0.10–$0.19/img" or ""
     */
    getImageModelPriceLabel(model) {
        // Prefer live pricing captured during this session, fall back to model_spec
        const pricing = this.dynamicImagePricing[model.id] || model.model_spec?.pricing;
        if (!pricing) return '';

        // Flat per-image price
        if (pricing.generation?.usd != null) {
            return `$${pricing.generation.usd.toFixed(2)}/img`;
        }

        // Tiered resolution pricing — show min–max range
        if (pricing.resolutions) {
            const prices = Object.values(pricing.resolutions)
                .map(r => r.usd)
                .filter(p => typeof p === 'number');
            if (prices.length > 0) {
                const min = Math.min(...prices);
                const max = Math.max(...prices);
                return min === max
                    ? `$${min.toFixed(2)}/img`
                    : `$${min.toFixed(2)}–$${max.toFixed(2)}/img`;
            }
        }

        return '';
    }

    async generateImage(prompt, model, size) {
        // Parse size to width and height for the native endpoint
        let width = 1024;
        let height = 1024;
        if (size && size.includes('x')) {
            const parts = size.split('x');
            width = parseInt(parts[0], 10) || 1024;
            height = parseInt(parts[1], 10) || 1024;
        }

        const payload = {
            model,
            prompt,
            width,
            height,
            safe_mode: false, // Supported on the native endpoint
            hide_watermark: true,
            return_binary: false // We want base64 JSON response
        };

        const resp = await fetch(`${this.baseUrl}/image/generate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error?.message || err.message || 'Image generation failed');
        }

        const data = await resp.json();
        
        // Venice native /image/generate returns { images: ["<base64>"] }
        if (data.images && data.images.length > 0) {
            return { b64: data.images[0] };
        }
        
        throw new Error('No image returned from API');
    }

    async textToSpeech(text, voice, speed = 1) {
        const resp = await fetch(`${this.baseUrl}/audio/speech`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            body: JSON.stringify({
                model: "tts-kokoro",
                input: text,
                voice,
                response_format: "mp3",
                speed
            })
        });

        if (!resp.ok) {
            // Try to get error details from response
            let errorDetails = 'TTS failed';
            try {
                const errorData = await resp.json();
                errorDetails = errorData.error?.message || errorData.message || JSON.stringify(errorData);
            } catch (e) {
                // Could not parse error response
            }
            throw new Error(`TTS failed (${resp.status}): ${errorDetails}`);
        }
        return await resp.blob();
    }

    /**
     * Generate TTS for long texts with automatic chunking
     * Splits text into chunks, generates audio for each, and concatenates results
     * @param {string} text - Full text to convert to speech
     * @param {Object} options - TTS options
     * @param {string} options.voice - Voice ID (e.g., 'af_sky', 'am_adam', 'bf_emma')
     * @param {number} [options.speed=1] - Speech speed (0.5 to 2.0)
     * @param {function} [onProgress] - Progress callback function
     * @param {AbortSignal} [abortSignal] - Optional abort signal for cancellation
     * @returns {Promise<Blob>} - Combined audio blob
     * @throws {DOMException} If aborted via abortSignal
     * @throws {Error} If TTS generation fails after retries
     */
    async generateSpeechChunked(text, options = {}, onProgress, abortSignal) {
        const { voice, speed = 1 } = options;

        // Create chunker and split text
        const chunker = new TextChunker();
        const chunks = chunker.split(text);

        // Report initial status
        if (onProgress) {
            onProgress({
                current: 0,
                total: chunks.length,
                status: 'generating',
                message: `Preparing to generate ${chunks.length} chunk${chunks.length > 1 ? 's' : ''}...`
            });
        }

        const audioBlobs = [];
        const maxRetries = 3; // Number of retries (total 4 attempts)
        const baseDelay = 1000; // 1 second base delay for exponential backoff

        // Generate audio for each chunk sequentially
        for (let i = 0; i < chunks.length; i++) {
            // Check for abort before each chunk
            if (abortSignal?.aborted) {
                throw new DOMException('Audio generation was cancelled', 'AbortError');
            }

            // Report progress
            if (onProgress) {
                onProgress({
                    current: i + 1,
                    total: chunks.length,
                    status: 'generating',
                    message: `Generating chunk ${i + 1} of ${chunks.length}...`
                });
            }

            // Retry logic with exponential backoff
            let lastError = null;
            // attempt 0 is the first try, then up to maxRetries retries
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    // Check for abort before API call
                    if (abortSignal?.aborted) {
                        throw new DOMException('Audio generation was cancelled', 'AbortError');
                    }

                    const blob = await this.textToSpeech(chunks[i], voice, speed);
                    audioBlobs.push(blob);
                    lastError = null;
                    break; // Success, exit retry loop
                } catch (error) {
                    lastError = error;

                    // Don't retry for non-retryable errors (auth, invalid input, etc.)
                    if (this.isNonRetryableError(error)) {
                        throw new Error(`TTS failed on chunk ${i + 1}/${chunks.length}: ${error.message}`);
                    }

                    // If this wasn't the last attempt, wait with exponential backoff
                    if (attempt < maxRetries) {
                        const delay = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s
                        console.warn(`TTS chunk ${i + 1} attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error.message);

                        if (onProgress) {
                            onProgress({
                                current: i + 1,
                                total: chunks.length,
                                status: 'retrying',
                                message: `Chunk ${i + 1} failed, retrying (${attempt + 1}/${maxRetries})...`
                            });
                        }

                        await this.sleep(delay, abortSignal);
                    }
                }
            }

            // If all retries failed, throw error
            if (lastError) {
                throw new Error(`Failed to generate part ${i + 1} after multiple attempts: ${lastError.message}`);
            }
        }

        // Check for abort before concatenation
        if (abortSignal?.aborted) {
            throw new DOMException('Audio generation was cancelled', 'AbortError');
        }

        // Report concatenation status
        if (onProgress) {
            onProgress({
                current: chunks.length,
                total: chunks.length,
                status: 'concatenating',
                message: 'Combining audio chunks...'
            });
        }

        // Concatenate all audio blobs
        const concatenator = new AudioConcatenator();
        const combinedBlob = concatenator.concatenate(audioBlobs);

        // Report completion
        if (onProgress) {
            onProgress({
                current: chunks.length,
                total: chunks.length,
                status: 'complete',
                message: 'Audio generation complete!'
            });
        }

        return combinedBlob;
    }

    /**
     * Check if an error is non-retryable (e.g., auth error, invalid input)
     * @param {Error} error - The error to check
     * @returns {boolean} True if the error should not be retried
     */
    isNonRetryableError(error) {
        const message = error.message?.toLowerCase() || '';

        // Auth errors
        if (message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('forbidden')) {
            return true;
        }

        // Invalid input errors
        if (message.includes('400') || message.includes('bad request') || message.includes('invalid')) {
            return true;
        }

        // Rate limit - should retry
        if (message.includes('429') || message.includes('rate limit')) {
            return false;
        }

        // Default: retry network errors
        return false;
    }

    /**
     * Sleep for a specified duration, with abort support
     * @param {number} ms - Milliseconds to sleep
     * @param {AbortSignal} [abortSignal] - Optional abort signal
     * @returns {Promise<void>}
     */
    sleep(ms, abortSignal) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(resolve, ms);

            if (abortSignal) {
                const onAbort = () => {
                    clearTimeout(timeoutId);
                    reject(new DOMException('Sleep aborted', 'AbortError'));
                };

                if (abortSignal.aborted) {
                    clearTimeout(timeoutId);
                    reject(new DOMException('Sleep aborted', 'AbortError'));
                } else {
                    abortSignal.addEventListener('abort', onAbort, { once: true });
                }
            }
        });
    }
}

// Export for use in sidebar.js
// window.VeniceAPI = VeniceAPI;
