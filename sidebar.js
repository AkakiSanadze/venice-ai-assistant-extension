/**
 * sidebar.js
 * Main UI Controller for Venice AI Assistant
 */

/**
 * MarkdownWorkerManager - Manages Web Worker for markdown processing
 * Falls back to main-thread rendering if worker is not available
 */
class MarkdownWorkerManager {
    constructor() {
        this.worker = null;
        this.pendingRequests = new Map();
        this.requestId = 0;
        this.isReady = false;
        this.fallbackToMainThread = false;

        this.initWorker();
    }

    initWorker() {
        try {
            // Create worker from web accessible resource
            this.worker = new Worker(chrome.runtime.getURL('markdown-worker.js'));

            this.worker.onmessage = (e) => {
                const { type, result, id, error, isIncremental, newPart } = e.data;

                if (type === 'ready') {
                    this.isReady = true;
                    console.log('📝 Markdown Worker initialized');
                    return;
                }

                const pending = this.pendingRequests.get(id);
                if (pending) {
                    if (type === 'error' || error) {
                        pending.reject(new Error(error || 'Worker error'));
                    } else {
                        pending.resolve({ html: result, isIncremental, newPart });
                    }
                    this.pendingRequests.delete(id);
                }
            };

            this.worker.onerror = (e) => {
                console.error('Markdown Worker error:', e);
                this.fallbackToMainThread = true;
                // Reject all pending requests
                this.pendingRequests.forEach((pending, id) => {
                    pending.reject(new Error('Worker error'));
                });
                this.pendingRequests.clear();
            };
        } catch (e) {
            console.warn('Failed to initialize Markdown Worker, using main thread:', e);
            this.fallbackToMainThread = true;
        }
    }

    /**
     * Render markdown using worker (async) or fallback to main thread
     */
    async render(markdown) {
        if (this.fallbackToMainThread || !this.worker) {
            return MarkdownRenderer.render(markdown);
        }

        return new Promise((resolve, reject) => {
            const id = ++this.requestId;

            this.pendingRequests.set(id, {
                resolve: (result) => resolve(result.html),
                reject
            });

            // Timeout fallback
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    // Fallback to main thread on timeout
                    resolve(MarkdownRenderer.render(markdown));
                }
            }, 100);

            this.worker.postMessage({ type: 'render', content: markdown, id });
        });
    }

    /**
     * Incremental render for streaming content
     */
    async incrementalRender(newContent, fullContent) {
        if (this.fallbackToMainThread || !this.worker) {
            return MarkdownRenderer.incrementalRender(newContent, fullContent);
        }

        return new Promise((resolve, reject) => {
            const id = ++this.requestId;

            this.pendingRequests.set(id, { resolve, reject });

            // Timeout fallback
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    resolve(MarkdownRenderer.incrementalRender(newContent, fullContent));
                }
            }, 100);

            this.worker.postMessage({
                type: 'incremental',
                content: { newContent, fullContent },
                id
            });
        });
    }

    /**
     * Reset incremental rendering state
     */
    reset() {
        if (this.fallbackToMainThread || !this.worker) {
            MarkdownRenderer.resetIncremental();
            return;
        }

        this.worker.postMessage({ type: 'reset', id: ++this.requestId });
    }

    /**
     * Synchronous render for cases where async is not possible
     * Uses main thread directly
     */
    renderSync(markdown) {
        return MarkdownRenderer.render(markdown);
    }
}

/**
 * MultiTabContextManager - Manages multi-tab context feature
 * Allows users to select multiple tabs and include their content in AI context
 */
class MultiTabContextManager {
    constructor(app) {
        this.app = app;
        this.selectedTabs = new Map(); // tabId -> { id, title, url, content, tokenCount }
        this.isOpen = false;
        this.allTabs = [];
    }

    /**
     * Estimate token count from text
     * Approximation: ~4 chars per token
     */
    estimateTokens(text) {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    /**
     * Get all open tabs in the current window
     */
    async getAllTabs() {
        try {
            const tabs = await chrome.tabs.query({ currentWindow: true });
            return tabs.filter(tab => {
                // Filter out chrome:// and extension pages
                if (!tab.url) return false;
                if (tab.url.startsWith('chrome://')) return false;
                if (tab.url.startsWith('chrome-extension://')) return false;
                if (tab.url.startsWith('about:')) return false;
                return true;
            });
        } catch (e) {
            console.error('Failed to get tabs:', e);
            return [];
        }
    }

    /**
     * Fetch content from a specific tab
     * For YouTube video pages, extracts transcript instead of page text
     */
    async fetchTabContent(tabId) {
        try {
            // Get tab info to check if it's a YouTube video page
            const tab = this.allTabs.find(t => t.id === tabId);
            const isYouTubeVideo = tab?.url?.includes('youtube.com/watch') && tab.url.includes('v=');
            
            if (isYouTubeVideo) {
                // Try to get YouTube transcript first
                try {
                    const transcriptResponse = await chrome.tabs.sendMessage(tabId, { action: 'getYouTubeTranscript' });
                    if (transcriptResponse && transcriptResponse.transcript) {
                        // Limit content to prevent context overflow
                        const maxContentLength = 15000;
                        const content = transcriptResponse.transcript.length > maxContentLength
                            ? transcriptResponse.transcript.substring(0, maxContentLength) + '...'
                            : transcriptResponse.transcript;
                        return {
                            title: transcriptResponse.title || tab.title || 'YouTube Video',
                            url: tab.url,
                            content: `[YouTube Transcript]\n${content}`
                        };
                    }
                } catch (transcriptErr) {
                    console.warn('Failed to fetch YouTube transcript for tab:', tabId, transcriptErr);
                    // Fall through to regular page content
                }
            }
            
            // Default: get regular page content
            const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageContent' });
            if (response && response.content) {
                // Limit content to prevent context overflow
                const maxContentLength = 10000;
                const content = response.content.length > maxContentLength
                    ? response.content.substring(0, maxContentLength) + '...'
                    : response.content;
                return {
                    title: response.title || 'Unknown',
                    url: response.url || '',
                    content: content
                };
            }
        } catch (e) {
            console.warn('Failed to fetch content from tab:', tabId, e);
        }
        return null;
    }

    /**
     * Open the multi-tab selection modal
     */
    async openModal() {
        this.isOpen = true;
        this.app.els.multiTabModal.classList.remove('hidden');
        
        // Show loading state
        const listEl = document.getElementById('multi-tab-list');
        listEl.innerHTML = `
            <div class="multi-tab-loading">
                <div class="spinner"></div>
                <span>Loading tabs...</span>
            </div>
        `;

        // Get all tabs
        this.allTabs = await this.getAllTabs();
        
        // Render tab list
        this.renderTabList();
        this.updateStats();
        
        // Focus search input
        const searchInput = document.getElementById('multi-tab-search');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
    }

    /**
     * Close the modal
     */
    closeModal() {
        this.isOpen = false;
        this.app.els.multiTabModal.classList.add('hidden');
    }

    /**
     * Render the list of tabs in the modal
     */
    renderTabList(filter = '') {
        const listEl = document.getElementById('multi-tab-list');
        if (!listEl) return;

        // Filter tabs by search query
        const filteredTabs = filter
            ? this.allTabs.filter(tab => 
                tab.title?.toLowerCase().includes(filter.toLowerCase()) ||
                tab.url?.toLowerCase().includes(filter.toLowerCase())
              )
            : this.allTabs;

        if (filteredTabs.length === 0) {
            listEl.innerHTML = `
                <div class="multi-tab-empty">
                    <div class="empty-icon">📭</div>
                    <div class="empty-text">${filter ? 'No matching tabs found' : 'No tabs available'}</div>
                </div>
            `;
            return;
        }

        // Get current tab ID (the extension sidebar tab)
        const currentTab = this.allTabs.find(t => t.active);
        const currentTabId = currentTab?.id;

        listEl.innerHTML = filteredTabs.map(tab => {
            const isSelected = this.selectedTabs.has(tab.id);
            const isCurrentTab = tab.id === currentTabId;
            const favicon = tab.favIconUrl 
                ? `<img src="${tab.favIconUrl}" class="multi-tab-favicon" alt="">`
                : `<div class="multi-tab-favicon placeholder">📄</div>`;
            
            // Estimate tokens from cached content or mark as pending
            const cachedData = this.selectedTabs.get(tab.id);
            const tokenEstimate = cachedData?.tokenCount || '~?';

            return `
                <div class="multi-tab-item ${isSelected ? 'selected' : ''} ${isCurrentTab ? 'disabled' : ''}" 
                     data-tab-id="${tab.id}" 
                     tabindex="0"
                     role="option"
                     aria-selected="${isSelected}">
                    <div class="multi-tab-checkbox"></div>
                    ${favicon}
                    <div class="multi-tab-info-wrapper">
                        <div class="multi-tab-title">${this.escapeHtml(tab.title || 'Untitled')}</div>
                        <div class="multi-tab-url">${this.escapeHtml(tab.url || '')}</div>
                    </div>
                    ${isCurrentTab ? '<span class="multi-tab-current-badge">Current</span>' : ''}
                    <span class="multi-tab-tokens">~${tokenEstimate} tok</span>
                </div>
            `;
        }).join('');

        // Bind click events
        listEl.querySelectorAll('.multi-tab-item:not(.disabled)').forEach(item => {
            item.onclick = () => this.toggleTab(parseInt(item.dataset.tabId));
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggleTab(parseInt(item.dataset.tabId));
                }
            };
        });
    }

    /**
     * Toggle tab selection
     */
    async toggleTab(tabId) {
        if (this.selectedTabs.has(tabId)) {
            // Deselect
            this.selectedTabs.delete(tabId);
        } else {
            // Select - fetch content
            const tab = this.allTabs.find(t => t.id === tabId);
            if (!tab) return;

            // Show loading state for this tab
            const itemEl = document.querySelector(`.multi-tab-item[data-tab-id="${tabId}"]`);
            if (itemEl) {
                const tokenEl = itemEl.querySelector('.multi-tab-tokens');
                if (tokenEl) tokenEl.textContent = 'Loading...';
            }

            // Fetch content
            const content = await this.fetchTabContent(tabId);
            if (content) {
                this.selectedTabs.set(tabId, {
                    id: tabId,
                    title: tab.title || content.title,
                    url: tab.url || content.url,
                    content: content.content,
                    tokenCount: this.estimateTokens(content.content)
                });
            }
        }

        this.renderTabList(document.getElementById('multi-tab-search')?.value || '');
        this.updateStats();
    }

    /**
     * Select all tabs
     */
    async selectAll() {
        for (const tab of this.allTabs) {
            if (!this.selectedTabs.has(tab.id)) {
                const content = await this.fetchTabContent(tab.id);
                if (content) {
                    this.selectedTabs.set(tab.id, {
                        id: tab.id,
                        title: tab.title || content.title,
                        url: tab.url || content.url,
                        content: content.content,
                        tokenCount: this.estimateTokens(content.content)
                    });
                }
            }
        }
        this.renderTabList(document.getElementById('multi-tab-search')?.value || '');
        this.updateStats();
    }

    /**
     * Clear all selections
     */
    clearSelection() {
        this.selectedTabs.clear();
        this.renderTabList(document.getElementById('multi-tab-search')?.value || '');
        this.updateStats();
    }

    /**
     * Update statistics display
     */
    updateStats() {
        const countEl = document.getElementById('multi-tab-selected-count');
        const tokensEl = document.getElementById('multi-tab-tokens');
        
        const count = this.selectedTabs.size;
        let totalTokens = 0;
        this.selectedTabs.forEach(tab => {
            totalTokens += tab.tokenCount || 0;
        });

        if (countEl) {
            countEl.textContent = `${count} tab${count !== 1 ? 's' : ''} selected`;
        }
        if (tokensEl) {
            tokensEl.textContent = `~${totalTokens.toLocaleString()} tokens`;
        }

        // Update header badge
        const badgeEl = document.getElementById('multi-tab-count');
        if (badgeEl) {
            if (count > 0) {
                badgeEl.textContent = count;
                badgeEl.classList.remove('hidden');
            } else {
                badgeEl.classList.add('hidden');
            }
        }

        // Update button active state
        const btnEl = document.getElementById('multi-tab-btn');
        if (btnEl) {
            btnEl.classList.toggle('active', count > 0);
        }
    }

    /**
     * Get formatted context string from selected tabs
     */
    getContextString() {
        if (this.selectedTabs.size === 0) return '';

        const contexts = [];
        this.selectedTabs.forEach((tab, tabId) => {
            contexts.push(`
=== [Tab: ${tab.title}] ===
URL: ${tab.url}

${tab.content}
`);
        });

        return `\n\n[Additional Context from ${this.selectedTabs.size} tab${this.selectedTabs.size > 1 ? 's' : ''}]:\n${contexts.join('\n---\n')}`;
    }

    /**
     * Get total token count
     */
    getTotalTokens() {
        let total = 0;
        this.selectedTabs.forEach(tab => {
            total += tab.tokenCount || 0;
        });
        return total;
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

class App {
    constructor() {
        this.api = new VeniceAPI();
        this.currentConversation = null;
        this.currentModel = null;
        this.models = { text: [], image: [], vision: [] };
        this.isStreaming = false;
        this.activeSystemPromptIds = new Set();
        this.isWebSearchEnabled = false;
        this.isPageContextEnabled = true;
        this.currentImageB64 = null;
        this.currentTTSAudio = null;
        this.lastGeneratedText = '';
        this.lastGeneratedVoice = '';
        this.isTTSGenerating = false;
        this.attachedImages = [];
        this.attachedPdfContent = null;
        this.pinnedConversations = [];
        this.folders = [];
        this.currentFolderFilter = '';

        // Temporary chat mode flag - when true, chats are not saved to storage
        this.isTemporaryMode = false;

        // Multi-tab context manager
        this.multiTabContext = null;

        // Smart auto-scroll state
        this.autoScrollEnabled = true;   // whether auto-scroll is active
        this.userHasScrolled = false;    // whether user manually scrolled up

        // Web Worker for markdown processing (offloads from main thread)
        this.markdownWorker = new MarkdownWorkerManager();

        // Virtual scrolling state
        this.visibleMessageRange = { start: 0, end: 20 };
        this.messageHeightCache = new Map();
        this.averageMessageHeight = 150;
        this.virtualScrollEnabled = false; // Can be enabled for very long conversations

        // YouTube transcript deduplication
        this.currentYouTubeVideoId = null;

        // Chain-related state
        this.chainTemplates = [];
        this.activeChainTemplate = null;
        this.chainModeEnabled = false;
        this.chainExecutor = null;
        this.currentChainExecution = null;
        this.editingChainTemplate = null;
    }

    async init() {
        // 1. Bind UI Elements
        this.cacheElements();

        // 2. Apply theme early (before showing any screen)
        // This ensures the setup screen respects system theme on first load
        const settings = await Storage.getSettings();
        this.applyTheme(settings.theme);

        // 3. Load API Key
        const apiKey = await Storage.getApiKey();
        if (apiKey) {
            this.api.setApiKey(apiKey);
            await this.showMainApp();
        } else {
            this.showSetupScreen();
        }

        // 4. Bind Event Listeners
        this.bindEvents();

        // 5. Listen for messages from background/content-scripts
        this.bindRuntimeMessages();
    }

    bindRuntimeMessages() {
        // Placeholder for runtime message handling
        // Currently not needed but reserved for future use
    }

    cacheElements() {
        this.els = {
            setupScreen: document.getElementById('setup-screen'),
            mainApp: document.getElementById('main-app'),
            apiKeyInput: document.getElementById('api-key-input'),
            saveApiKeyBtn: document.getElementById('save-api-key'),

            chatContainer: document.getElementById('chat-container'),
            chatEmptyState: document.getElementById('chat-empty-state'),
            messageInput: document.getElementById('message-input'),
            sendBtn: document.getElementById('send-btn'),
            stopBtn: document.getElementById('stop-btn'),
            modelSelector: document.getElementById('model-selector'),
            newChatBtn: document.getElementById('new-chat-btn'),

            systemPromptsBar: document.getElementById('system-prompts-bar'),
            formatAndPrompts: document.getElementById('format-and-prompts'),

            webSearchToggle: document.getElementById('web-search-toggle'),
            pageContextToggle: document.getElementById('page-context-toggle'),
            temporaryChatToggle: document.getElementById('temporary-chat-toggle'),
            temporaryModeBanner: document.getElementById('temporary-mode-banner'),
            saveTemporaryChatBtn: document.getElementById('save-temporary-chat-btn'),
            imageUpload: document.getElementById('image-upload'),
            attachBtn: document.getElementById('attach-btn'),
            attachedImages: document.getElementById('attached-images'),
            pdfUpload: document.getElementById('pdf-upload'),
            pdfBtn: document.getElementById('pdf-btn'),
            attachedPdf: document.getElementById('attached-pdf'),

            navItems: document.querySelectorAll('.nav-item'),

            // Header buttons
            historyBtn: document.getElementById('history-btn'),
            settingsBtn: document.getElementById('settings-btn'),
            shareBtn: document.getElementById('share-btn'),
            shareDropdown: document.getElementById('share-dropdown'),
            copyMarkdownBtn: document.getElementById('copy-markdown-btn'),
            exportPdfBtn: document.getElementById('export-pdf-btn'),
            shareLinkBtn: document.getElementById('share-link-btn'),

            // Side Menu
            sideMenu: document.getElementById('side-menu'),
            menuOverlay: document.getElementById('side-menu-overlay'),
            menuToggleBtn: document.getElementById('menu-toggle-btn'),
            closeMenuBtn: document.getElementById('close-menu-btn'),
            menuHistoryBtn: document.getElementById('menu-history-btn'),
            menuSettingsBtn: document.getElementById('menu-settings-btn'),
            menuImportSharedBtn: document.getElementById('menu-import-shared-btn'),

            // Image view
            imagePrompt: document.getElementById('image-prompt'),
            imageModelSelector: document.getElementById('image-model-selector'),
            imageSizeSelector: document.getElementById('image-size-selector'),
            generateImageBtn: document.getElementById('generate-image-btn'),
            imageResult: document.getElementById('image-result'),
            imageActions: document.getElementById('image-actions'),
            downloadImageBtn: document.getElementById('download-image-btn'),
            copyImageBtn: document.getElementById('copy-image-btn'),

            // TTS view
            ttsInput: document.getElementById('tts-input'),
            voiceSelector: document.getElementById('voice-selector'),
            ttsBtn: document.getElementById('tts-btn'),
            audioContainer: document.getElementById('audio-container'),
            ttsActions: document.getElementById('tts-actions'),
            downloadTTSBtn: document.getElementById('download-tts-btn'),
            ttsCharCounter: document.getElementById('tts-char-counter'),
            ttsModifiedIndicator: document.getElementById('tts-modified-indicator'),
            voiceChangedIndicator: document.getElementById('voice-changed-indicator'),
            ttsLoading: document.getElementById('tts-loading'),
            ttsError: document.getElementById('tts-error'),
            ttsRetryBtn: document.getElementById('tts-retry-btn'),
            ttsProgressContainer: document.getElementById('tts-progress-container'),
            ttsProgressFill: document.getElementById('tts-progress-fill'),
            ttsProgressText: document.getElementById('tts-progress-text'),
            ttsCancelBtn: document.getElementById('tts-cancel-btn'),
            regenerateTTSBtn: document.getElementById('regenerate-tts-btn'),
            clearTTSBtn: document.getElementById('clear-tts-btn'),

            // Prompts view
            promptsList: document.getElementById('prompts-list'),
            addPromptBtn: document.getElementById('add-prompt-btn'),
            manageCategoriesBtn: document.getElementById('manage-categories-btn'),
            categoriesModal: document.getElementById('categories-modal'),
            categoriesModalClose: document.getElementById('categories-modal-close'),
            categoriesModalDone: document.getElementById('categories-modal-done'),
            categoriesList: document.getElementById('categories-list'),
            newCategoryEmoji: document.getElementById('new-category-emoji'),
            newCategoryLabel: document.getElementById('new-category-label'),
            addCategoryBtn: document.getElementById('add-category-btn'),

            // System prompts view
            systemPromptsList: document.getElementById('system-prompts-list'),
            addSystemPromptBtn: document.getElementById('add-system-prompt-btn'),

            // History view
            historyList: document.getElementById('history-list'),
            historySearch: document.getElementById('history-search'),
            folderFilter: document.getElementById('folder-filter'),
            addFolderBtn: document.getElementById('add-folder-btn'),
            foldersList: document.getElementById('folders-list'),
            clearAllHistoryBtn: document.getElementById('clear-all-history-btn'),

            // Settings view
            themeSelector: document.getElementById('theme-selector'),
            fontSizeSelector: document.getElementById('font-size-selector'),
            fontFamilySelector: document.getElementById('font-family-selector'),
            defaultModelSelector: document.getElementById('default-model-selector'),
            defaultTTSVoiceSelector: document.getElementById('default-tts-voice-selector'),
            settingsApiKey: document.getElementById('settings-api-key'),
            updateApiKeyBtn: document.getElementById('update-api-key-btn'),
            clearDataBtn: document.getElementById('clear-data-btn'),
            openSystemPromptsBtn: document.getElementById('open-system-prompts-btn'),
            exportDataBtn: document.getElementById('export-data-btn'),
            importDataBtn: document.getElementById('import-data-btn'),
            importFileInput: document.getElementById('import-file-input'),
            importSharedBtn: document.getElementById('import-shared-btn'),
            refreshModelsBtn: document.getElementById('refresh-models-btn'),

            // Scroll to bottom button
            scrollToBottomBtn: document.getElementById('scroll-to-bottom-btn'),

            // Model info tooltip
            modelInfoBtn: document.getElementById('model-info-btn'),
            modelInfoTooltip: document.getElementById('model-info-tooltip'),

            // Prompt Editor Modal
            promptEditorModal: document.getElementById('prompt-editor-modal'),
            promptEditorTitle: document.getElementById('prompt-editor-title'),
            promptEditorClose: document.getElementById('prompt-editor-close'),
            promptEditorName: document.getElementById('prompt-editor-name'),
            promptEditorContent: document.getElementById('prompt-editor-content'),
            promptEditorChars: document.getElementById('prompt-editor-chars'),
            promptEditorCancel: document.getElementById('prompt-editor-cancel'),
            promptEditorSave: document.getElementById('prompt-editor-save'),
            promptEditorCategory: document.getElementById('prompt-editor-category'),
            promptEditorCategoryGroup: document.getElementById('prompt-editor-category-group'),

            // Multi-Tab Context Modal
            multiTabBtn: document.getElementById('multi-tab-btn'),
            multiTabCount: document.getElementById('multi-tab-count'),
            multiTabModal: document.getElementById('multi-tab-modal')
        };

        // Prompt editor state
        this.promptEditorState = {
            type: null,  // 'user' or 'system'
            mode: null,  // 'create' or 'edit'
            existingPrompt: null
        };
    }

    bindEvents() {
        // Setup
        this.els.saveApiKeyBtn.onclick = () => this.handleSaveApiKey();

        // Chat
        this.els.sendBtn.onclick = () => this.handleSendMessage();
        this.els.messageInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        };
        this.els.stopBtn.onclick = () => this.stopGeneration();
        this.els.newChatBtn.onclick = () => this.startNewConversation();
        this.els.modelSelector.onchange = (e) => {
            this.currentModel = e.target.value;
            // Recalculate context usage with new model's limit
            this.updateContextUsage();
        };

        // Header buttons
        if (this.els.menuToggleBtn) this.els.menuToggleBtn.onclick = () => this.toggleMenu(true);
        if (this.els.closeMenuBtn) this.els.closeMenuBtn.onclick = () => this.toggleMenu(false);
        if (this.els.menuOverlay) this.els.menuOverlay.onclick = () => this.toggleMenu(false);

        // Side Menu secondary actions
        if (this.els.menuHistoryBtn) this.els.menuHistoryBtn.onclick = () => {
            this.toggleMenu(false);
            this.openHistory();
        };
        if (this.els.menuSettingsBtn) this.els.menuSettingsBtn.onclick = () => {
            this.toggleMenu(false);
            this.openSettings();
        };
        if (this.els.menuImportSharedBtn) this.els.menuImportSharedBtn.onclick = () => {
            this.toggleMenu(false);
            this.switchView('chat-view');
            this.els.importSharedBtn.click();
        };

        // Share button and dropdown
        if (this.els.shareBtn) {
            this.els.shareBtn.onclick = (e) => {
                e.stopPropagation();
                this.els.shareDropdown.classList.toggle('hidden');
            };
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (this.els.shareDropdown && !this.els.shareDropdown.contains(e.target) && !this.els.shareBtn.contains(e.target)) {
                if (!this.els.shareDropdown.classList.contains('hidden')) {
                    this.els.shareDropdown.classList.add('exiting');
                    setTimeout(() => {
                        this.els.shareDropdown.classList.add('hidden');
                        this.els.shareDropdown.classList.remove('exiting');
                    }, 150);
                }
            }
        });

        // Copy as Markdown
        if (this.els.copyMarkdownBtn) {
            this.els.copyMarkdownBtn.onclick = async () => {
                await this.handleCopyAsMarkdown();
                this.closeShareDropdown();
            };
        }

        // Export as PDF
        if (this.els.exportPdfBtn) {
            this.els.exportPdfBtn.onclick = async () => {
                await this.handleExportPdf();
                this.closeShareDropdown();
            };
        }

        // Share Link - Create shareable conversation data
        if (this.els.shareLinkBtn) {
            this.els.shareLinkBtn.onclick = async () => {
                await this.handleShareLink();
                this.closeShareDropdown();
            };
        }

        // View Navigation (footer/sidebar)
        this.els.navItems.forEach(item => {
            if (!item.dataset.view) return; // Skip items without view target (like secondary actions)

            item.onclick = () => this.switchView(item.dataset.view);
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.switchView(item.dataset.view);
                }
            };
        });

        // Global Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            // Esc to close panels/dropdowns
            if (e.key === 'Escape') {
                if (this.els.shareDropdown && !this.els.shareDropdown.classList.contains('hidden')) {
                    this.closeShareDropdown();
                } else if (!document.getElementById('chat-view').classList.contains('hidden')) {
                    // If in chat view, maybe clear input or something? 
                    // But usually Esc is for closing overlays.
                } else {
                    this.switchView('chat-view');
                }
            }

            // Ctrl+Enter to send (already handled in messageInput.onkeydown but good to have global if needed)
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                const activeEl = document.activeElement;
                if (activeEl === this.els.messageInput || activeEl === this.els.imagePrompt || activeEl === this.els.ttsInput) {
                    e.preventDefault();
                    if (activeEl === this.els.messageInput) this.handleSendMessage();
                    if (activeEl === this.els.imagePrompt) this.handleGenerateImage();
                    if (activeEl === this.els.ttsInput) this.handleTTS();
                }
            }
        });

        // Back buttons (all sub-views)
        document.querySelectorAll('.back-to-chat').forEach(btn => {
            btn.onclick = () => this.switchView('chat-view');
        });

        // Web Search
        this.els.webSearchToggle.onclick = () => {
            this.isWebSearchEnabled = !this.isWebSearchEnabled;
            this.els.webSearchToggle.classList.toggle('active', this.isWebSearchEnabled);
        };

        // Page Context Toggle
        this.els.pageContextToggle.onclick = async () => {
            this.isPageContextEnabled = !this.isPageContextEnabled;
            this.els.pageContextToggle.classList.toggle('active', this.isPageContextEnabled);
            await Storage.setPageContextEnabled(this.isPageContextEnabled);
        };

        // Temporary Chat Toggle
        if (this.els.temporaryChatToggle) {
            this.els.temporaryChatToggle.onclick = () => this.toggleTemporaryMode();
        }

        // Save Temporary Chat button
        if (this.els.saveTemporaryChatBtn) {
            this.els.saveTemporaryChatBtn.onclick = () => this.saveTemporaryChat();
        }

        // Images
        this.els.generateImageBtn.onclick = () => this.handleGenerateImage();
        if (this.els.downloadImageBtn) {
            this.els.downloadImageBtn.onclick = () => this.downloadGeneratedImage();
        }
        if (this.els.copyImageBtn) {
            this.els.copyImageBtn.onclick = () => this.copyGeneratedImage();
        }

        // TTS
        this.els.ttsBtn.onclick = () => this.handleTTS();
        if (this.els.downloadTTSBtn) {
            this.els.downloadTTSBtn.onclick = () => this.downloadTTS();
        }

        // TTS character counter and modification tracking
        if (this.els.ttsInput) {
            this.els.ttsInput.addEventListener('input', () => {
                this.updateTTSCharCounter();
                this.checkTTSModifications();
            });
        }

        // Voice selector change tracking
        if (this.els.voiceSelector) {
            this.els.voiceSelector.addEventListener('change', () => {
                this.checkTTSModifications();
            });
        }

        // Regenerate button
        if (this.els.regenerateTTSBtn) {
            this.els.regenerateTTSBtn.onclick = () => this.handleTTS();
        }

        // Clear button
        if (this.els.clearTTSBtn) {
            this.els.clearTTSBtn.onclick = () => this.clearTTS();
        }

        // Cancel button
        if (this.els.ttsCancelBtn) {
            this.els.ttsCancelBtn.onclick = () => this.cancelTTS();
        }

        // Retry button
        if (this.els.ttsRetryBtn) {
            this.els.ttsRetryBtn.onclick = () => this.handleTTS();
        }

        // Prompts
        if (this.els.addPromptBtn) {
            this.els.addPromptBtn.onclick = () => this.handleAddPrompt();
        }
        if (this.els.manageCategoriesBtn) {
            this.els.manageCategoriesBtn.onclick = () => this.openCategoriesModal();
        }
        if (this.els.categoriesModalClose) {
            this.els.categoriesModalClose.onclick = () => this.closeCategoriesModal();
        }
        if (this.els.categoriesModalDone) {
            this.els.categoriesModalDone.onclick = () => this.closeCategoriesModal();
        }
        if (this.els.addCategoryBtn) {
            this.els.addCategoryBtn.onclick = () => this.handleAddCategory();
        }
        if (this.els.newCategoryLabel) {
            this.els.newCategoryLabel.onkeydown = (e) => {
                if (e.key === 'Enter') this.handleAddCategory();
            };
        }
        if (this.els.categoriesModal) {
            this.els.categoriesModal.onclick = (e) => {
                if (e.target === this.els.categoriesModal) this.closeCategoriesModal();
            };
        }

        // System Prompts
        if (this.els.addSystemPromptBtn) {
            this.els.addSystemPromptBtn.onclick = () => this.handleAddSystemPrompt();
        }

        // Settings
        if (this.els.themeSelector) {
            this.els.themeSelector.onchange = async (e) => {
                const theme = e.target.value;
                this.applyTheme(theme);
                await Storage.updateSettings({ theme });
            };
        }

        // Listen for system theme changes
        this.initSystemThemeListener();
        if (this.els.fontSizeSelector) {
            this.els.fontSizeSelector.onchange = async (e) => {
                const fontSize = e.target.value;
                document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`);
                document.body.style.fontSize = `${fontSize}px`;
                await Storage.updateSettings({ fontSize });
            };
        }
        if (this.els.fontFamilySelector) {
            this.els.fontFamilySelector.onchange = async (e) => {
                const fontFamily = e.target.value;
                document.documentElement.style.setProperty('--font-main', `${fontFamily}, sans-serif`);
                document.body.fontFamily = `var(--font-main)`;
                await Storage.updateSettings({ fontFamily });
            };
        }
        if (this.els.updateApiKeyBtn) {
            this.els.updateApiKeyBtn.onclick = async () => {
                const key = this.els.settingsApiKey.value.trim();
                if (!key) return;
                this.api.setApiKey(key);
                const valid = await this.api.validateKey();
                if (valid) {
                    await Storage.setApiKey(key);
                    this.els.settingsApiKey.value = '';
                    alert('API key updated ✅');
                } else {
                    alert('Invalid API key');
                }
            };
        }
        if (this.els.defaultModelSelector) {
            this.els.defaultModelSelector.onchange = async (e) => {
                await Storage.updateSettings({ defaultModel: e.target.value });
            };
        }
        if (this.els.defaultTTSVoiceSelector) {
            this.els.defaultTTSVoiceSelector.onchange = async (e) => {
                await Storage.updateSettings({ defaultTTSVoice: e.target.value });
            };
        }
        if (this.els.clearDataBtn) {
            this.els.clearDataBtn.onclick = async () => {
                if (confirm('Are you sure you want to delete all data? This action cannot be undone.')) {
                    await chrome.storage.local.clear();
                    location.reload();
                }
            };
        }

        // Open system prompts management
        if (this.els.openSystemPromptsBtn) {
            this.els.openSystemPromptsBtn.onclick = () => {
                this.switchView('system-prompts-view');
                this.loadSystemPrompts();
            };
        }

        // Export all data
        if (this.els.exportDataBtn) {
            this.els.exportDataBtn.onclick = async () => {
                try {
                    const data = await Storage.exportAllData();
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `venice-ai-backup-${new Date().toISOString().split('T')[0]}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                    alert('✅ Data exported successfully!');
                } catch (e) {
                    alert('❌ Export error: ' + e.message);
                }
            };
        }

        // Import all data
        if (this.els.importDataBtn) {
            this.els.importDataBtn.onclick = () => {
                this.els.importFileInput.click();
            };
        }
        if (this.els.importFileInput) {
            this.els.importFileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const data = JSON.parse(text);

                    if (!confirm('This will replace all existing data. Do you want to continue?')) {
                        return;
                    }

                    await Storage.importAllData(data);
                    alert('✅ Data imported successfully! The page will reload.');
                    location.reload();
                } catch (e) {
                    alert('❌ Import error: ' + e.message);
                }
                e.target.value = '';
            };
        }

        // Import shared conversation
        if (this.els.importSharedBtn) {
            this.els.importSharedBtn.onclick = async () => {
                const shareString = prompt('Paste the shared chat text:');
                if (!shareString || !shareString.trim()) return;

                try {
                    const result = await Storage.importSharedConversation(shareString.trim());
                    if (result && result.success) {
                        alert('✅ Shared chat imported successfully!\n\nTitle: ' + result.conversation.title);
                        // Load the imported conversation
                        await this.loadConversation(result.conversation.id);
                    }
                } catch (e) {
                    alert('❌ Import error: ' + e.message);
                }
            };
        }

        // Refresh models button
        if (this.els.refreshModelsBtn) {
            this.els.refreshModelsBtn.onclick = async () => {
                await this.handleRefreshModels();
            };
        }

        // History search - use throttled input for better performance
        if (this.els.historySearch) {
            let searchTimeout;
            this.els.historySearch.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.loadHistory(this.els.historySearch.value);
                }, 150); // 150ms debounce
            }, { passive: true });
        }

        // Folder filter
        if (this.els.folderFilter) {
            this.els.folderFilter.onchange = (e) => {
                this.currentFolderFilter = e.target.value;
                this.loadHistory(this.els.historySearch?.value || '');
            };
        }

        // Add folder button
        if (this.els.addFolderBtn) {
            this.els.addFolderBtn.onclick = () => this.handleAddFolder();
        }

        // Clear all history button
        if (this.els.clearAllHistoryBtn) {
            this.els.clearAllHistoryBtn.onclick = () => this.handleClearAllHistory();
        }

        // Auto-resize textarea (on input and paste)
        const resizeInput = () => {
            const el = this.els.messageInput;
            // Disable any CSS transition during measurement to prevent height jumping
            el.style.transition = 'none';
            // IMPORTANT: set overflow-y to 'scroll' BEFORE reading scrollHeight.
            // Chrome returns scrollHeight=0 when overflow:hidden + height:0 — this forces correct measurement.
            el.style.overflowY = 'scroll';
            el.style.height = '0px';
            const scrollH = el.scrollHeight;
            el.style.height = Math.min(scrollH, 350) + 'px';
            el.style.overflowY = scrollH > 350 ? 'auto' : 'hidden';
        };
        this.els.messageInput.addEventListener('input', resizeInput, { passive: true });
        this.els.messageInput.addEventListener('paste', () => {
            // paste fires before DOM updates, so defer by one tick
            requestAnimationFrame(resizeInput);
        }, { passive: true });

        // Image upload
        if (this.els.attachBtn) {
            this.els.attachBtn.onclick = () => this.els.imageUpload.click();
        }
        if (this.els.imageUpload) {
            this.els.imageUpload.onchange = (e) => this.handleImageUpload(e);
        }

        // PDF upload
        if (this.els.pdfBtn) {
            this.els.pdfBtn.onclick = () => this.els.pdfUpload.click();
        }
        if (this.els.pdfUpload) {
            this.els.pdfUpload.onchange = (e) => this.handlePdfUpload(e);
        }

        // Paste image from clipboard
        document.addEventListener('paste', (e) => this.handleImagePaste(e));

        // === MULTI-TAB CONTEXT ===
        // Initialize multi-tab context manager
        this.multiTabContext = new MultiTabContextManager(this);

        // Multi-tab button
        if (this.els.multiTabBtn) {
            this.els.multiTabBtn.onclick = () => this.multiTabContext.openModal();
        }

        // Multi-tab modal close on overlay click
        if (this.els.multiTabModal) {
            this.els.multiTabModal.onclick = (e) => {
                if (e.target === this.els.multiTabModal) {
                    this.multiTabContext.closeModal();
                }
            };
        }

        // Multi-tab modal buttons (using event delegation for dynamically created elements)
        document.addEventListener('click', (e) => {
            // Close modal button - FIXED SELECTOR
            if (e.target.closest('#multi-tab-modal-close')) {
                this.multiTabContext.closeModal();
            }
            // Select all button
            if (e.target.closest('#multi-tab-select-all')) {
                this.multiTabContext.selectAll();
            }
            // Clear selection button
            if (e.target.closest('#multi-tab-clear')) {
                this.multiTabContext.clearSelection();
            }
            // Cancel button - ADD THIS
            if (e.target.closest('#multi-tab-cancel')) {
                this.multiTabContext.closeModal();
            }
            // Add to Context button - ADD THIS
            if (e.target.closest('#multi-tab-add')) {
                this.multiTabContext.closeModal();
                // The context is already stored in selectedTabs, 
                // it will be used when sending message
            }
        });

        // Multi-tab search input
        const multiTabSearch = document.getElementById('multi-tab-search');
        if (multiTabSearch) {
            multiTabSearch.addEventListener('input', (e) => {
                this.multiTabContext.renderTabList(e.target.value);
            });
        }

        // === MODEL INFO TOOLTIP ===
        if (this.els.modelInfoBtn && this.els.modelInfoTooltip) {
            this.els.modelInfoBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleModelInfoTooltip();
            };

            // Close tooltip when clicking outside
            document.addEventListener('click', (e) => {
                if (this.els.modelInfoTooltip && 
                    !this.els.modelInfoTooltip.classList.contains('hidden') &&
                    !this.els.modelInfoTooltip.contains(e.target) &&
                    !this.els.modelInfoBtn.contains(e.target)) {
                    this.els.modelInfoTooltip.classList.add('hidden');
                }
            });

            // Update tooltip content when model changes
            this.els.modelSelector.addEventListener('change', () => {
                this.updateModelInfoTooltip();
            });
        }

        // === PROMPT EDITOR MODAL ===
        if (this.els.promptEditorClose) {
            this.els.promptEditorClose.onclick = () => this.closePromptEditor();
        }
        if (this.els.promptEditorCancel) {
            this.els.promptEditorCancel.onclick = () => this.closePromptEditor();
        }
        if (this.els.promptEditorSave) {
            this.els.promptEditorSave.onclick = () => this.savePromptFromEditor();
        }
        if (this.els.promptEditorContent) {
            this.els.promptEditorContent.addEventListener('input', () => {
                this.updatePromptEditorCharCount();
            });
        }
        if (this.els.promptEditorModal) {
            this.els.promptEditorModal.onclick = (e) => {
                if (e.target === this.els.promptEditorModal) {
                    this.closePromptEditor();
                }
            };
        }
        // Escape key to close modal (additional handler)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.els.promptEditorModal && 
                !this.els.promptEditorModal.classList.contains('hidden')) {
                this.closePromptEditor();
            }
        });

        // === EVENT DELEGATION for dynamic content ===
        // This reduces the number of event listeners for dynamically created elements

        // Delegate history list events
        if (this.els.historyList) {
            this.els.historyList.addEventListener('click', (e) => {
                const target = e.target;
                const listItem = target.closest('.list-item');

                if (!listItem) return;

                // Handle different button clicks
                if (target.closest('.folder-conv-btn')) {
                    e.stopPropagation();
                    this.assignConversationToFolder(listItem.dataset.convId);
                    return;
                }
                if (target.closest('.pin-conv-btn')) {
                    e.stopPropagation();
                    this.togglePinConversation(listItem.dataset.convId);
                    return;
                }
                if (target.closest('.delete-conv-btn')) {
                    e.stopPropagation();
                    this.deleteConversation(listItem.dataset.convId);
                    return;
                }

                // Click on the list item itself loads the conversation
                this.loadConversation(listItem.dataset.convId);
            });
        }

        // Delegate prompts list events
        if (this.els.promptsList) {
            this.els.promptsList.addEventListener('click', async (e) => {
                const target = e.target;
                const editBtn = target.closest('.edit-prompt-btn');
                const deleteBtn = target.closest('.delete-prompt-btn');
                const promptUseBtn = target.closest('.prompt-use-btn');

                if (editBtn) {
                    e.stopPropagation();
                    const id = editBtn.dataset.promptId;
                    const prompts = await Storage.getPrompts();
                    const p = prompts.find(x => x.id === id);
                    this.openPromptEditor('user', 'edit', p);
                    return;
                }

                if (deleteBtn) {
                    e.stopPropagation();
                    this.handleDeletePrompt(deleteBtn.dataset.promptId);
                    return;
                }

                if (promptUseBtn) {
                    this.handleUsePrompt(promptUseBtn.dataset.promptId);
                }
            });
        }

        // Delegate system prompts list events
        if (this.els.systemPromptsList) {
            this.els.systemPromptsList.addEventListener('click', async (e) => {
                const target = e.target;
                const toggleBtn = target.closest('.toggle-sys-prompt-btn');
                const editBtn = target.closest('.edit-sys-prompt-btn');
                const deleteBtn = target.closest('.delete-sys-prompt-btn');

                if (toggleBtn) {
                    const id = toggleBtn.dataset.promptId;
                    const all = await Storage.getSystemPrompts();
                    const p = all.find(x => x.id === id);
                    p.enabled = !p.enabled;
                    await Storage.saveSystemPrompts(all);
                    this.renderSystemPromptChips(all);
                    this.renderSystemPromptsList(all);
                    return;
                }

                if (editBtn) {
                    const id = editBtn.dataset.promptId;
                    const all = await Storage.getSystemPrompts();
                    const p = all.find(x => x.id === id);
                    this.openPromptEditor('system', 'edit', p);
                    return;
                }

                if (deleteBtn) {
                    if (!confirm('Are you sure you want to delete this?')) return;
                    const id = deleteBtn.dataset.promptId;
                    const all = await Storage.getSystemPrompts();
                    const newPrompts = all.filter(p => p.id !== id);
                    await Storage.saveSystemPrompts(newPrompts);
                    this.renderSystemPromptChips(newPrompts);
                    this.renderSystemPromptsList(newPrompts);
                    return;
                }
            });
        }

        // Delegate chat container events for message actions
        if (this.els.chatContainer) {
            this.els.chatContainer.addEventListener('click', (e) => {
                const target = e.target;
                const messageEl = target.closest('.message');

                if (!messageEl) {
                    // Handle suggestion chips in empty state
                    const suggestionChip = target.closest('.suggestion-chip');
                    if (suggestionChip && suggestionChip.dataset.suggestion) {
                        this.els.messageInput.value = suggestionChip.dataset.suggestion;
                        this.els.messageInput.dispatchEvent(new Event('input'));
                        this.els.messageInput.focus();
                        return;
                    }
                    return;
                }

                // Handle message action buttons
                const editBtn = target.closest('.edit-msg-btn');
                const regenerateBtn = target.closest('.regenerate-btn');
                const copyBtn = target.closest('.copy-msg-btn');
                const expandBtn = target.closest('.message-expand-btn');

                if (editBtn) {
                    this.editMessage(parseInt(editBtn.dataset.index));
                    return;
                }

                if (regenerateBtn) {
                    this.regenerateMessage(parseInt(regenerateBtn.dataset.index));
                    return;
                }

                if (copyBtn) {
                    const msgIndex = parseInt(copyBtn.dataset.index);
                    const msgContent = this.currentConversation.messages[msgIndex]?.content || '';
                    navigator.clipboard.writeText(msgContent);
                    copyBtn.innerHTML = Icons.create('check', { size: 14 });
                    setTimeout(() => copyBtn.innerHTML = Icons.create('copy', { size: 14 }), 2000);
                    return;
                }

                // TTS button handler
                const ttsBtn = target.closest('.tts-msg-btn');
                if (ttsBtn) {
                    this.handleMessageTTS(parseInt(ttsBtn.dataset.index));
                    return;
                }

                if (expandBtn) {
                    messageEl.classList.remove('collapsed');
                    expandBtn.style.display = 'none';
                    return;
                }
            });
        }
    }

    // === MODEL INFO TOOLTIP ===

    /**
     * Toggle the model info tooltip visibility
     */
    toggleModelInfoTooltip() {
        if (!this.els.modelInfoTooltip) return;

        const isHidden = this.els.modelInfoTooltip.classList.contains('hidden');
        
        if (isHidden) {
            this.updateModelInfoTooltip();
            this.els.modelInfoTooltip.classList.remove('hidden');
        } else {
            this.els.modelInfoTooltip.classList.add('hidden');
        }
    }

    /**
     * Update the model info tooltip content with current model details
     */
    updateModelInfoTooltip() {
        if (!this.els.modelInfoTooltip || !this.currentModel) return;

        // Get pricing info from VeniceAPI
        const pricing = this.api.getModelPricing(this.currentModel);
        const contextLimit = this.api.getContextLimit(this.currentModel);

        // Build tooltip HTML
        this.els.modelInfoTooltip.innerHTML = `
            <div class="model-tooltip-header">
                <strong>${this.els.modelSelector.options[this.els.modelSelector.selectedIndex]?.text || this.currentModel}</strong>
            </div>
            <div class="model-tooltip-body">
                <div class="model-tooltip-row">
                    <span class="model-tooltip-label">Context:</span>
                    <span class="model-tooltip-value">${contextLimit ? contextLimit.toLocaleString() + ' tokens' : '—'}</span>
                </div>
                <div class="model-tooltip-row">
                    <span class="model-tooltip-label">Input:</span>
                    <span class="model-tooltip-value">${pricing?.input ? '$' + pricing.input.toFixed(6) + '/1K' : '—'}</span>
                </div>
                <div class="model-tooltip-row">
                    <span class="model-tooltip-label">Output:</span>
                    <span class="model-tooltip-value">${pricing?.output ? '$' + pricing.output.toFixed(6) + '/1K' : '—'}</span>
                </div>
                ${pricing?.notes ? `
                <div class="model-tooltip-notes">
                    <small>${pricing.notes}</small>
                </div>
                ` : ''}
            </div>
        `;
    }

    // === UI STATE MANAGEMENT ===

    /**
     * Show or hide the empty state based on conversation messages
     */
    updateEmptyState() {
        if (!this.els.chatEmptyState) return;

        const hasMessages = this.currentConversation &&
            this.currentConversation.messages &&
            this.currentConversation.messages.length > 0;

        this.els.chatEmptyState.classList.toggle('hidden', hasMessages);

        // Initialize icons in empty state if visible
        if (!hasMessages) {
            Icons.replaceAllInDocument();
        }
    }

    /**
     * Create a skeleton loader for assistant messages
     */
    createSkeletonLoader() {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-message skeleton-assistant';
        skeleton.innerHTML = `
            <div class="skeleton skeleton-avatar"></div>
            <div class="skeleton-content">
                <div class="skeleton skeleton-text" style="width: 80%"></div>
                <div class="skeleton skeleton-text" style="width: 60%"></div>
                <div class="skeleton skeleton-text" style="width: 40%"></div>
            </div>
        `;
        return skeleton;
    }

    /**
     * Create a typing indicator for assistant responses
     */
    createTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'typing-message';
        indicator.innerHTML = `
            <div class="typing-avatar">AI</div>
            <div class="typing-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        `;
        return indicator;
    }

    /**
     * Show an inline error message in the chat container
     */
    showInlineError(title, description, retryCallback = null) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.setAttribute('role', 'alert');

        let actionsHtml = '';
        if (retryCallback) {
            actionsHtml = `
                <div class="error-actions">
                    <button class="btn btn-sm btn-primary retry-btn">${Icons.create('refresh-cw', { size: 14 })} Retry</button>
                    <button class="btn btn-sm btn-ghost dismiss-btn">Dismiss</button>
                </div>
            `;
        }

        errorDiv.innerHTML = `
            <span class="error-icon">${Icons.create('alert-circle', { size: 20 })}</span>
            <div class="error-content">
                <div class="error-title">${title}</div>
                ${description ? `<div class="error-description">${description}</div>` : ''}
                ${actionsHtml}
            </div>
        `;

        // Bind retry button
        const retryBtn = errorDiv.querySelector('.retry-btn');
        if (retryBtn && retryCallback) {
            retryBtn.onclick = () => {
                errorDiv.remove();
                retryCallback();
            };
        }

        // Bind dismiss button
        const dismissBtn = errorDiv.querySelector('.dismiss-btn');
        if (dismissBtn) {
            dismissBtn.onclick = () => errorDiv.remove();
        }

        this.els.chatContainer.appendChild(errorDiv);
        this.els.chatContainer.scrollTop = this.els.chatContainer.scrollHeight;

        return errorDiv;
    }

    /**
     * Show a toast notification
     */
    showToast(message, type = 'info', duration = 3000) {
        // Remove existing toast
        const existingToast = document.querySelector('.error-toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = 'error-toast';

        const iconMap = {
            'info': 'info',
            'success': 'check-circle',
            'warning': 'alert-triangle',
            'error': 'alert-circle'
        };

        toast.innerHTML = `
            <span class="error-icon">${Icons.create(iconMap[type] || 'info', { size: 18 })}</span>
            <span class="error-text">${message}</span>
            <button class="error-close" aria-label="Close">${Icons.create('x', { size: 16 })}</button>
        `;

        toast.querySelector('.error-close').onclick = () => {
            toast.classList.add('exiting');
            setTimeout(() => toast.remove(), 200);
        };

        document.body.appendChild(toast);

        // Auto-remove after duration
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.add('exiting');
                setTimeout(() => toast.remove(), 200);
            }
        }, duration);
    }

    /**
     * Show loading indicator for YouTube transcript fetch
     */
    showTranscriptLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'transcript-loading';
        loadingDiv.innerHTML = `
            <div class="transcript-loading-content">
                <div class="transcript-loading-spinner"></div>
                <span class="transcript-loading-text">Fetching YouTube transcript...</span>
            </div>
        `;
        this.els.chatContainer.appendChild(loadingDiv);
        this.els.chatContainer.scrollTop = this.els.chatContainer.scrollHeight;
        return loadingDiv;
    }

    /**
     * Hide loading indicator for YouTube transcript fetch
     */
    hideTranscriptLoading(loadingEl) {
        if (loadingEl && loadingEl.parentElement) {
            loadingEl.classList.add('exiting');
            setTimeout(() => loadingEl.remove(), 200);
        }
    }

    showSetupScreen() {
        this.els.setupScreen.classList.remove('hidden');
        this.els.setupScreen.style.display = 'flex';
        this.els.mainApp.classList.add('hidden');
    }

    async showMainApp() {
        this.els.setupScreen.classList.add('hidden');
        this.els.setupScreen.style.display = 'none';
        this.els.mainApp.classList.remove('hidden');

        const settings = await Storage.getSettings();
        this.applyTheme(settings.theme);

        // Apply font settings
        if (settings.fontSize) {
            document.documentElement.style.setProperty('--font-size-base', `${settings.fontSize}px`);
            document.body.style.fontSize = `${settings.fontSize}px`;
        }
        if (settings.fontFamily) {
            document.documentElement.style.setProperty('--font-main', `${settings.fontFamily}, sans-serif`);
            document.body.fontFamily = `var(--font-main)`;
        }

        // Load page context toggle state
        this.isPageContextEnabled = await Storage.getPageContextEnabled();
        this.els.pageContextToggle.classList.toggle('active', this.isPageContextEnabled);

        await this.loadModels();
        await this.loadSystemPrompts();
        await this.loadUserPrompts();
        await this.startNewConversation();

        // Initialize smart auto-scroll
        this.initSmartScroll();

        // Initialize chain mode
        await this.initChainMode();
    }

    // === THEME MANAGEMENT ===

    /**
     * Get the system's preferred color scheme
     */
    getSystemTheme() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    /**
     * Apply theme - handles 'system' option by detecting OS preference
     */
    applyTheme(theme) {
        const effectiveTheme = theme === 'system' ? this.getSystemTheme() : theme;
        document.documentElement.setAttribute('data-theme', effectiveTheme);
    }

    /**
     * Initialize listener for system theme changes
     * Updates theme automatically when OS preference changes
     */
    initSystemThemeListener() {
        if (!window.matchMedia) return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        mediaQuery.addEventListener('change', async () => {
            // Only update if current setting is 'system'
            const settings = await Storage.getSettings();
            if (settings.theme === 'system') {
                this.applyTheme('system');
            }
        });
    }

    // === CHAIN MODE ===

    /**
     * Initialize chain mode functionality
     */
    async initChainMode() {
        // Load chain templates from storage
        this.chainTemplates = await window.storage.getChainTemplates();

        // Populate chain selector dropdown
        this.populateChainSelector();

        // Set up chain modal event listeners
        this.setupChainModalListeners();
    }

    /**
     * Populate the chain selector dropdown
     */
    populateChainSelector() {
        const selector = document.getElementById('chain-selector');
        if (!selector) return;

        selector.innerHTML = '<option value="">Select Chain...</option>';
        this.chainTemplates.forEach(template => {
            const option = document.createElement('option');
            option.value = template.id;
            option.textContent = template.name;
            selector.appendChild(option);
        });
    }

    /**
     * Set up event listeners for chain modal and controls
     */
    setupChainModalListeners() {
        // Chain config button
        document.getElementById('chain-config-btn')?.addEventListener('click', () => {
            this.openChainModal();
        });

        // Chain mode toggle
        document.getElementById('chain-mode-toggle')?.addEventListener('click', () => {
            this.toggleChainMode();
        });

        // Chain selector
        document.getElementById('chain-selector')?.addEventListener('change', (e) => {
            this.selectChainTemplate(e.target.value);
        });

        // Chain mode banner disable button
        document.getElementById('chain-mode-disable-btn')?.addEventListener('click', () => {
            this.toggleChainMode(); // This will turn off chain mode since it's currently enabled
        });

        // Modal close button
        document.getElementById('chain-modal-close')?.addEventListener('click', () => {
            this.closeChainModal();
        });

        // Close modal when clicking overlay (backdrop)
        document.getElementById('chain-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'chain-modal') {
                this.closeChainModal();
            }
        });

        // New template button
        document.getElementById('chain-new-template-btn')?.addEventListener('click', () => {
            this.createNewChainTemplate();
        });

        // Add step button
        document.getElementById('chain-add-step-btn')?.addEventListener('click', () => {
            this.addChainStep();
        });

        // Save template button
        document.getElementById('chain-save-btn')?.addEventListener('click', () => {
            this.saveCurrentChainTemplate();
        });

        // Delete template button
        document.getElementById('chain-delete-btn')?.addEventListener('click', () => {
            this.deleteCurrentChainTemplate();
        });

        // Stop chain execution button
        document.getElementById('chain-stop-btn')?.addEventListener('click', () => {
            this.stopChainExecution();
        });
    }

    /**
     * Open the chain configuration modal
     */
    openChainModal() {
        document.getElementById('chain-modal')?.classList.remove('hidden');
        this.renderChainTemplatesList();
    }

    /**
     * Close the chain configuration modal
     */
    closeChainModal() {
        document.getElementById('chain-modal')?.classList.add('hidden');
    }

    /**
     * Toggle chain mode on/off
     */
    toggleChainMode() {
        this.chainModeEnabled = !this.chainModeEnabled;
        const toggle = document.getElementById('chain-mode-toggle');
        const selector = document.getElementById('chain-selector');
        const banner = document.getElementById('chain-mode-banner');
        const chatView = document.getElementById('chat-view');

        if (this.chainModeEnabled) {
            toggle?.classList.add('active');
            selector?.classList.remove('hidden');
            banner?.classList.remove('hidden');
            chatView?.classList.add('chain-mode-active');
            // Update banner text
            this.updateChainModeBanner();
        } else {
            toggle?.classList.remove('active');
            selector?.classList.add('hidden');
            banner?.classList.add('hidden');
            chatView?.classList.remove('chain-mode-active');
            this.activeChainTemplate = null;
            // Reset selector
            if (selector) selector.value = '';
        }
    }

    /**
     * Update the chain mode banner with current template name
     */
    updateChainModeBanner() {
        const templateNameEl = document.getElementById('chain-mode-template-name');
        if (templateNameEl) {
            templateNameEl.textContent = this.activeChainTemplate?.name || 'No template selected';
        }
    }

    /**
     * Select a chain template from the dropdown
     */
    selectChainTemplate(templateId) {
        if (!templateId) {
            this.activeChainTemplate = null;
            this.updateChainModeBanner();
            return;
        }
        this.activeChainTemplate = this.chainTemplates.find(t => t.id === templateId);
        this.updateChainModeBanner();
    }

    /**
     * Render the list of chain templates in the modal
     */
    renderChainTemplatesList() {
        const list = document.getElementById('chain-templates-list');
        if (!list) return;

        list.innerHTML = '';

        if (this.chainTemplates.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:16px;">No chain templates yet. Create one to get started!</p>';
            return;
        }

        this.chainTemplates.forEach(template => {
            const item = document.createElement('div');
            item.className = 'chain-template-item';
            item.dataset.id = template.id;
            item.innerHTML = `
                <div class="chain-template-info">
                    <div class="chain-template-name">${template.name}</div>
                    <div class="chain-template-desc">${template.description || ''}</div>
                    <div class="chain-template-steps">${template.steps.length} steps</div>
                </div>
                <div class="chain-template-actions">
                    <button class="chain-use-btn" title="Use in Chat">💬 Use</button>
                </div>
            `;
            
            // Click on info area to edit
            item.querySelector('.chain-template-info').addEventListener('click', () => this.loadChainTemplate(template.id));
            
            // Click "Use" button to activate in chat
            item.querySelector('.chain-use-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.activateChainTemplate(template.id);
            });
            
            list.appendChild(item);
        });
    }

    /**
     * Activate a chain template and close modal
     * Enables chain mode, selects the template, and shows the banner
     */
    activateChainTemplate(templateId) {
        // Enable chain mode
        this.chainModeEnabled = true;
        
        // Set active template
        this.activeChainTemplate = this.chainTemplates.find(t => t.id === templateId);
        
        // Update UI
        const toggle = document.getElementById('chain-mode-toggle');
        const selector = document.getElementById('chain-selector');
        const banner = document.getElementById('chain-mode-banner');
        const chatView = document.getElementById('chat-view');
        
        toggle?.classList.add('active');
        selector?.classList.remove('hidden');
        banner?.classList.remove('hidden');
        chatView?.classList.add('chain-mode-active');
        
        // Set selector value
        if (selector) {
            selector.value = templateId;
        }
        
        // Show banner
        this.updateChainModeBanner();
        
        // Close modal
        this.closeChainModal();
    }

    /**
     * Load a chain template into the editor
     */
    loadChainTemplate(templateId) {
        const template = this.chainTemplates.find(t => t.id === templateId);
        if (!template) return;

        // Set active template in editor
        this.editingChainTemplate = template;

        // Populate editor fields
        document.getElementById('chain-name').value = template.name;
        document.getElementById('chain-description').value = template.description || '';

        // Render steps
        this.renderChainSteps(template.steps);

        // Highlight in list
        document.querySelectorAll('.chain-template-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === templateId);
        });
    }

    /**
     * Render chain steps in the editor
     */
    renderChainSteps(steps) {
        const container = document.getElementById('chain-steps-container');
        if (!container) return;

        container.innerHTML = '';

        steps.forEach((step, index) => {
            this.addChainStep(step, index);
        });
    }

    /**
     * Create a new empty chain template
     */
    createNewChainTemplate() {
        this.editingChainTemplate = {
            id: null,
            name: '',
            description: '',
            steps: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        document.getElementById('chain-name').value = '';
        document.getElementById('chain-description').value = '';
        document.getElementById('chain-steps-container').innerHTML = '';

        // Clear selection
        document.querySelectorAll('.chain-template-item').forEach(item => {
            item.classList.remove('active');
        });
    }

    /**
     * Add a step to the chain editor
     */
    addChainStep(stepData = null, index = null) {
        const container = document.getElementById('chain-steps-container');
        const template = document.getElementById('chain-step-template');

        if (!container) {
            console.error('Chain steps container not found');
            return;
        }

        if (!template) {
            console.error('Chain step template not found');
            return;
        }

        // Clone the template content
        const clone = template.content.cloneNode(true);

        // Find the step element within the clone (correct selector: .chain-step)
        const stepElement = clone.querySelector('.chain-step');

        if (!stepElement) {
            console.error('Chain step element not found in template');
            return;
        }

        // Set step index/order
        const stepIndex = container.children.length;
        stepElement.dataset.index = stepIndex;

        // Update step number display
        const stepNumberEl = stepElement.querySelector('.chain-step-number');
        if (stepNumberEl) {
            stepNumberEl.textContent = `Step ${stepIndex + 1}`;
        }

        // Populate model selector with available models
        const modelSelect = stepElement.querySelector('.chain-step-model');
        if (modelSelect && this.models && this.models.textModels) {
            // Clear existing options
            modelSelect.innerHTML = '<option value="">Select Model...</option>';
            
            // Add models from the app's model list
            this.models.textModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.model_spec?.name || model.id;
                modelSelect.appendChild(option);
            });
        }

        // Populate data if provided
        if (stepData) {
            const nameInput = stepElement.querySelector('.chain-step-name');
            const promptTextarea = stepElement.querySelector('.chain-step-prompt');
            const systemPromptTextarea = stepElement.querySelector('.chain-step-system');
            const webSearchToggle = stepElement.querySelector('.chain-step-web-search');
            const includePrevToggle = stepElement.querySelector('.chain-step-include-previous');

            if (nameInput) nameInput.value = stepData.name || `Step ${stepIndex + 1}`;
            if (modelSelect && stepData.model) modelSelect.value = stepData.model;
            if (promptTextarea) promptTextarea.value = stepData.promptTemplate || '';
            if (systemPromptTextarea) systemPromptTextarea.value = stepData.systemPrompt || '';
            if (webSearchToggle) webSearchToggle.checked = stepData.webSearch || false;
            if (includePrevToggle) includePrevToggle.checked = stepData.includePreviousOutput !== false; // default true
        }

        // Delete step button handler (correct selector: .chain-step-remove)
        const deleteBtn = stepElement.querySelector('.chain-step-remove');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                stepElement.remove();
                // Update step numbers after removal
                this.updateStepNumbers();
            });
        }

        // Append the clone (which contains the step element) to container
        container.appendChild(clone);
    }

    /**
     * Update step numbers after adding/removing steps
     */
    updateStepNumbers() {
        const container = document.getElementById('chain-steps-container');
        if (!container) return;

        const steps = container.querySelectorAll('.chain-step');
        steps.forEach((step, index) => {
            step.dataset.index = index;
            const stepNumberEl = step.querySelector('.chain-step-number');
            if (stepNumberEl) {
                stepNumberEl.textContent = `Step ${index + 1}`;
            }
        });
    }

    /**
     * Save the current chain template
     */
    async saveCurrentChainTemplate() {
        const name = document.getElementById('chain-name').value.trim();
        if (!name) {
            alert('Please enter a chain name');
            return;
        }

        const steps = [];
        document.querySelectorAll('.chain-step').forEach((stepEl, index) => {
            steps.push({
                id: `step-${Date.now()}-${index}`,
                order: index,
                name: stepEl.querySelector('.chain-step-name')?.value || `Step ${index + 1}`,
                model: stepEl.querySelector('.chain-step-model')?.value || '',
                promptTemplate: stepEl.querySelector('.chain-step-prompt')?.value || '',
                systemPrompt: stepEl.querySelector('.chain-step-system')?.value || '',
                webSearch: stepEl.querySelector('.chain-step-web-search')?.checked || false,
                includePreviousOutput: stepEl.querySelector('.chain-step-include-previous')?.checked !== false // default true
            });
        });

        if (steps.length === 0) {
            alert('Please add at least one step');
            return;
        }

        const template = {
            ...this.editingChainTemplate,
            name,
            description: document.getElementById('chain-description').value.trim(),
            steps,
            updatedAt: Date.now()
        };

        if (!template.id) {
            template.id = `chain-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            template.createdAt = Date.now();
        }

        await window.storage.saveChainTemplate(template);

        // Refresh templates
        this.chainTemplates = await window.storage.getChainTemplates();
        this.renderChainTemplatesList();
        this.populateChainSelector();

        alert('Chain template saved!');
    }

    /**
     * Delete the current chain template
     */
    async deleteCurrentChainTemplate() {
        if (!this.editingChainTemplate?.id) return;

        if (!confirm('Are you sure you want to delete this chain template?')) return;

        await window.storage.deleteChainTemplate(this.editingChainTemplate.id);

        // Refresh
        this.chainTemplates = await window.storage.getChainTemplates();
        this.renderChainTemplatesList();
        this.populateChainSelector();

        this.createNewChainTemplate();
    }

    /**
     * Execute a chain with the given user input
     */
    async executeChain(userInput) {
        if (!this.activeChainTemplate) {
            console.error('No active chain template');
            return;
        }

        // Show execution panel
        const panel = document.getElementById('chain-execution-panel');
        panel?.classList.remove('hidden');

        // Create executor
        this.chainExecutor = new window.ChainExecutor(this.api, this.activeChainTemplate);

        // Reset UI
        document.getElementById('chain-execution-title').textContent = this.activeChainTemplate.name;
        document.getElementById('chain-execution-progress').textContent = `Step 0 of ${this.activeChainTemplate.steps.length}`;
        document.getElementById('chain-progress-fill').style.width = '0%';
        document.getElementById('chain-execution-output').innerHTML = '';
        document.getElementById('chain-cost-accumulator').textContent = 'Cost: $0.0000';

        let totalCost = 0;

        try {
            const result = await this.chainExecutor.execute(
                userInput,
                // onStepStart
                (step, index) => {
                    document.getElementById('chain-execution-progress').textContent =
                        `Step ${index + 1} of ${this.activeChainTemplate.steps.length}`;
                    document.getElementById('chain-progress-fill').style.width =
                        `${((index + 1) / this.activeChainTemplate.steps.length) * 100}%`;

                    // Add step output container with improved structure
                    const outputArea = document.getElementById('chain-execution-output');
                    const stepDiv = document.createElement('div');
                    stepDiv.className = 'chain-step-output';
                    stepDiv.id = `step-output-${index}`;
                    
                    // Get model display name
                    const modelDisplayName = this.getModelDisplayName(step.model);
                    
                    stepDiv.innerHTML = `
                        <div class="chain-step-output-header">
                            <span class="step-number">Step ${index + 1}</span>
                            <span class="step-model-name">${modelDisplayName}</span>
                            <span class="step-status running">Running...</span>
                        </div>
                        <div class="chain-step-thinking" style="display: none;">
                            <div class="thinking-label">💭 Thinking:</div>
                            <div class="thinking-content"></div>
                        </div>
                        <div class="chain-step-output-content"></div>
                    `;
                    outputArea.appendChild(stepDiv);
                    
                    // Scroll to show the new step
                    outputArea.scrollTop = outputArea.scrollHeight;
                },
                // onStepProgress
                (step, index, chunk, thinking) => {
                    if (thinking) {
                        // Show thinking section
                        const thinkingSection = document.querySelector(`#step-output-${index} .chain-step-thinking`);
                        const thinkingContent = document.querySelector(`#step-output-${index} .thinking-content`);
                        if (thinkingSection && thinkingContent) {
                            thinkingSection.style.display = 'block';
                            thinkingContent.textContent = chunk; // Use textContent to avoid HTML issues
                        }
                    } else {
                        // Regular output - use innerHTML for markdown rendering
                        const contentEl = document.querySelector(`#step-output-${index} .chain-step-output-content`);
                        if (contentEl) {
                            contentEl.innerHTML = this.markdownWorker.renderSync(chunk);
                        }
                    }
                    
                    // Scroll to bottom of output area
                    const outputArea = document.getElementById('chain-execution-output');
                    if (outputArea) {
                        outputArea.scrollTop = outputArea.scrollHeight;
                    }
                },
                // onStepComplete
                (step, index, result) => {
                    const statusEl = document.querySelector(`#step-output-${index} .step-status`);
                    if (statusEl) {
                        statusEl.textContent = 'Completed';
                        statusEl.classList.remove('running');
                        statusEl.classList.add('completed');
                    }

                    // Update thinking section with final thinking content if available
                    if (result.thinking && result.thinking.trim()) {
                        const thinkingSection = document.querySelector(`#step-output-${index} .chain-step-thinking`);
                        const thinkingContent = document.querySelector(`#step-output-${index} .thinking-content`);
                        if (thinkingSection && thinkingContent) {
                            thinkingSection.style.display = 'block';
                            thinkingContent.textContent = result.thinking;
                        }
                    }

                    // Update cost
                    if (result.usage) {
                        // Calculate cost based on model (simplified)
                        const cost = this.calculateStepCost(result.model, result.usage);
                        totalCost += cost;
                        document.getElementById('chain-cost-accumulator').textContent =
                            `Cost: $${totalCost.toFixed(4)}`;
                    }
                },
                // onError
                (step, index, error) => {
                    const statusEl = document.querySelector(`#step-output-${index} .step-status`);
                    if (statusEl) {
                        statusEl.textContent = 'Failed';
                        statusEl.classList.remove('running');
                        statusEl.classList.add('failed');
                    }

                    console.error('Chain step error:', error);
                    this.handleChainError(error, index);
                }
            );

            // Chain completed successfully
            this.currentChainExecution = result;
            await window.storage.saveChainExecution(result);

            // Add final result to conversation
            this.addChainResultToConversation(result);

            // Save the conversation if not in temporary mode
            if (!this.isTemporaryMode) {
                // Update conversation title from first user message if this is the first exchange
                if (this.currentConversation.messages.length === 1 && 
                    this.currentConversation.messages[0].role === 'user') {
                    const userContent = this.currentConversation.messages[0].content;
                    this.currentConversation.title = userContent.substring(0, 40) + (userContent.length > 40 ? '...' : '');
                }
                await Storage.saveConversation(this.currentConversation);
            }

            // Auto-hide the execution panel after a short delay
            setTimeout(() => {
                const panel = document.getElementById('chain-execution-panel');
                if (panel && !panel.classList.contains('hidden')) {
                    panel.classList.add('hidden');
                }
            }, 2000); // 2 second delay to show "Completed" status

        } catch (error) {
            console.error('Chain execution failed:', error);
            // Don't auto-hide on error - let user see the error
        }
    }

    /**
     * Get a display-friendly model name from model ID
     * @param {string} modelId - The model ID
     * @returns {string} Display name for the model
     */
    getModelDisplayName(modelId) {
        if (!modelId) return 'Unknown Model';
        
        // Try to find the model in our loaded models list
        if (this.models && this.models.textModels) {
            const model = this.models.textModels.find(m => m.id === modelId);
            if (model && model.model_spec && model.model_spec.name) {
                return model.model_spec.name;
            }
        }
        
        // Fallback: clean up the model ID for display
        return modelId.split('/').pop().split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    /**
     * Stop the current chain execution
     */
    stopChainExecution() {
        if (this.chainExecutor) {
            this.chainExecutor.cancel();
        }

        document.getElementById('chain-execution-panel')?.classList.add('hidden');
    }

    /**
     * Handle chain execution error
     */
    handleChainError(error, stepIndex) {
        // Show error in execution panel
        const outputArea = document.getElementById('chain-execution-output');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'chain-error';
        errorDiv.innerHTML = `
            <div class="chain-error-header">Error in Step ${stepIndex + 1}</div>
            <div class="chain-error-message">${error.message || error}</div>
            <div class="chain-error-actions">
                <button class="btn-secondary" onclick="window.app.retryChainStep(${stepIndex})">Retry Step</button>
                <button class="btn-secondary" onclick="window.app.skipChainStep(${stepIndex})">Skip Step</button>
                <button class="btn-danger" onclick="window.app.stopChainExecution()">Abort Chain</button>
            </div>
        `;
        outputArea.appendChild(errorDiv);
    }

    /**
     * Retry a failed chain step
     */
    async retryChainStep(stepIndex) {
        // TODO: Implement retry logic
        console.log('Retry step:', stepIndex);
    }

    /**
     * Skip a failed chain step
     */
    async skipChainStep(stepIndex) {
        // TODO: Implement skip logic
        console.log('Skip step:', stepIndex);
    }

    /**
     * Calculate cost for a step based on model and usage
     */
    calculateStepCost(model, usage) {
        // Simplified cost calculation
        // In production, use actual pricing per model
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;

        // Rough estimates (adjust based on actual pricing)
        const promptCostPer1k = 0.001;
        const completionCostPer1k = 0.002;

        return (promptTokens * promptCostPer1k / 1000) +
               (completionTokens * completionCostPer1k / 1000);
    }

    /**
     * Add chain execution result to conversation
     */
    addChainResultToConversation(execution) {
        // Get the final output from the last step
        const finalResult = execution.results[execution.results.length - 1];
        if (!finalResult) return;

        // Add as assistant message
        this.currentConversation.messages.push({
            role: 'assistant',
            content: finalResult.output,
            modelName: finalResult.model,
            timestamp: Date.now(),
            chainExecution: execution
        });

        // Render the message
        this.renderMessage({
            role: 'assistant',
            content: finalResult.output,
            modelName: finalResult.model
        }, this.currentConversation.messages.length - 1);
    }

    async handleSaveApiKey() {
        const key = this.els.apiKeyInput.value.trim();
        if (!key) return;

        this.els.saveApiKeyBtn.disabled = true;
        this.api.setApiKey(key);

        const isValid = await this.api.validateKey();
        if (isValid) {
            await Storage.setApiKey(key);
            await this.showMainApp();
        } else {
            alert('Invalid API key');
            this.els.saveApiKeyBtn.disabled = false;
        }
    }

    /**
     * Handle refresh models button click
     * Clears cache and reloads models from API
     */
    async handleRefreshModels() {
        if (!this.els.refreshModelsBtn) return;

        // Show loading state
        const originalText = this.els.refreshModelsBtn.textContent;
        this.els.refreshModelsBtn.textContent = '⏳ Refreshing...';
        this.els.refreshModelsBtn.disabled = true;

        try {
            // Clear the models cache
            this.api.clearModelsCache();

            // Reload models from API
            await this.loadModels();

            // Show success message
            this.els.refreshModelsBtn.textContent = '✅ Updated!';
            this.els.refreshModelsBtn.style.background = 'var(--success)';

            setTimeout(() => {
                this.els.refreshModelsBtn.textContent = originalText;
                this.els.refreshModelsBtn.style.background = '';
                this.els.refreshModelsBtn.disabled = false;
            }, 2000);

        } catch (error) {
            console.error('Failed to refresh models:', error);
            this.els.refreshModelsBtn.textContent = '❌ Error';
            this.els.refreshModelsBtn.style.background = 'var(--error)';

            setTimeout(() => {
                this.els.refreshModelsBtn.textContent = originalText;
                this.els.refreshModelsBtn.style.background = '';
                this.els.refreshModelsBtn.disabled = false;
            }, 2000);
        }
    }

    async loadModels() {
        try {
            this.models = await this.api.fetchModels();

            // Populate Text Models
            this.els.modelSelector.innerHTML = this.models.textModels.map(m =>
                `<option value="${m.id}">${m.model_spec?.name || m.id}</option>`
            ).join('');

            const settings = await Storage.getSettings();
            if (settings.defaultModel && this.models.textModels.find(m => m.id === settings.defaultModel)) {
                this.els.modelSelector.value = settings.defaultModel;
            }
            this.currentModel = this.els.modelSelector.value;

            // Populate Default Model Selector in Settings
            if (this.els.defaultModelSelector) {
                this.els.defaultModelSelector.innerHTML = this.models.textModels.map(m =>
                    `<option value="${m.id}">${m.model_spec?.name || m.id}</option>`
                ).join('');
                if (settings.defaultModel) {
                    this.els.defaultModelSelector.value = settings.defaultModel;
                }
            }

            // Populate Image Models
            if (this.models.imageModels && this.models.imageModels.length > 0) {
                this.els.imageModelSelector.innerHTML = this.models.imageModels.map(m =>
                    `<option value="${m.id}">${m.model_spec?.name || m.id}</option>`
                ).join('');
            } else {
                console.warn('⚠️ No image models available');
                this.els.imageModelSelector.innerHTML = '<option value="">No models found</option>';
            }

            // Populate Voices
            const voices = [
                { id: 'af_sky', name: 'Sky (US Female)' },
                { id: 'am_adam', name: 'Adam (US Male)' },
                { id: 'bf_emma', name: 'Emma (UK Female)' }
            ];
            this.els.voiceSelector.innerHTML = voices.map(v =>
                `<option value="${v.id}">${v.name}</option>`
            ).join('');

        } catch (e) {
            console.error('Failed to load models', e);
        }
    }

    async loadSystemPrompts() {
        const prompts = await Storage.getSystemPrompts();
        this.renderSystemPromptChips(prompts);
        this.renderSystemPromptsList(prompts);
    }

    renderSystemPromptsList(prompts) {
        if (!this.els.systemPromptsList) return;

        this.els.systemPromptsList.innerHTML = prompts.map(p => `
            <div class="list-item" data-prompt-id="${p.id}" draggable="true" tabindex="0" role="button" aria-label="System prompt: ${p.title}, ${p.enabled ? 'enabled' : 'disabled'}">
                <div class="drag-handle">${Icons.create('grip-vertical', { size: 16 })}</div>
                <div style="flex:1;">
                    <strong>${p.title}</strong>
                    <div class="text-sm" style="color:var(--text-muted); margin-top:4px;">${p.content.substring(0, 80)}...</div>
                    <div class="text-xs" style="color:var(--text-secondary); margin-top:4px;">
                        ${p.enabled ? '✅ Enabled' : '⏸️ Disabled'}
                    </div>
                </div>
                <div style="display:flex; gap:4px;">
                    <button class="btn btn-icon toggle-sys-prompt-btn text-xs" data-prompt-id="${p.id}" title="${p.enabled ? 'Disable' : 'Enable'}" aria-label="${p.enabled ? 'Disable' : 'Enable'}" style="width:24px; height:24px;">${Icons.create(p.enabled ? 'pause' : 'play', { size: 14 })}</button>
                    <button class="btn btn-icon edit-sys-prompt-btn text-xs" data-prompt-id="${p.id}" title="Edit" aria-label="Edit" style="width:24px; height:24px;">${Icons.create('pencil', { size: 14 })}</button>
                    <button class="btn btn-icon delete-sys-prompt-btn text-xs" data-prompt-id="${p.id}" title="Delete" aria-label="Delete" style="width:24px; height:24px;">${Icons.create('trash-2', { size: 14 })}</button>
                </div>
            </div>
        `).join('');

        // Add keyboard support for system prompt items
        this.els.systemPromptsList.querySelectorAll('.list-item').forEach(item => {
            item.onkeydown = async (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    if (e.target === item) {
                        e.preventDefault();
                        const id = item.dataset.promptId;
                        const all = await Storage.getSystemPrompts();
                        const p = all.find(x => x.id === id);
                        p.enabled = !p.enabled;
                        await Storage.saveSystemPrompts(all);
                        this.renderSystemPromptChips(all);
                        this.renderSystemPromptsList(all);
                    }
                }
            };
        });

        // Initialize drag and drop reordering
        this.initDragAndDrop(this.els.systemPromptsList, async (newOrderIds) => {
            const all = await Storage.getSystemPrompts();
            const reordered = newOrderIds.map(id => all.find(p => p.id === id)).filter(Boolean);
            await Storage.saveSystemPrompts(reordered);
            this.renderSystemPromptChips(reordered);
        });
    }

    async handleAddSystemPrompt() {
        this.openPromptEditor('system', 'create');
    }

    renderSystemPromptChips(prompts) {
        const container = this.els.systemPromptsBar;
        container.innerHTML = prompts.map(p => `
      <div class="chip ${p.enabled ? 'active' : ''}" data-id="${p.id}">${p.title}</div>
    `).join('') + `<div class="chip" id="manage-system-prompts" title="Manage">${Icons.create('clipboard-list', { size: 16 })}</div>`;

        container.querySelectorAll('.chip[data-id]').forEach(chip => {
            chip.onclick = async () => {
                const id = chip.dataset.id;
                const all = await Storage.getSystemPrompts();
                const p = all.find(x => x.id === id);
                p.enabled = !p.enabled;
                await Storage.saveSystemPrompts(all);
                chip.classList.toggle('active', p.enabled);
                this.renderSystemPromptsList(all);
            };
        });

        // Bind manage button
        const manageBtn = container.querySelector('#manage-system-prompts');
        if (manageBtn) {
            manageBtn.onclick = () => {
                this.switchView('system-prompts-view');
                this.loadSystemPrompts();
            };
        }
    }

    // === VIEW SWITCHING (only targets .sub-view inside #main-app) ===

    switchView(viewId) {
        // Hide all sub-views
        document.querySelectorAll('.sub-view').forEach(v => v.classList.add('hidden'));
        // Show target
        const target = document.getElementById(viewId);
        if (target) target.classList.remove('hidden');

        // Update nav items active state (both in menu and elsewhere if any)
        document.querySelectorAll('.nav-item').forEach(item => {
            const isActive = item.dataset.view === viewId;
            item.classList.toggle('active', isActive);
            if (isActive) {
                item.setAttribute('aria-current', 'page');
            } else {
                item.removeAttribute('aria-current');
            }
        });

        // Close menu after selection
        this.toggleMenu(false);

        // Announce view change to screen readers
        const viewName = target?.getAttribute('aria-label') || 'View';
        this.announceToScreenReader(`Switched to view: ${viewName}`);
    }

    toggleMenu(show) {
        if (!this.els.sideMenu || !this.els.menuOverlay) return;

        if (show) {
            this.els.sideMenu.classList.add('open');
            this.els.menuOverlay.classList.remove('hidden');
        } else {
            this.els.sideMenu.classList.remove('open');
            this.els.menuOverlay.classList.add('hidden');
        }
    }

    /**
     * Announce message to screen readers using the live region
     */
    announceToScreenReader(message) {
        const announcer = document.getElementById('sr-announcer');
        if (announcer) {
            announcer.textContent = '';
            setTimeout(() => {
                announcer.textContent = message;
            }, 100);
        }
    }

    // === SETTINGS ===

    async openSettings() {
        this.switchView('settings-view');
        // Sync current settings
        const settings = await Storage.getSettings();
        if (this.els.themeSelector) {
            this.els.themeSelector.value = settings.theme;
        }
        if (this.els.fontSizeSelector && settings.fontSize) {
            this.els.fontSizeSelector.value = settings.fontSize;
        }
        if (this.els.fontFamilySelector && settings.fontFamily) {
            this.els.fontFamilySelector.value = settings.fontFamily;
        }
        if (this.els.defaultTTSVoiceSelector && settings.defaultTTSVoice) {
            this.els.defaultTTSVoiceSelector.value = settings.defaultTTSVoice;
        }
    }

    // === SHARE / EXPORT ===

    async handleCopyAsMarkdown() {
        if (!this.currentConversation || !this.currentConversation.id) {
            alert('No chat is open');
            return;
        }

        try {
            // Check if conversation has been saved (has a real ID from storage)
            const conv = await Storage.getConversation(this.currentConversation.id);
            if (!conv || !conv.messages || conv.messages.length === 0) {
                alert('Chat is empty');
                return;
            }

            // Export conversation as markdown
            const markdown = await Storage.exportConversation(this.currentConversation.id, 'md');
            if (!markdown) {
                alert('Could not export chat');
                return;
            }

            // Copy to clipboard
            await navigator.clipboard.writeText(markdown);

            // Show success toast
            alert('✅ Copied!');
        } catch (err) {
            console.error('Copy as markdown error:', err);
            alert('Error: ' + err.message);
        }
    }

    async handleExportPdf() {
        if (!this.currentConversation || !this.currentConversation.id) {
            alert('No chat is open');
            return;
        }

        try {
            // Get the conversation from storage to ensure we have all data
            const conv = await Storage.getConversation(this.currentConversation.id);
            if (!conv || !conv.messages || conv.messages.length === 0) {
                alert('Chat is empty');
                return;
            }

            // Show loading state on the button
            const originalText = this.els.exportPdfBtn.textContent;
            this.els.exportPdfBtn.textContent = '⏳...';
            this.els.exportPdfBtn.disabled = true;

            // Export as PDF
            const result = await window.PDFExport.downloadPDF(conv);

            // Reset button state
            this.els.exportPdfBtn.textContent = originalText;
            this.els.exportPdfBtn.disabled = false;

            if (result && result.success) {
                alert('✅ PDF downloaded successfully: ' + result.filename);
            }
        } catch (err) {
            console.error('PDF export error:', err);
            // Reset button state on error
            if (this.els.exportPdfBtn) {
                this.els.exportPdfBtn.disabled = false;
            }
            alert('❌ PDF export error: ' + err.message);
        }
    }

    async handleShareLink() {
        if (!this.currentConversation || !this.currentConversation.id) {
            alert('No chat is open');
            return;
        }

        try {
            // Get the conversation from storage to ensure we have all data
            const conv = await Storage.getConversation(this.currentConversation.id);
            if (!conv || !conv.messages || conv.messages.length === 0) {
                alert('Chat is empty');
                return;
            }

            // Create shareable data object
            const shareData = {
                version: 1,
                type: 'venice-ai-conversation',
                exportedAt: new Date().toISOString(),
                title: conv.title,
                messages: conv.messages.map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    thinking: msg.thinking || null,
                    modelName: msg.modelName || null,
                    timestamp: msg.timestamp || null
                }))
            };

            // Encode to base64
            const jsonString = JSON.stringify(shareData);
            const base64Data = btoa(unescape(encodeURIComponent(jsonString)));

            // Create shareable text format
            const shareText = `[VeniceAI Share]

---DATA---
${base64Data}

---END---

To import this shared chat, copy this data and use the "Import Shared Chat" function in Settings.`;

            // Copy to clipboard
            await navigator.clipboard.writeText(shareText);

            // Show success message
            alert('✅ Share link copied!\n\nChat shared in Base64 format.\nRecipient can import it from Settings.');
        } catch (err) {
            console.error('Share link error:', err);
            alert('❌ Share error: ' + err.message);
        }
    }

    // === HISTORY ===

    async openHistory() {
        this.switchView('history-view');
        await this.loadFolders();
        await this.loadHistory();
    }

    async loadFolders() {
        this.folders = await Storage.getFolders();
        this.renderFolders();
    }

    renderFolders() {
        if (!this.els.folderFilter) return;

        // Update folder filter dropdown
        this.els.folderFilter.innerHTML = '<option value="">All Folders</option>' +
            this.folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');

        // Update folders list
        if (this.els.foldersList) {
            if (this.folders.length === 0) {
                this.els.foldersList.innerHTML = '';
                return;
            }

            this.els.foldersList.innerHTML = this.folders.map(f => `
                <div class="folder-item" data-folder-id="${f.id}">
                    <span>${Icons.create('folder', { size: 16 })} ${f.name}</span>
                    <button class="btn btn-icon delete-folder-btn text-xs" data-folder-id="${f.id}" style="width:24px; height:24px;">${Icons.create('trash-2', { size: 14 })}</button>
                </div>
            `).join('');

            // Bind delete buttons
            this.els.foldersList.querySelectorAll('.delete-folder-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.handleDeleteFolder(btn.dataset.folderId);
                };
            });
        }
    }

    async handleAddFolder() {
        const name = prompt('Folder name:');
        if (!name || !name.trim()) return;

        const folder = {
            id: crypto.randomUUID(),
            name: name.trim(),
            createdAt: Date.now()
        };

        await Storage.saveFolder(folder);
        await this.loadFolders();
    }

    async handleDeleteFolder(id) {
        if (!confirm('Are you sure you want to delete this folder?')) return;
        await Storage.deleteFolder(id);
        await this.loadFolders();
    }

    async handleClearAllHistory() {
        if (!confirm('Are you sure you want to delete all chats? This action cannot be undone.')) return;
        await Storage.deleteAllConversations();
        await this.loadHistory();
    }

    async loadHistory(query = '') {
        let conversations;
        if (query) {
            conversations = await Storage.searchConversations(query);
        } else {
            conversations = await Storage.getAllConversations();
        }

        // Load pinned conversations
        this.pinnedConversations = await Storage.getPinnedConversations();

        // Filter by folder if selected
        if (this.currentFolderFilter) {
            conversations = conversations.filter(c => c.folderId === this.currentFolderFilter);
        }

        // Sort: pinned first, then by date
        conversations.sort((a, b) => {
            const aPinned = this.pinnedConversations.includes(a.id);
            const bPinned = this.pinnedConversations.includes(b.id);
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            return b.updatedAt - a.updatedAt;
        });

        this.renderHistory(conversations);
    }

    renderHistory(conversations) {
        if (!this.els.historyList) return;

        if (conversations.length === 0) {
            this.els.historyList.innerHTML = '<p style="color:var(--text-muted); text-align:center; margin-top:32px;">History is empty</p>';
            return;
        }

        this.els.historyList.innerHTML = conversations.map(c => {
            const date = new Date(c.updatedAt).toLocaleDateString('en-US');
            const msgCount = c.messages?.length || 0;
            const isPinned = this.pinnedConversations?.includes(c.id);
            const folder = this.folders.find(f => f.id === c.folderId);
            return `
                <div class="list-item ${isPinned ? 'pinned' : ''}" data-conv-id="${c.id}" tabindex="0" role="button" aria-label="Conversation: ${c.title}, ${date}, ${msgCount} messages">
                    <div style="flex:1;">
                        <strong>${isPinned ? Icons.create('pin', { size: 14 }) + ' ' : ''}${c.title}</strong>
                        <div class="text-sm" style="color:var(--text-muted);">${date} · ${msgCount} messages${folder ? ` · ${Icons.create('folder', { size: 12 })} ${folder.name}` : ''}</div>
                    </div>
                    <div style="display:flex; gap:4px;">
                        <button class="btn btn-icon folder-conv-btn text-xs" data-conv-id="${c.id}" title="Move to folder" aria-label="Move to folder" style="width:24px; height:24px;">${Icons.create('folder', { size: 14 })}</button>
                        <button class="btn btn-icon pin-conv-btn text-xs" data-conv-id="${c.id}" title="${isPinned ? 'Unpin' : 'Pin'}" aria-label="${isPinned ? 'Unpin' : 'Pin'}" style="width:24px; height:24px; opacity:${isPinned ? 1 : 0.5}">${Icons.create('pin', { size: 14 })}</button>
                        <button class="btn btn-icon delete-conv-btn text-xs" data-conv-id="${c.id}" title="Delete" aria-label="Delete" style="width:24px; height:24px;">${Icons.create('trash-2', { size: 14 })}</button>
                    </div>
                </div>
            `;
        }).join('');

        // Add keyboard support for history items
        this.els.historyList.querySelectorAll('.list-item').forEach(item => {
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    if (e.target === item) {
                        e.preventDefault();
                        this.loadConversation(item.dataset.convId);
                    }
                }
            };
        });
    }

    async loadConversation(id) {
        const conv = await Storage.getConversation(id);
        if (!conv) return;

        // Exit temporary mode when loading a saved conversation
        if (this.isTemporaryMode) {
            this.isTemporaryMode = false;
            this.els.temporaryChatToggle.classList.remove('active');
            this.els.temporaryModeBanner.classList.add('hidden');
            document.getElementById('chat-view').classList.remove('temporary-mode');
        }

        this.currentConversation = conv;

        // Backward compatibility for old conversations without metadata
        if (!this.currentConversation.metadata) {
            this.currentConversation.metadata = {
                youtubeTranscript: null,
                youtubeVideoId: null,
                pageContext: null
            };
        }
        this.currentYouTubeVideoId = this.currentConversation.metadata?.youtubeVideoId || null;

        this.els.chatContainer.innerHTML = '';

        // Reset virtual scroll state
        this.visibleMessageRange = { start: 0, end: 20 };
        this.messageHeightCache.clear();

        // Check if virtual scrolling should be enabled
        this.checkEnableVirtualScroll();

        // For long conversations, only render visible messages initially
        const messageCount = conv.messages.length;
        const initialRenderCount = this.virtualScrollEnabled ? Math.min(20, messageCount) : messageCount;

        for (let i = 0; i < initialRenderCount; i++) {
            this.renderMessage(conv.messages[i], i);
        }

        // Show empty state if no messages
        this.updateEmptyState();

        // If virtual scrolling, scroll to bottom and show indicator
        if (this.virtualScrollEnabled && messageCount > 20) {
            this.els.chatContainer.scrollTop = this.els.chatContainer.scrollHeight;

            // Add "load more" indicator at top
            const loadMoreIndicator = document.createElement('div');
            loadMoreIndicator.className = 'load-more-messages';
            loadMoreIndicator.innerHTML = `<button class="load-more-btn">↑ Load older messages (${messageCount - 20} more)</button>`;
            loadMoreIndicator.querySelector('.load-more-btn').onclick = () => this.loadMoreMessages('top');
            this.els.chatContainer.insertBefore(loadMoreIndicator, this.els.chatContainer.firstChild);
        }

        // Update context usage display for loaded conversation
        this.updateContextUsage();

        this.switchView('chat-view');
    }

    async deleteConversation(id) {
        if (!confirm('Are you sure you want to delete this?')) return;

        // Find and animate the list item
        const listItem = this.els.historyList.querySelector(`[data-conv-id="${id}"]`);
        if (listItem) {
            await this.removeWithAnimation(listItem, 'exiting', 200);
        }

        await Storage.deleteConversation(id);
        await this.loadHistory(this.els.historySearch?.value || '');
    }

    async togglePinConversation(id) {
        await Storage.togglePinConversation(id);
        await this.loadHistory(this.els.historySearch?.value || '');
    }

    // === TEMPORARY CHAT MODE ===

    toggleTemporaryMode() {
        this.isTemporaryMode = !this.isTemporaryMode;

        // Update toggle button visual state
        this.els.temporaryChatToggle.classList.toggle('active', this.isTemporaryMode);

        // Show/hide banner
        this.els.temporaryModeBanner.classList.toggle('hidden', !this.isTemporaryMode);

        // Add/remove visual indicator on chat view
        document.getElementById('chat-view').classList.toggle('temporary-mode', this.isTemporaryMode);

        // If enabling temporary mode with an existing conversation that has messages,
        // warn the user that current chat won't be saved
        if (this.isTemporaryMode &&
            this.currentConversation &&
            this.currentConversation.messages.length > 0) {

            const hasSaved = this.currentConversation.updatedAt > this.currentConversation.createdAt;
            if (!hasSaved) {
                // Current chat hasn't been saved yet, offer to save it first
                if (confirm('The current chat has not been saved yet. Would you like to save it before starting temporary mode?')) {
                    this.saveTemporaryChat();
                }
            }
        }
    }

    async saveTemporaryChat() {
        if (!this.currentConversation || this.currentConversation.messages.length === 0) {
            alert('Chat is empty');
            return;
        }

        // Save the conversation
        await Storage.saveConversation(this.currentConversation);

        // Exit temporary mode
        this.isTemporaryMode = false;
        this.els.temporaryChatToggle.classList.remove('active');
        this.els.temporaryModeBanner.classList.add('hidden');
        document.getElementById('chat-view').classList.remove('temporary-mode');

        // Show confirmation
        alert('✅ Chat saved to history');
    }

    async assignConversationToFolder(convId) {
        if (this.folders.length === 0) {
            alert('Please create a folder first');
            return;
        }

        const folderNames = this.folders.map(f => f.name).join('\n');
        const choice = prompt(`Select folder (number):\n${this.folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n')}\n\n0 - No folder`);

        if (choice === null) return;

        const index = parseInt(choice) - 1;
        const conv = await Storage.getConversation(convId);

        if (choice === '0') {
            conv.folderId = null;
        } else if (index >= 0 && index < this.folders.length) {
            conv.folderId = this.folders[index].id;
        } else {
            return;
        }

        await Storage.saveConversation(conv);
        await this.loadHistory(this.els.historySearch?.value || '');
    }

    // === USER PROMPTS ===

    async loadUserPrompts() {
        const prompts = await Storage.getPrompts();
        this.renderUserPrompts(prompts);
        this.renderUserPromptsBar(prompts);
    }

    renderUserPromptsBar(prompts) {
        // Use new collapsible drawer instead of old flat chips
        this.renderPromptsDrawer(prompts);
    }

    async renderPromptsDrawer(prompts) {
        const toggle = document.getElementById('prompts-drawer-toggle');
        const content = document.getElementById('prompts-drawer-content');
        const categoryTabs = document.getElementById('prompts-category-tabs');
        const chipsRow = document.getElementById('prompts-chips-row');
        const countBadge = document.getElementById('prompts-count-badge');

        if (!toggle || !content || !categoryTabs || !chipsRow) return;

        // Update count badge
        if (countBadge) {
            countBadge.textContent = prompts.length > 0 ? prompts.length : '';
        }

        // Load categories from storage (dynamic, includes user-created categories)
        const storedCats = await Storage.getCategories();
        const categoryMeta = {};
        storedCats.forEach(c => {
            categoryMeta[c.id] = { label: `${c.emoji} ${c.label}`, icon: c.emoji };
        });

        // Collect categories present in prompts
        const categoriesPresent = [...new Set(
            prompts.map(p => p.category || 'custom')
        )];

        // Track active category (default to first or 'all')
        if (!this._activePromptCategory) {
            this._activePromptCategory = 'all';
        }

        // Build category tabs
        const allCategories = ['all', ...categoriesPresent];
        categoryTabs.innerHTML = allCategories.map(cat => {
            const meta = categoryMeta[cat] || { label: cat, icon: '' };
            const label = cat === 'all' ? '✨ All' : meta.label;
            const isActive = this._activePromptCategory === cat;
            return `<button 
                class="prompt-cat-tab ${isActive ? 'active' : ''}" 
                data-cat="${cat}" 
                role="tab" 
                aria-selected="${isActive}"
                title="${label}"
            >${label}</button>`;
        }).join('');

        // Bind tab clicks
        categoryTabs.querySelectorAll('.prompt-cat-tab').forEach(tab => {
            tab.onclick = () => {
                this._activePromptCategory = tab.dataset.cat;
                this.renderPromptsDrawer(prompts);
            };
        });

        // Filter prompts by active category
        const filtered = this._activePromptCategory === 'all'
            ? prompts
            : prompts.filter(p => (p.category || 'custom') === this._activePromptCategory);

        // Build prompt chips
        chipsRow.innerHTML = filtered.map(p => `
            <button class="user-prompt-chip" data-prompt-id="${p.id}" title="${p.title}" aria-label="Use prompt: ${p.title}">
                ${p.title}
            </button>
        `).join('') + (filtered.length === 0 ? '<span style="color:var(--text-muted);font-size:0.8em;padding:4px 8px;">No prompts in this category</span>' : '');

        // Bind chip clicks
        chipsRow.querySelectorAll('.user-prompt-chip').forEach(chip => {
            chip.onclick = async () => {
                const id = chip.dataset.promptId;
                const allPrompts = await Storage.getPrompts();
                const found = allPrompts.find(x => x.id === id);
                if (found) {
                    this.switchView('chat-view');
                    this.els.messageInput.value = found.content;
                    this.els.messageInput.dispatchEvent(new Event('input'));
                    this.els.messageInput.focus();
                    // Close drawer after selection
                    this._closePromptsDrawer();
                }
            };
        });

        // Init toggle button (only bind once)
        if (!toggle._drawerBound) {
            toggle._drawerBound = true;
            toggle.onclick = () => {
                const isOpen = content.getAttribute('aria-hidden') === 'false';
                if (isOpen) {
                    this._closePromptsDrawer();
                } else {
                    this._openPromptsDrawer();
                }
            };
        }

        // Replace icons in new elements
        if (typeof Icons !== 'undefined') {
            Icons.replaceAllInDocument();
        }
    }

    _openPromptsDrawer() {
        const content = document.getElementById('prompts-drawer-content');
        const toggle = document.getElementById('prompts-drawer-toggle');
        const drawer = document.getElementById('prompts-drawer');
        if (!content || !toggle) return;

        content.setAttribute('aria-hidden', 'false');
        content.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.classList.add('open');
        if (drawer) drawer.classList.add('open');
    }

    _closePromptsDrawer() {
        const content = document.getElementById('prompts-drawer-content');
        const toggle = document.getElementById('prompts-drawer-toggle');
        const drawer = document.getElementById('prompts-drawer');
        if (!content || !toggle) return;

        content.setAttribute('aria-hidden', 'true');
        content.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.classList.remove('open');
        if (drawer) drawer.classList.remove('open');
    }

    async renderUserPrompts(prompts) {
        if (!this.els.promptsList) return;
        // Load categories dynamically from storage
        const storedCats = await Storage.getCategories();
        const categoryMeta = {};
        storedCats.forEach(c => {
            categoryMeta[c.id] = { label: `${c.emoji} ${c.label}` };
        });
        this.els.promptsList.innerHTML = prompts.map(p => {
            const cat = p.category || 'custom';
            const catLabel = categoryMeta[cat]?.label || cat;
            return `
            <div class="list-item" data-prompt-id="${p.id}" draggable="true" tabindex="0" role="button" aria-label="Prompt: ${p.title}">
                <div class="drag-handle">${Icons.create('grip-vertical', { size: 16 })}</div>
                <div style="flex:1; cursor:pointer;" class="prompt-use-btn" data-prompt-id="${p.id}">
                    <strong>${p.title}</strong>
                    <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                        <span class="prompt-category-badge">${catLabel}</span>
                        <span class="text-md" style="color:var(--text-muted);">${p.content.substring(0, 50)}...</span>
                    </div>
                </div>
                <div style="display:flex; gap:4px;">
                    <button class="btn btn-icon edit-prompt-btn text-xs" data-prompt-id="${p.id}" title="Edit" aria-label="Edit" style="width:24px; height:24px;">${Icons.create('pencil', { size: 14 })}</button>
                    <button class="btn btn-icon delete-prompt-btn text-xs" data-prompt-id="${p.id}" title="Delete" aria-label="Delete" style="width:24px; height:24px;">${Icons.create('trash-2', { size: 14 })}</button>
                </div>
            </div>
        `}).join('');

        // Add keyboard support for prompt items
        this.els.promptsList.querySelectorAll('.list-item').forEach(item => {
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    if (e.target === item) {
                        e.preventDefault();
                        this.handleUsePrompt(item.dataset.promptId);
                    }
                }
            };
        });

        // Initialize drag and drop reordering
        this.initDragAndDrop(this.els.promptsList, async (newOrderIds) => {
            const all = await Storage.getPrompts();
            const reordered = newOrderIds.map(id => all.find(p => p.id === id)).filter(Boolean);
            await Storage.savePrompts(reordered);
            this.renderUserPromptsBar(reordered);
        });
    }

    async handleAddPrompt() {
        this.openPromptEditor('user', 'create');
    }

    // === CATEGORY MANAGEMENT ===

    /**
     * Open the categories management modal
     */
    async openCategoriesModal() {
        if (!this.els.categoriesModal) return;
        this.els.categoriesModal.classList.remove('hidden');
        await this.renderCategoriesList();
        if (this.els.newCategoryLabel) this.els.newCategoryLabel.focus();
    }

    /**
     * Close the categories management modal
     */
    closeCategoriesModal() {
        if (this.els.categoriesModal) {
            this.els.categoriesModal.classList.add('hidden');
        }
        // Refresh prompts view so badge labels update
        this.loadUserPrompts();
    }

    /**
     * Render the list of categories inside the modal
     */
    async renderCategoriesList() {
        if (!this.els.categoriesList) return;
        const cats = await Storage.getCategories();

        this.els.categoriesList.innerHTML = cats.map(cat => `
            <div class="list-item" style="padding:8px 12px;" data-cat-id="${cat.id}">
                <span style="font-size:1.2em; min-width:24px; text-align:center;">${cat.emoji}</span>
                <span style="flex:1; margin-left:8px; font-weight:500;">${cat.label}</span>
                ${cat.isBuiltin
                    ? `<span style="font-size:0.72em; color:var(--text-muted); padding:1px 6px; background:var(--bg-tertiary); border-radius:4px;">built-in</span>`
                    : `<button class="btn btn-icon delete-cat-btn" data-cat-id="${cat.id}" title="Delete" aria-label="Delete category" style="width:24px;height:24px;">${Icons.create('trash-2', { size: 14 })}</button>`
                }
            </div>
        `).join('') || '<p style="color:var(--text-muted);font-size:0.9em;padding:8px 0;">No categories yet.</p>';

        // Bind delete buttons
        this.els.categoriesList.querySelectorAll('.delete-cat-btn').forEach(btn => {
            btn.onclick = () => this.handleDeleteCategory(btn.dataset.catId);
        });

        Icons.replaceAllInDocument();
    }

    /**
     * Add a new category
     */
    async handleAddCategory() {
        const emoji = (this.els.newCategoryEmoji?.value || '').trim() || '📁';
        const label = (this.els.newCategoryLabel?.value || '').trim();

        if (!label) {
            this.els.newCategoryLabel?.focus();
            return;
        }

        const cats = await Storage.getCategories();

        // Check for duplicate labels (case-insensitive)
        if (cats.some(c => c.label.toLowerCase() === label.toLowerCase())) {
            alert(`Category "${label}" already exists`);
            return;
        }

        const newCat = {
            id: label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now(),
            label,
            emoji,
            isBuiltin: false
        };

        cats.push(newCat);
        await Storage.saveCategories(cats);

        // Clear inputs
        if (this.els.newCategoryEmoji) this.els.newCategoryEmoji.value = '';
        if (this.els.newCategoryLabel) this.els.newCategoryLabel.value = '';

        await this.renderCategoriesList();
        this.showToast(`Category "${label}" added`, 'success', 2000);
    }

    /**
     * Delete a user-defined category
     */
    async handleDeleteCategory(id) {
        const cats = await Storage.getCategories();
        const cat = cats.find(c => c.id === id);
        if (!cat || cat.isBuiltin) return;

        if (!confirm(`Delete category "${cat.label}"?\n\nPrompts in this category will be moved to "Custom".`)) return;

        // Move prompts in this category to 'custom'
        const prompts = await Storage.getPrompts();
        let changed = false;
        prompts.forEach(p => {
            if (p.category === id) {
                p.category = 'custom';
                changed = true;
            }
        });
        if (changed) await Storage.savePrompts(prompts);

        // Remove the category
        const updated = cats.filter(c => c.id !== id);
        await Storage.saveCategories(updated);

        await this.renderCategoriesList();
        this.showToast(`Category deleted`, 'success', 2000);
    }


    async handleDeletePrompt(id) {
        if (!confirm('Are you sure you want to delete this?')) return;
        const prompts = await Storage.getPrompts();
        const newPrompts = prompts.filter(p => p.id !== id);
        await Storage.savePrompts(newPrompts);
        await this.loadUserPrompts();
    }

    async handleUsePrompt(id) {
        const prompts = await Storage.getPrompts();
        const p = prompts.find(x => x.id === id);
        if (p) {
            this.switchView('chat-view');
            this.els.messageInput.value = p.content;
            this.els.messageInput.dispatchEvent(new Event('input'));
            this.els.messageInput.focus();
        }
    }

    // === PROMPT EDITOR MODAL ===

    /**
     * Open the prompt editor modal
     * @param {string} type - 'user' or 'system'
     * @param {string} mode - 'create' or 'edit'
     * @param {object|null} prompt - existing prompt data for edit mode
     */
    async openPromptEditor(type, mode, prompt = null) {
        this.promptEditorState = { type, mode, existingPrompt: prompt };

        // Set title based on mode and type
        const titleText = mode === 'create'
            ? (type === 'user' ? 'New Prompt' : 'New System Prompt')
            : 'Edit Prompt';
        this.els.promptEditorTitle.textContent = titleText;

        // Show/hide category field based on type (only for user prompts)
        if (this.els.promptEditorCategoryGroup) {
            this.els.promptEditorCategoryGroup.style.display = type === 'user' ? '' : 'none';
        }

        // Dynamically populate category dropdown from storage
        if (type === 'user' && this.els.promptEditorCategory) {
            const cats = await Storage.getCategories();
            this.els.promptEditorCategory.innerHTML = cats.map(c =>
                `<option value="${c.id}">${c.emoji} ${c.label}</option>`
            ).join('');
        }

        // Populate fields for edit mode
        if (mode === 'edit' && prompt) {
            this.els.promptEditorName.value = prompt.title || '';
            this.els.promptEditorContent.value = prompt.content || '';
            if (this.els.promptEditorCategory && type === 'user') {
                this.els.promptEditorCategory.value = prompt.category || 'custom';
            }
        } else {
            this.els.promptEditorName.value = '';
            this.els.promptEditorContent.value = '';
            if (this.els.promptEditorCategory && type === 'user') {
                this.els.promptEditorCategory.value = 'custom';
            }
        }

        // Update character count
        this.updatePromptEditorCharCount();

        // Show modal
        this.els.promptEditorModal.classList.remove('hidden');

        // Focus on name field
        setTimeout(() => this.els.promptEditorName.focus(), 100);
    }

    /**
     * Close the prompt editor modal
     */
    closePromptEditor() {
        if (this.els.promptEditorModal) {
            this.els.promptEditorModal.classList.add('hidden');
        }
        this.promptEditorState = { type: null, mode: null, existingPrompt: null };
    }

    /**
     * Save prompt from the editor modal
     */
    async savePromptFromEditor() {
        const { type, mode, existingPrompt } = this.promptEditorState;
        const name = this.els.promptEditorName.value.trim();
        const content = this.els.promptEditorContent.value.trim();

        // Validation
        if (!name) {
            alert('Please enter a prompt name');
            this.els.promptEditorName.focus();
            return;
        }
        if (!content) {
            alert('Please enter prompt content');
            this.els.promptEditorContent.focus();
            return;
        }

        // Read category for user prompts
        const category = (type === 'user' && this.els.promptEditorCategory)
            ? this.els.promptEditorCategory.value
            : null;

        try {
            if (type === 'user') {
                const prompts = await Storage.getPrompts();
                
                if (mode === 'create') {
                    prompts.push({
                        id: crypto.randomUUID(),
                        title: name,
                        content: content,
                        category: category || 'custom',
                        createdAt: Date.now()
                    });
                } else if (mode === 'edit' && existingPrompt) {
                    const index = prompts.findIndex(p => p.id === existingPrompt.id);
                    if (index !== -1) {
                        prompts[index].title = name;
                        prompts[index].content = content;
                        prompts[index].category = category || existingPrompt.category || 'custom';
                    }
                }
                
                await Storage.savePrompts(prompts);
                await this.loadUserPrompts();
            } else if (type === 'system') {
                const all = await Storage.getSystemPrompts();
                
                if (mode === 'create') {
                    all.push({
                        id: crypto.randomUUID(),
                        title: name,
                        content: content,
                        enabled: false,
                        isBuiltin: false
                    });
                } else if (mode === 'edit' && existingPrompt) {
                    const index = all.findIndex(p => p.id === existingPrompt.id);
                    if (index !== -1) {
                        all[index].title = name;
                        all[index].content = content;
                    }
                }
                
                await Storage.saveSystemPrompts(all);
                this.renderSystemPromptChips(all);
                this.renderSystemPromptsList(all);
            }

            this.closePromptEditor();
            this.showToast('Prompt saved', 'success');
        } catch (e) {
            console.error('Failed to save prompt:', e);
            alert('Save error: ' + e.message);
        }
    }

    /**
     * Update character count in the editor
     */
    updatePromptEditorCharCount() {
        if (this.els.promptEditorContent && this.els.promptEditorChars) {
            const count = this.els.promptEditorContent.value.length;
            this.els.promptEditorChars.textContent = count.toLocaleString();
        }
    }

    // === CHAT LOGIC ===

    async startNewConversation() {
        // Animate out existing messages if any
        const existingMessages = this.els.chatContainer.querySelectorAll('.message');
        if (existingMessages.length > 0) {
            await this.animateMessagesExit(Array.from(existingMessages));
        }

        this.currentConversation = {
            id: crypto.randomUUID(),
            title: 'New Conversation',
            messages: [],
            metadata: {
                youtubeTranscript: null,
                youtubeVideoId: null,
                pageContext: null
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        this.currentYouTubeVideoId = null;
        this.els.chatContainer.innerHTML = '';

        // Show empty state
        this.updateEmptyState();

        // Clear context usage display
        this.clearContextUsage();

        // Reset virtual scroll state
        this.visibleMessageRange = { start: 0, end: 20 };
        this.messageHeightCache.clear();

        this.switchView('chat-view');
    }

    // === VIRTUAL SCROLLING / LAZY LOADING ===

    /**
     * Initialize virtual scrolling for the chat container
     * Uses lazy loading instead of full virtualization for better UX with variable heights
     */
    initVirtualScroll() {
        if (this._virtualScrollInitialized) return;
        this._virtualScrollInitialized = true;

        // Use passive event listener for better scroll performance
        this.els.chatContainer.addEventListener('scroll', () => this.handleChatScroll(), { passive: true });

        // Use ResizeObserver to track message height changes
        if (window.ResizeObserver) {
            this.messageResizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const msgEl = entry.target.closest('.message');
                    if (msgEl && msgEl.dataset.index !== undefined) {
                        const index = parseInt(msgEl.dataset.index);
                        this.messageHeightCache.set(index, entry.contentRect.height);
                    }
                }
            });
        }
    }

    /**
     * Handle scroll events for lazy loading older messages
     */
    handleChatScroll() {
        if (!this.currentConversation || !this.virtualScrollEnabled) return;

        const container = this.els.chatContainer;
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;

        // Load more messages when scrolling near top
        if (scrollTop < 100 && this.visibleMessageRange.start > 0) {
            this.loadMoreMessages('top');
        }

        // Update visible range for potential cleanup
        this.updateVisibleRange(scrollTop, clientHeight);
    }

    /**
     * Update the visible message range based on scroll position
     */
    updateVisibleRange(scrollTop, clientHeight) {
        const messages = this.currentConversation?.messages;
        if (!messages || messages.length === 0) return;

        // Estimate which messages are visible based on cached heights
        let currentHeight = 0;
        let firstVisible = -1;
        let lastVisible = messages.length - 1;

        for (let i = 0; i < messages.length; i++) {
            const msgHeight = this.messageHeightCache.get(i) || this.averageMessageHeight;

            if (firstVisible === -1 && currentHeight + msgHeight > scrollTop) {
                firstVisible = i;
            }

            if (currentHeight > scrollTop + clientHeight) {
                lastVisible = i - 1;
                break;
            }

            currentHeight += msgHeight;
        }

        if (firstVisible !== -1) {
            this.visibleMessageRange.start = Math.max(0, firstVisible - 2);
            this.visibleMessageRange.end = Math.min(messages.length - 1, lastVisible + 2);
        }
    }

    /**
     * Load more messages in the specified direction
     */
    loadMoreMessages(direction) {
        const messages = this.currentConversation?.messages;
        if (!messages) return;

        if (direction === 'top' && this.visibleMessageRange.start > 0) {
            // Load 10 more messages at the top
            const newStart = Math.max(0, this.visibleMessageRange.start - 10);

            // Save scroll position
            const oldScrollHeight = this.els.chatContainer.scrollHeight;

            // Prepend messages
            for (let i = newStart; i < this.visibleMessageRange.start; i++) {
                const msgEl = this.renderMessageAtIndex(messages[i], i, 'prepend');
                if (msgEl && this.messageResizeObserver) {
                    this.messageResizeObserver.observe(msgEl);
                }
            }

            this.visibleMessageRange.start = newStart;

            // Restore scroll position
            const newScrollHeight = this.els.chatContainer.scrollHeight;
            this.els.chatContainer.scrollTop += (newScrollHeight - oldScrollHeight);
        }
    }

    /**
     * Render a message at a specific position
     */
    renderMessageAtIndex(msg, index, position = 'append') {
        const div = document.createElement('div');
        div.className = `message message-${msg.role}`;
        div.dataset.index = index;

        let html = '';

        if (msg.role === 'user' && msg.images && msg.images.length > 0) {
            html += '<div class="message-images">';
            for (const img of msg.images) {
                html += `<img src="data:${img.mimeType};base64,${img.base64}" alt="Attached">`;
            }
            html += '</div>';
        }

        if (msg.role === 'assistant') {
            html += `<span class="model-badge">${msg.modelName || 'AI'}</span>`;
            const thinkingClass = (msg.thinking && msg.thinking.trim()) ? '' : 'hidden';
            html += `
        <details class="thinking ${thinkingClass}">
          <summary>
            <span class="thinking-summary-text">💭 Thinking</span>
          </summary>
          <div class="thinking-content">${msg.thinking || ''}</div>
        </details>
      `;
        }

        html += `<div class="message-content">${this.markdownWorker.renderSync(msg.content)}</div>`;

        if (msg.role === 'user' && msg.content && msg.content.length > 500) {
            html += `<button class="message-expand-btn" title="Show full message">▼ Show full message</button>`;
            div.classList.add('collapsed');
        }

        div.innerHTML = html;
        MarkdownRenderer.setupListeners(div);

        // Bind expand button
        div.querySelectorAll('.message-expand-btn').forEach(btn => {
            btn.onclick = () => {
                div.classList.remove('collapsed');
                btn.style.display = 'none';
            };
        });

        if (position === 'prepend') {
            this.els.chatContainer.insertBefore(div, this.els.chatContainer.firstChild);
        } else {
            this.els.chatContainer.appendChild(div);
        }

        return div;
    }

    /**
     * Enable virtual scrolling for long conversations
     */
    checkEnableVirtualScroll() {
        const messageCount = this.currentConversation?.messages?.length || 0;
        const shouldEnable = messageCount > 50;

        if (shouldEnable && !this.virtualScrollEnabled) {
            this.virtualScrollEnabled = true;
            this.initVirtualScroll();
            console.log('📊 Virtual scrolling enabled for', messageCount, 'messages');
        } else if (!shouldEnable) {
            this.virtualScrollEnabled = false;
        }
    }

    /**
     * Animate message exit with staggered effect
     * @param {HTMLElement[]} messages - Messages to animate out
     */
    async animateMessagesExit(messages) {
        const animationPromises = messages.map((msg, i) => {
            return new Promise(resolve => {
                setTimeout(() => {
                    msg.classList.add('exiting');
                }, i * 50); // Stagger by 50ms

                setTimeout(() => {
                    msg.remove();
                    resolve();
                }, 200 + (i * 50)); // Animation duration + stagger
            });
        });

        await Promise.all(animationPromises);
    }

    /**
     * Remove element with animation and handle focus
     * @param {HTMLElement} element - Element to remove
     * @param {string} animationClass - Class to add for animation
     * @param {number} duration - Animation duration in ms
     * @param {string} focusSelector - Selector for element to focus after removal
     */
    async removeWithAnimation(element, animationClass = 'exiting', duration = 200, focusSelector = null) {
        element.classList.add(animationClass);

        await new Promise(resolve => setTimeout(resolve, duration));

        element.remove();

        // Move focus to appropriate element
        if (focusSelector) {
            const focusTarget = document.querySelector(focusSelector);
            if (focusTarget) {
                focusTarget.focus();
            }
        }
    }

    /**
     * Initialize drag and drop reordering for a list container
     * @param {HTMLElement} container - The container element
     * @param {Function} onReorder - Callback when items are reordered
     */
    initDragAndDrop(container, onReorder) {
        let draggedItem = null;

        container.addEventListener('dragstart', (e) => {
            draggedItem = e.target.closest('.list-item');
            if (!draggedItem) return;
            draggedItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(container, e.clientY);
            const dragging = container.querySelector('.dragging');

            container.querySelectorAll('.list-item').forEach(item => {
                item.classList.remove('drag-over');
            });

            if (afterElement && afterElement !== dragging) {
                afterElement.classList.add('drag-over');
            }
            e.dataTransfer.dropEffect = 'move';
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            const dragging = container.querySelector('.dragging');
            if (!dragging) return;

            const afterElement = this.getDragAfterElement(container, e.clientY);

            if (afterElement == null) {
                container.appendChild(dragging);
            } else {
                container.insertBefore(dragging, afterElement);
            }

            container.querySelectorAll('.list-item').forEach(item => {
                item.classList.remove('drag-over', 'dragging');
            });

            if (onReorder) {
                const newOrderIds = [...container.querySelectorAll('.list-item')].map(item => item.dataset.promptId);
                onReorder(newOrderIds);
            }
        });

        container.addEventListener('dragend', () => {
            container.querySelectorAll('.list-item').forEach(item => {
                item.classList.remove('drag-over', 'dragging');
            });
            draggedItem = null;
        });
    }

    /**
     * Find the element that the dragged element should be inserted before
     */
    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.list-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    async handleSendMessage() {
        let content = this.els.messageInput.value.trim();
        if (!content || this.isStreaming) return;

        // Check if chain mode is enabled and execute chain instead
        if (this.chainModeEnabled && this.activeChainTemplate) {
            // Execute chain instead of single message
            const userMsg = {
                role: 'user',
                content: content,
                timestamp: Date.now()
            };
            this.currentConversation.messages.push(userMsg);
            this.renderMessage(userMsg, this.currentConversation.messages.length - 1);
            this.els.messageInput.value = '';
            this.els.messageInput.style.overflowY = 'hidden';
            this.els.messageInput.style.height = 'auto';
            await this.executeChain(content);
            return;
        }

        // Append PDF content if attached
        if (this.attachedPdfContent) {
            content += `\n\n[PDF Content for Analysis]:\n${this.attachedPdfContent.substring(0, 15000)}`;
            this.attachedPdfContent = null;
            this.els.attachedPdf.classList.add('hidden');
            this.els.attachedPdf.innerHTML = '';
        }

        // Append multi-tab context if selected
        if (this.multiTabContext && this.multiTabContext.selectedTabs.size > 0) {
            const multiTabContextStr = this.multiTabContext.getContextString();
            if (multiTabContextStr) {
                content += multiTabContextStr;
            }
        }

        // Fetch page context if enabled - ONLY on first message
        if (this.isPageContextEnabled && this.currentConversation.messages.length === 0) {
            const pageContext = await this.fetchPageContext();
            if (pageContext && pageContext.content) {
                // Store in metadata for potential reuse
                this.currentConversation.metadata = this.currentConversation.metadata || {};
                this.currentConversation.metadata.pageContext = pageContext;

                const contextStr = `\n\n[ ]\n [ : ${pageContext.title}\nURL: ${pageContext.url}\n\n${pageContext.content}\n---`;
                content += contextStr;
            }
        }

        // Check for YouTube URL and fetch transcript if needed
        // Only fetch transcript if not already stored for this video
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url?.includes('youtube.com/watch')) {
            const videoId = this.extractYouTubeVideoId(tab.url);

            // Only fetch if we don't have this video's transcript yet
            if (videoId &&
                (this.currentConversation.metadata?.youtubeVideoId !== videoId ||
                    !this.currentConversation.metadata?.youtubeTranscript)) {

                // Show loading indicator for transcript fetch
                const loadingEl = this.showTranscriptLoading();

                try {
                    this.api.setApiKey(await Storage.getApiKey());

                    const fetchTranscript = async () => {
                        return await chrome.tabs.sendMessage(tab.id, { action: 'getYouTubeTranscript' });
                    };

                    let response;
                    try {
                        response = await fetchTranscript();
                    } catch (e) {
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['content-script.js']
                        });
                        await new Promise(r => setTimeout(r, 500));
                        response = await fetchTranscript();
                    }

                    // Remove loading indicator
                    this.hideTranscriptLoading(loadingEl);

                    if (response && response.transcript) {
                        // Store in metadata
                        this.currentConversation.metadata = this.currentConversation.metadata || {};
                        this.currentConversation.metadata.youtubeTranscript = response.transcript;
                        this.currentConversation.metadata.youtubeVideoId = videoId;
                        this.currentYouTubeVideoId = videoId;
                    } else if (response && response.error) {
                        console.warn('Transcript fetch error:', response.error);
                        this.renderMessage({ role: 'assistant', content: 'Warning: Could not fetch YouTube transcript.\n' + response.error, thinking: null });
                        return;
                    }
                } catch (err) {
                    // Remove loading indicator
                    this.hideTranscriptLoading(loadingEl);
                    console.warn('Failed to fetch transcript:', err);
                    this.renderMessage({ role: 'assistant', content: 'Warning: Connection error - could not connect to YouTube.', thinking: null });
                    return;
                }
            }

            // Only include transcript in the FIRST message
            if (this.currentConversation.messages.length === 0 &&
                this.currentConversation.metadata?.youtubeTranscript) {
                content += `\n\n[Video Transcript for Analysis]:\n${this.currentConversation.metadata.youtubeTranscript}`;
            }
        }

        const userMsg = {
            role: 'user',
            content: content,
            timestamp: Date.now(),
            images: this.attachedImages.length > 0 ? [...this.attachedImages] : null
        };

        this.currentConversation.messages.push(userMsg);

        // Auto-title from first message
        if (this.currentConversation.messages.length === 1) {
            this.currentConversation.title = content.substring(0, 40) + (content.length > 40 ? '...' : '');
        }

        this.renderMessage(userMsg, this.currentConversation.messages.length - 1);
        this.els.messageInput.value = '';
        // Reset textarea height after clearing
        this.els.messageInput.style.overflowY = 'hidden';
        this.els.messageInput.style.height = 'auto';

        this.announceToScreenReader('Message sent');

        // Clear attached images
        this.attachedImages = [];
        this.renderAttachedImages();

        await this.generateResponse();
    }

    async generateResponse() {
        this.isStreaming = true;
        this.els.sendBtn.classList.add('hidden');
        this.els.stopBtn.classList.remove('hidden');

        // Reset markdown renderer incremental state (both worker and main thread)
        this.markdownWorker.reset();
        MarkdownRenderer.resetIncremental();

        const systemPrompts = await Storage.getSystemPrompts();
        const activeContents = systemPrompts.filter(p => p.enabled).map(p => p.content);

        const assistantMsg = {
            role: 'assistant',
            content: '',
            thinking: '',
            model: this.currentModel,
            modelName: this.els.modelSelector.options[this.els.modelSelector.selectedIndex]?.text || 'AI',
            timestamp: Date.now(),
            usage: null,
            cost: null
        };

        // Track generation time for tokens/second calculation
        const generationStartTime = Date.now();

        const msgElement = this.renderMessage(assistantMsg, this.currentConversation.messages.length);
        const contentElement = msgElement.querySelector('.message-content');
        const thinkingElement = msgElement.querySelector('.thinking-content');
        const thinkingDetails = msgElement.querySelector('details.thinking');
        const thinkingIndicator = msgElement.querySelector('.thinking-indicator');
        const thinkingTimer = msgElement.querySelector('.thinking-timer');

        // Thinking timer management
        let thinkingStartTime = null;
        let thinkingTimerInterval = null;

        // Chunk batching for better performance
        let chunkBuffer = '';
        let thinkingBuffer = '';
        let lastProcessTime = 0;
        const BATCH_INTERVAL = 16; // ~60fps

        // requestAnimationFrame throttling for UI updates
        let pendingUpdate = false;
        let latestChunk = '';
        let latestThinking = '';

        // Incremental rendering state
        let lastRenderedContentLength = 0;
        let lastRenderedThinkingLength = 0;

        // Flag to prevent race condition: performUIUpdate may run after stopThinkingTimer
        // via pending requestAnimationFrame, which would re-open the details element
        let thinkingComplete = false;

        const startThinkingTimer = () => {
            thinkingStartTime = Date.now();
            thinkingTimerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - thinkingStartTime) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                if (thinkingTimer) {
                    thinkingTimer.textContent = minutes > 0
                        ? `${minutes}:${seconds.toString().padStart(2, '0')}`
                        : `${seconds}s`;
                }
            }, 100);
        };

        const stopThinkingTimer = () => {
            // Mark thinking as complete to prevent race condition with pending requestAnimationFrame
            thinkingComplete = true;
            
            if (thinkingTimerInterval) {
                clearInterval(thinkingTimerInterval);
                thinkingTimerInterval = null;
            }
            if (thinkingIndicator) {
                thinkingIndicator.style.display = 'none';
            }
            if (thinkingDetails) {
                thinkingDetails.classList.remove('active-thinking');
                // Auto-collapse thinking section after completion
                thinkingDetails.removeAttribute('open');
            }
            if (thinkingElement) {
                thinkingElement.classList.remove('streaming');
            }
        };

        const scheduleUIUpdate = (chunk, thinking) => {
            // Add to buffers for batching
            chunkBuffer = chunk;
            thinkingBuffer = thinking;

            const now = performance.now();

            // Check if enough time has passed for batch processing
            if (now - lastProcessTime >= BATCH_INTERVAL) {
                // Process the batched content
                latestChunk = chunkBuffer;
                latestThinking = thinkingBuffer;
                chunkBuffer = '';
                thinkingBuffer = '';
                lastProcessTime = now;

                // Use requestAnimationFrame for UI updates
                if (!pendingUpdate) {
                    pendingUpdate = true;
                    requestAnimationFrame(() => {
                        pendingUpdate = false;
                        performUIUpdate(latestChunk, latestThinking);
                    });
                }
            }
        };

        const performUIUpdate = (chunk, thinking) => {
            // Handle thinking text display - check for non-empty thinking
            // Also check thinkingComplete flag to prevent race condition with stopThinkingTimer
            if (thinking && typeof thinking === 'string' && thinking.trim() && !thinkingComplete) {
                // Start timer on first thinking content
                if (!thinkingStartTime) {
                    startThinkingTimer();
                }

                // Open thinking block and add active class
                if (thinkingDetails) {
                    thinkingDetails.classList.remove('hidden');
                    thinkingDetails.classList.add('active-thinking');
                    thinkingDetails.setAttribute('open', ''); // Auto-open
                }

                // Show indicator
                if (thinkingIndicator) {
                    thinkingIndicator.style.display = 'inline-flex';
                }

                // Incremental thinking update - only update if there's new content
                if (thinkingElement) {
                    const newThinkingLength = thinking.length;
                    if (newThinkingLength > lastRenderedThinkingLength) {
                        // For thinking, we just append new text (it's plain text, not markdown)
                        thinkingElement.textContent = thinking;
                        lastRenderedThinkingLength = newThinkingLength;
                    }
                    thinkingElement.classList.add('streaming');
                }
            }

            // Incremental content rendering
            // Remove all thinking tag formats from the content
            const cleanText = chunk
                .replace(/<think[\s\S]*?<\/think>/gi, '')
                .replace(/<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi, '')
                .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
                .replace(/<\|reasoning\|>[\s\S]*?<\/\|reasoning\|>/gi, '')
                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                .replace(/【思考】[\s\S]*?【\/思考】/g, '')
                .replace(/<\|thought\|>[\s\S]*?<\/\|thought\|>/gi, '')
                .replace(/💭\s*Thinking Process[\s\S]*/gi, '')
                .trim();
            const newContentLength = cleanText.length;

            // Only re-render if there's new content
            if (newContentLength > lastRenderedContentLength) {
                // Use synchronous render for streaming updates to avoid flickering
                // The worker is better for large batch renders, not incremental streaming
                contentElement.innerHTML = this.markdownWorker.renderSync(cleanText);
                lastRenderedContentLength = newContentLength;
                MarkdownRenderer.setupListeners(contentElement);
            }

            this.smartScrollToBottom();
        };

        try {
            await this.api.streamChat(
                activeContents,
                this.currentConversation.messages,
                { model: this.currentModel, webSearch: this.isWebSearchEnabled },
                (chunk, thinking) => {
                    // chunk is now fullText from API
                    assistantMsg.content = chunk;
                    assistantMsg.thinking = thinking;

                    // Use throttled UI update instead of direct DOM manipulation
                    scheduleUIUpdate(chunk, thinking);
                },
                async (fullText, fullThinking, usage) => {
                    // Stop timer and remove animations
                    stopThinkingTimer();

                    this.isStreaming = false;
                    this.announceToScreenReader('Response received');
                    // Remove all thinking tag formats from the final content
                    assistantMsg.content = fullText
                        .replace(/<think[\s\S]*?<\/think>/gi, '')
                        .replace(/<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi, '')
                        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
                        .replace(/<\|reasoning\|>[\s\S]*?<\/\|reasoning\|>/gi, '')
                        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                        .replace(/【思考】[\s\S]*?【\/思考】/g, '')
                        .replace(/<\|thought\|>[\s\S]*?<\/\|thought\|>/gi, '')
                        .replace(/💭\s*Thinking Process[\s\S]*/gi, '')
                        .trim();
                    assistantMsg.thinking = fullThinking;

                    // Show thinking block if there's thinking content
                    if (fullThinking && fullThinking.trim()) {
                        if (thinkingDetails) {
                            thinkingDetails.classList.remove('hidden');
                        }
                        if (thinkingElement) {
                            thinkingElement.textContent = fullThinking;
                        }
                    }

                    // Calculate cost from usage
                    if (usage) {
                        // Calculate generation time and tokens per second
                        const generationEndTime = Date.now();
                        const generationTimeMs = generationEndTime - generationStartTime;
                        const tokensPerSecond = usage.completion_tokens > 0
                            ? Math.round(usage.completion_tokens / (generationTimeMs / 1000))
                            : null;

                        // Add timing info to usage object
                        usage.generationTimeMs = generationTimeMs;
                        usage.tokensPerSecond = tokensPerSecond;

                        assistantMsg.usage = usage;
                        const costInfo = this.api.calculateCost(
                            this.currentModel,
                            usage.prompt_tokens,
                            usage.completion_tokens
                        );
                        assistantMsg.cost = costInfo;

                        // Update the message element with enhanced stats
                        this.updateMessageStats(msgElement, usage, costInfo);
                    }

                    this.currentConversation.messages.push(assistantMsg);

                    // Update context usage display
                    this.updateContextUsage();

                    // Only save if NOT in temporary mode
                    if (!this.isTemporaryMode) {
                        await Storage.saveConversation(this.currentConversation);
                    }

                    this.els.sendBtn.classList.remove('hidden');
                    this.els.stopBtn.classList.add('hidden');

                    // Force scroll to bottom after stream completes (fixes timing issue)
                    // Use double RAF to ensure DOM is fully updated before scrolling
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            this.scrollToBottom(true);
                            this.autoScrollEnabled = true;
                        });
                    });
                },
                (err) => {
                    // Stop timer
                    stopThinkingTimer();

                    this.isStreaming = false;

                    // Remove the empty assistant message element
                    if (msgElement) {
                        msgElement.remove();
                    }

                    // Show inline error message
                    let errorTitle = 'Generation error';
                    let errorDesc = err.message || 'Unknown error';

                    if (err.message.includes('429')) {
                        errorTitle = 'Rate limit exceeded';
                        errorDesc = 'Please wait a moment or check your Venice AI plan.';
                    }

                    this.showInlineError(errorTitle, errorDesc, () => {
                        // Retry callback - regenerate the response
                        this.generateResponse();
                    });

                    this.els.sendBtn.classList.remove('hidden');
                    this.els.stopBtn.classList.add('hidden');
                }
            );
        } catch (e) {
            stopThinkingTimer();
            this.isStreaming = false;
        }
    }

    stopGeneration() {
        this.api.abortStream();
        this.isStreaming = false;
        this.els.sendBtn.classList.remove('hidden');
        this.els.stopBtn.classList.add('hidden');
    }

    // === SMART AUTO-SCROLL ===

    /**
     * Initialize smart auto-scroll behavior
     * Listens to scroll events and shows/hides the "Scroll to Bottom" button
     */
    initSmartScroll() {
        if (this._smartScrollInitialized) return;
        this._smartScrollInitialized = true;

        const container = this.els.chatContainer;

        // Listen for user scroll events
        container.addEventListener('scroll', () => {
            const nearBottom = this.isNearBottom();

            if (nearBottom) {
                // User scrolled back to bottom - re-enable auto-scroll
                this.autoScrollEnabled = true;
                this.userHasScrolled = false;
            } else {
                // User scrolled up - disable auto-scroll
                this.autoScrollEnabled = false;
                this.userHasScrolled = true;
            }

            this.updateScrollToBottomBtn();
        }, { passive: true });

        // Bind scroll-to-bottom button
        if (this.els.scrollToBottomBtn) {
            this.els.scrollToBottomBtn.onclick = () => {
                this.scrollToBottom(true);
                this.autoScrollEnabled = true;
                this.userHasScrolled = false;
                this.updateScrollToBottomBtn();
            };
        }
    }

    /**
     * Check if the chat container is near the bottom
     * @returns {boolean} true if within 80px of the bottom
     */
    isNearBottom() {
        const container = this.els.chatContainer;
        if (!container) return true;
        const threshold = 80;
        return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    }

    /**
     * Scroll to the bottom of the chat container
     * @param {boolean} smooth - whether to use smooth scrolling
     */
    scrollToBottom(smooth = false) {
        const container = this.els.chatContainer;
        if (!container) return;
        if (smooth) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        } else {
            container.scrollTop = container.scrollHeight;
        }
    }

    /**
     * Smart scroll: only auto-scroll if user hasn't manually scrolled up
     */
    smartScrollToBottom() {
        if (this.autoScrollEnabled) {
            this.scrollToBottom(false);
        }
        this.updateScrollToBottomBtn();
    }

    /**
     * Show or hide the "Scroll to Bottom" button based on scroll position and streaming state
     */
    updateScrollToBottomBtn() {
        if (!this.els.scrollToBottomBtn) return;

        const shouldShow = !this.isNearBottom() && this.isStreaming;
        if (shouldShow) {
            this.els.scrollToBottomBtn.classList.remove('hidden');
        } else {
            this.els.scrollToBottomBtn.classList.add('hidden');
        }
    }

    /**
     * Reset auto-scroll state (called when new conversation starts or new message sent)
     */
    resetAutoScroll() {
        this.autoScrollEnabled = true;
        this.userHasScrolled = false;
        if (this.els.scrollToBottomBtn) {
            this.els.scrollToBottomBtn.classList.add('hidden');
        }
    }

    // === MESSAGE STATS HELPERS ===

    /**
     * Format number with locale separators
     */
    formatNumber(num) {
        if (num === null || num === undefined) return '—';
        return num.toLocaleString('en-US');
    }

    /**
     * Format cost with appropriate precision
     */
    formatCost(cost) {
        if (cost === null || cost === undefined) return '—';
        if (cost < 0.01) {
            return `$${cost.toFixed(6)}`;
        } else if (cost < 1) {
            return `$${cost.toFixed(4)}`;
        } else {
            return `$${cost.toFixed(2)}`;
        }
    }

    /**
     * Format time duration
     */
    formatTime(ms) {
        if (!ms) return '—';
        if (ms < 1000) {
            return `${ms}ms`;
        } else {
            const seconds = (ms / 1000).toFixed(1);
            return `${seconds}s`;
        }
    }

    /**
     * Format token count with K/M suffix for display
     */
    formatTokenCount(count) {
        if (count === null || count === undefined) return '—';
        if (count >= 1000000) {
            return `${(count / 1000000).toFixed(1)}M`;
        } else if (count >= 1000) {
            return `${(count / 1000).toFixed(0)}K`;
        }
        return count.toString();
    }

    /**
     * Update context usage display in the input area
     */
    updateContextUsage() {
        if (!this.currentConversation || !this.currentModel) return;

        const contextUsage = this.api.calculateContextUsage(
            this.currentConversation.messages,
            this.currentModel
        );

        // Find or create context usage container
        let contextContainer = document.getElementById('context-usage-container');
        if (!contextContainer) {
            contextContainer = document.createElement('div');
            contextContainer.id = 'context-usage-container';
            contextContainer.className = 'context-usage-container';

            // Insert before the message input
            const inputArea = this.els.messageInput.parentElement;
            inputArea.insertBefore(contextContainer, this.els.messageInput);
        }

        // Build the context usage bar HTML
        const { used, limit, percentage, remaining, warningLevel } = contextUsage;
        const displayPercentage = Math.min(100, Math.round(percentage));

        contextContainer.innerHTML = `
            <div class="context-bar-container">
                <div class="context-bar context-bar--${warningLevel}" style="width: ${displayPercentage}%"></div>
            </div>
            <div class="context-info context-usage--${warningLevel}">
                <span class="context-percentage">${displayPercentage}%</span>
                <span class="context-label">context used</span>
                <span class="context-separator">·</span>
                <span class="context-remaining">${this.formatTokenCount(remaining)} remaining</span>
            </div>
        `;

        // Store context usage in conversation metadata for caching
        if (this.currentConversation.metadata) {
            this.currentConversation.metadata.contextUsage = contextUsage;
        }
    }

    /**
     * Clear context usage display (e.g., when starting new conversation)
     */
    clearContextUsage() {
        const contextContainer = document.getElementById('context-usage-container');
        if (contextContainer) {
            contextContainer.remove();
        }
    }

    /**
     * Update message stats display with enhanced UI
     */
    updateMessageStats(msgElement, usage, costInfo) {
        const statsContainer = msgElement.querySelector('.message-stats');
        if (!statsContainer) return;

        // Build stats HTML
        const tokensDisplay = usage.estimated
            ? `~${this.formatNumber(usage.total_tokens)}`
            : this.formatNumber(usage.total_tokens);

        const speedDisplay = usage.tokensPerSecond
            ? `${usage.tokensPerSecond} t/s`
            : '— t/s';

        const costDisplay = this.formatCost(costInfo.totalCost);

        // Main stats row
        let statsHtml = `
            <div class="stats-row">
                <span class="stat-item" title="Total tokens">
                    <span class="stat-icon">📊</span>
                    <span class="stat-value">${tokensDisplay}</span>
                    <span class="stat-label">tokens</span>
                </span>
                <span class="stat-separator">·</span>
                <span class="stat-item stat-speed" title="Generation speed">
                    <span class="stat-icon">⚡</span>
                    <span class="stat-value">${speedDisplay}</span>
                </span>
                <span class="stat-separator">·</span>
                <span class="stat-item stat-cost" title="Estimated cost">
                    <span class="stat-icon">💰</span>
                    <span class="stat-value">${costDisplay}</span>
                </span>
                ${usage.estimated ? '<span class="stat-badge">est.</span>' : ''}
                <button class="stats-toggle-btn" title="Details">
                    <span class="toggle-icon">▼</span>
                </button>
            </div>
            <div class="stats-details hidden">
                <div class="stats-detail-row">
                    <span class="detail-label">Input:</span>
                    <span class="detail-value">${this.formatNumber(usage.prompt_tokens)} tokens</span>
                    <span class="detail-cost">${this.formatCost(costInfo.inputCost)}</span>
                </div>
                <div class="stats-detail-row">
                    <span class="detail-label">Output:</span>
                    <span class="detail-value">${this.formatNumber(usage.completion_tokens)} tokens</span>
                    <span class="detail-cost">${this.formatCost(costInfo.outputCost)}</span>
                </div>
                <div class="stats-detail-row">
                    <span class="detail-label">Time:</span>
                    <span class="detail-value">${this.formatTime(usage.generationTimeMs)}</span>
                </div>
            </div>
        `;

        statsContainer.innerHTML = statsHtml;
        statsContainer.classList.remove('hidden');

        // Bind toggle button
        const toggleBtn = statsContainer.querySelector('.stats-toggle-btn');
        const detailsSection = statsContainer.querySelector('.stats-details');
        if (toggleBtn && detailsSection) {
            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                detailsSection.classList.toggle('hidden');
                toggleBtn.classList.toggle('expanded');
            };
        }
    }

    async fetchPageContext() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) return null;

            // Twitter/X URL detection
            if (tab.url?.includes('twitter.com') || tab.url?.includes('x.com')) {
                try {
                    const response = await chrome.tabs.sendMessage(tab.id, {
                        action: 'getTwitterData',
                        options: { limit: 20, includeReplies: true }
                    });
                    if (response?.success && response.tweets && response.tweets.length > 0) {
                        return {
                            title: 'Twitter/X Posts',
                            url: response.url || tab.url,
                            content: this.formatTwitterContext(response.tweets)
                        };
                    }
                } catch (e) {
                    try {
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['content-script.js']
                        });
                        await new Promise(r => setTimeout(r, 500));
                        const response = await chrome.tabs.sendMessage(tab.id, {
                            action: 'getTwitterData',
                            options: { limit: 20, includeReplies: true }
                        });
                        if (response?.success && response.tweets && response.tweets.length > 0) {
                            return {
                                title: 'Twitter/X Posts',
                                url: response.url || tab.url,
                                content: this.formatTwitterContext(response.tweets)
                            };
                        }
                    } catch (injectErr) {
                        console.warn('Failed to inject content script for Twitter:', injectErr);
                    }
                }
            }

            // Try to get page content from content script
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
                if (response && response.content) {
                    return {
                        title: response.title || tab.title || 'Unknown Page',
                        url: response.url || tab.url || '',
                        content: response.content
                    };
                }
            } catch (e) {
                // Content script might not be loaded, try injecting it
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content-script.js']
                    });
                    // Wait for script to initialize
                    await new Promise(r => setTimeout(r, 300));
                    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
                    if (response && response.content) {
                        return {
                            title: response.title || tab.title || 'Unknown Page',
                            url: response.url || tab.url || '',
                            content: response.content
                        };
                    }
                } catch (injectErr) {
                    console.warn('Failed to inject content script:', injectErr);
                }
            }
            return null;
        } catch (err) {
            console.warn('Failed to fetch page context:', err);
            return null;
        }
    }

    /**
     * Extract YouTube video ID from URL
     */
    extractYouTubeVideoId(url) {
        if (!url) return null;
        const match = url.match(/[?&]v=([^&]+)/);
        return match ? match[1] : null;
    }

    /**
     * Format Twitter/X posts and articles for AI context
     * Handles both tweets and articles (type: 'article' vs 'tweet' or undefined)
     */
    formatTwitterContext(items) {
        if (!items || items.length === 0) return '';

        // Determine if we have articles or tweets
        const hasArticles = items.some(item => item.type === 'article');
        let context = hasArticles
            ? '[Twitter/X Content - Posts & Articles]\n\n'
            : '[Twitter/X Posts]\n\n';

        items.forEach((item, i) => {
            // Check if this is an article (type: 'article') or a tweet (type: 'tweet' or undefined)
            if (item.type === 'article') {
                // Article format
                context += `Article ${i + 1}:\n`;
                if (item.title) {
                    context += `Title: ${item.title}\n`;
                }
                context += `Author: ${item.author.name} (${item.author.handle})`;
                if (item.author.verified) {
                    context += ' \u2713';
                    if (item.author.verifiedType === 'gold') context += ' (Gold)';
                    else if (item.author.verifiedType === 'gray') context += ' (Gray)';
                }
                context += '\n';
                context += `Content: ${item.text}\n`;
                if (item.timestamp) {
                    context += `Date: ${item.timestamp}\n`;
                }
                if (item.media?.images?.length > 0) {
                    context += `Images: ${item.media.images.length}\n`;
                }
                if (item.media?.hasVideo) {
                    context += `Video: Included\n`;
                }
            } else {
                // Tweet format (existing)
                context += `Post ${i + 1}:\n`;

                // Author info with verification status
                let authorInfo = `Author: ${item.author.name} (${item.author.handle})`;
                if (item.author.verified) {
                    authorInfo += ' \u2713';
                    if (item.author.verifiedType === 'gold') authorInfo += ' (Gold)';
                    else if (item.author.verifiedType === 'gray') authorInfo += ' (Gray)';
                }
                context += authorInfo + '\n';

                context += `Text: ${item.text}\n`;

                // Add quoted tweet if present
                if (item.isQuote && item.quotedTweet) {
                    context += `Quote: @${item.quotedTweet.author}: "${item.quotedTweet.text}"\n`;
                }

                // Add link card if present
                if (item.linkCard) {
                    context += `Link: ${item.linkCard.title}\n`;
                    context += `URL: ${item.linkCard.url}\n`;
                    if (item.linkCard.description) {
                        context += `Description: ${item.linkCard.description}\n`;
                    }
                }

                if (item.timestamp) {
                    context += `Date: ${item.timestamp}\n`;
                }

                if (item.media?.images?.length > 0) {
                    context += `Images: ${item.media.images.length}\n`;
                }
                if (item.media?.hasVideo) {
                    context += `Video: Included\n`;
                }

                // Engagement metrics including views
                let engagement = `Engagement: \uD83D\uDCAC ${item.engagement.replies} \uD83D\uDD01 ${item.engagement.retweets} \u2764\uFE0F ${item.engagement.likes}`;
                if (item.engagement.views > 0) {
                    engagement += ` \uD83D\uDC41\uFE0F ${item.engagement.views}`;
                }
                context += engagement + '\n';

                // Add reply indicator
                if (item.isReply) {
                    context += `(This is a reply to another post)\n`;
                }
            }

            context += `---\n`;
        });

        return context;
    }


    renderMessage(msg, index = -1) {
        // Hide empty state when rendering a message
        if (this.els.chatEmptyState) {
            this.els.chatEmptyState.classList.add('hidden');
        }

        const div = document.createElement('div');
        div.className = `message message-${msg.role}`;
        div.dataset.index = index;
        div.setAttribute('tabindex', '0'); // Make message focusable for screen readers

        let html = '';

        // Show images if present (for user messages with images)
        if (msg.role === 'user' && msg.images && msg.images.length > 0) {
            html += '<div class="message-images">';
            for (const img of msg.images) {
                html += `<img src="data:${img.mimeType};base64,${img.base64}" alt="Attached">`;
            }
            html += '</div>';
        }

        if (msg.role === 'assistant') {
            html += `<span class="model-badge" aria-label="Model: ${msg.modelName || 'AI'}">${msg.modelName || 'AI'}</span>`;
            const thinkingClass = (msg.thinking && msg.thinking.trim()) ? '' : 'hidden';
            html += `
        <details class="thinking ${thinkingClass}" ${thinkingClass === '' ? 'open' : ''}>
          <summary aria-expanded="${thinkingClass === ''}">
            <span class="thinking-summary-text">💭 Thinking</span>
            <span class="thinking-indicator">
              <span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
              <span class="thinking-timer" aria-label="Thinking time"></span>
            </span>
          </summary>
          <div class="thinking-content" aria-live="polite">${msg.thinking || ''}</div>
        </details>
      `;
        }

        html += `<div class="message-content">${this.markdownWorker.renderSync(msg.content)}</div>`;

        // Add expand button for long messages (user messages only, like transcripts)
        if (msg.role === 'user' && msg.content && msg.content.length > 500) {
            html += `<button class="message-expand-btn" title="Show full message">▼ Show full message</button>`;
        }

        // Add action buttons for user messages
        if (msg.role === 'user' && index >= 0) {
            html += `<div class="message-actions">
                <button class="msg-action-btn edit-msg-btn" data-index="${index}" title="Edit">${Icons.create('pencil', { size: 14 })}</button>
            </div>`;
        }

        // Add action buttons for assistant messages
        if (msg.role === 'assistant' && index >= 0) {
            // Show stats if available (for messages loaded from history)
            if (msg.cost && msg.usage) {
                html += `<div class="message-stats" data-has-stats="true"></div>`;
            } else {
                html += `<div class="message-stats hidden"></div>`;
            }
            html += `<div class="message-actions">
                <button class="msg-action-btn regenerate-btn" data-index="${index}" title="Regenerate">${Icons.create('refresh-cw', { size: 14 })}</button>
                <button class="msg-action-btn copy-msg-btn" data-index="${index}" title="Copy">${Icons.create('copy', { size: 14 })}</button>
                <button class="msg-action-btn tts-msg-btn" data-index="${index}" title="Read aloud">${Icons.create('volume2', { size: 14 })}</button>
            </div>`;
        }

        div.innerHTML = html;

        // Add collapsed class for long user messages
        if (msg.role === 'user' && msg.content && msg.content.length > 500) {
            div.classList.add('collapsed');
        }

        // Populate stats for messages loaded from history
        if (msg.role === 'assistant' && msg.cost && msg.usage) {
            const statsContainer = div.querySelector('.message-stats');
            if (statsContainer) {
                this.updateMessageStats(div, msg.usage, msg.cost);
            }
        }

        this.els.chatContainer.appendChild(div);
        MarkdownRenderer.setupListeners(div);

        // Note: Event listeners are handled via delegation in bindEvents()
        // No need to attach individual listeners here

        this.smartScrollToBottom();
        return div;
    }

    async editMessage(index) {
        const msg = this.currentConversation.messages[index];
        if (!msg || msg.role !== 'user') return;

        const newContent = prompt('Edit:', msg.content);
        if (newContent === null || newContent.trim() === '') return;

        // Update message content
        msg.content = newContent.trim();

        // Remove all messages after this one with exit animation
        const messagesToRemove = [];
        const allMessages = this.els.chatContainer.querySelectorAll('.message');

        for (let i = index; i < allMessages.length; i++) {
            messagesToRemove.push(allMessages[i]);
        }

        // Animate exit of messages
        await this.animateMessagesExit(messagesToRemove);

        // Remove messages from data
        this.currentConversation.messages = this.currentConversation.messages.slice(0, index + 1);

        // Generate new response
        this.generateResponse();
    }

    async regenerateMessage(index) {
        if (this.isStreaming) return;

        // Clear cached audio for this message and all after it
        for (let i = index; i < this.currentConversation.messages.length; i++) {
            if (this.currentConversation.messages[i].audioBlob) {
                delete this.currentConversation.messages[i].audioBlob;
            }
        }

        // Remove this message and all after it with exit animation
        const messagesToRemove = [];
        const allMessages = this.els.chatContainer.querySelectorAll('.message');

        for (let i = index; i < allMessages.length; i++) {
            messagesToRemove.push(allMessages[i]);
        }

        // Animate exit of messages
        await this.animateMessagesExit(messagesToRemove);

        // Remove messages from data
        this.currentConversation.messages = this.currentConversation.messages.slice(0, index);

        // Generate new response
        await this.generateResponse();
    }

    // === IMAGE GEN ===
    async handleGenerateImage() {
        const prompt = this.els.imagePrompt.value.trim();
        if (!prompt) return;

        this.els.generateImageBtn.disabled = true;
        this.els.imageResult.innerHTML = '✨ Creating...';
        this.els.imageActions.classList.add('hidden');

        try {
            const result = await this.api.generateImage(
                prompt,
                this.els.imageModelSelector.value,
                this.els.imageSizeSelector.value
            );
            this.currentImageB64 = result.b64;
            this.els.imageResult.innerHTML = `<img src="data:image/png;base64,${result.b64}" alt="Generated">`;
            this.els.imageActions.classList.remove('hidden');
        } catch (e) {
            this.els.imageResult.innerHTML = `<span style="color:red">${e.message}</span>`;
        } finally {
            this.els.generateImageBtn.disabled = false;
        }
    }

    downloadGeneratedImage() {
        if (!this.currentImageB64) return;
        const link = document.createElement('a');
        link.href = `data:image/png;base64,${this.currentImageB64}`;
        link.download = `venice-ai-${Date.now()}.png`;
        link.click();
    }

    async copyGeneratedImage() {
        if (!this.currentImageB64) return;
        try {
            const byteCharacters = atob(this.currentImageB64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/png' });
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            this.els.copyImageBtn.innerHTML = `${Icons.create('check', { size: 16 })} Copied`;
            setTimeout(() => {
                this.els.copyImageBtn.innerHTML = `${Icons.create('copy', { size: 16 })} Copy`;
            }, 2000);
        } catch (e) {
            alert('Copy failed');
        }
    }

    // === TTS ===
    async handleTTS() {
        const text = this.els.ttsInput.value.trim();
        if (!text || this.isTTSGenerating) return;

        // Global character limit to prevent browser crashes and extremely long generations
        const MAX_TTS_TEXT_LENGTH = 50000; // 50,000 characters max
        const MAX_SINGLE_TTS = 4000; // Updated to match API limit of 4096 with safety margin
        const voice = this.els.voiceSelector.value;

        // Check global character limit
        if (text.length > MAX_TTS_TEXT_LENGTH) {
            this.showTTSError(
                `Text is too long`,
                `Maximum length is ${MAX_TTS_TEXT_LENGTH.toLocaleString()} characters. Current: ${text.length.toLocaleString()} characters.`
            );
            return;
        }

        // Hide previous results
        this.els.ttsActions.classList.add('hidden');
        if (this.els.ttsError) this.els.ttsError.classList.add('hidden');
        this.els.audioContainer.innerHTML = '';

        this.isTTSGenerating = true;
        this.els.ttsBtn.disabled = true;
        this.els.ttsBtn.innerHTML = '⏳ Generating...';

        try {
            let blob;
            if (text.length <= MAX_SINGLE_TTS) {
                // Use existing single TTS flow
                if (this.els.ttsLoading) this.els.ttsLoading.classList.remove('hidden');
                blob = await this.api.textToSpeech(text, voice);
            } else {
                // Use chunked TTS flow with cancellation support
                this.ttsAbortController = new AbortController();
                this.showTTSProgress();

                blob = await this.api.generateSpeechChunked(
                    text,
                    { voice: voice },
                    (progress) => this.updateTTSProgress(progress),
                    this.ttsAbortController.signal
                );
            }

            // Store generation state
            this.currentTTSAudio = blob;
            this.lastGeneratedText = text;
            this.lastGeneratedVoice = voice;

            // Show audio player
            const url = URL.createObjectURL(blob);
            this.els.audioContainer.innerHTML = `<audio controls src="${url}" autoplay></audio>`;

            // Show action buttons
            this.els.ttsActions.classList.remove('hidden');
            this.hideTTSModifiedIndicators();

        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('TTS generation cancelled by user');
                // Don't show error for user-initiated cancellation
            } else {
                // Parse and show specific error message
                this.handleTTSError(e, text.length > MAX_SINGLE_TTS);
            }
        } finally {
            // Reset loading state
            this.isTTSGenerating = false;
            if (this.els.ttsLoading) this.els.ttsLoading.classList.add('hidden');
            this.hideTTSProgress();
            this.els.ttsBtn.disabled = false;
            this.els.ttsBtn.innerHTML = `${Icons.create('volume2', { size: 16 })} Generate`;
            this.ttsAbortController = null;
        }
    }

    /**
     * Handle TTS errors with specific messages for chunked generation
     * @param {Error} error - The error that occurred
     * @param {boolean} isChunked - Whether this was a chunked generation
     */
    handleTTSError(error, isChunked = false) {
        let title = 'Voice generation error';
        let message = error.message || 'Unknown error';

        // Check for specific error patterns
        if (error.message?.includes('Failed to generate part')) {
            // Chunked TTS failure with specific part info
            title = 'Part generation failed';
            // Extract part number from error message if possible
            const partMatch = error.message.match(/part (\d+)/i);
            if (partMatch) {
                message = `Part ${partMatch[1]} failed after several attempts. Please check your internet connection and try again.`;
            } else {
                message = error.message;
            }
        } else if (error.message?.includes('multiple attempts')) {
            // Generic retry failure
            title = 'Generation failed';
            message = 'Voice generation failed after multiple attempts. Please try again later.';
        } else if (error.message?.includes('401') || error.message?.includes('403')) {
            title = 'Authorization error';
            message = 'Please check your API key.';
        } else if (error.message?.includes('429')) {
            title = 'Rate limit exceeded';
            message = 'Please wait a moment and try again.';
        } else if (error.message?.includes('network') || error.message?.includes('Network')) {
            title = 'Network error';
            message = 'Internet connection problem. Please check your connection and try again.';
        }

        this.showTTSError(title, message);
    }

    showTTSProgress() {
        if (this.els.ttsProgressContainer) {
            this.els.ttsProgressContainer.classList.remove('hidden');
            this.updateTTSProgress({ current: 0, total: 0, status: 'preparing' });
        }
    }

    hideTTSProgress() {
        if (this.els.ttsProgressContainer) {
            this.els.ttsProgressContainer.classList.add('hidden');
        }
    }

    updateTTSProgress(progress) {
        const { current, total, status, message } = progress;
        const percent = total > 0 ? (current / total) * 100 : 0;

        if (this.els.ttsProgressFill) {
            this.els.ttsProgressFill.style.width = `${percent}%`;
        }
        if (this.els.ttsProgressText) {
            // Handle different status types
            if (status === 'concatenating') {
                this.els.ttsProgressText.textContent = 'Combining audio...';
            } else if (status === 'retrying') {
                // Show retry message from API
                this.els.ttsProgressText.textContent = message || 'Retrying...';
                this.els.ttsProgressFill.classList.add('retrying');
            } else if (status === 'complete') {
                this.els.ttsProgressText.textContent = 'Done!';
                this.els.ttsProgressFill.classList.remove('retrying');
            } else if (total > 0) {
                this.els.ttsProgressText.textContent = `Generating: part ${current} / ${total} (${Math.round(percent)}%)`;
                this.els.ttsProgressFill.classList.remove('retrying');
            } else {
                this.els.ttsProgressText.textContent = 'Preparing...';
            }
        }
    }

    cancelTTS() {
        if (this.ttsAbortController) {
            this.ttsAbortController.abort();
        }
    }

    showTTSError(title, message = '') {
        if (!this.els.ttsError) return;

        // If only one argument is provided, treat it as message with default title
        if (message === '' && title) {
            message = title;
            title = 'Voice generation error';
        }

        // Update to use new error-message structure
        this.els.ttsError.innerHTML = `
            <div class="error-message" role="alert">
                <span class="error-icon">${Icons.create('alert-circle', { size: 20 })}</span>
                <div class="error-content">
                    <div class="error-title">${title}</div>
                    ${message ? `<div class="error-description">${message}</div>` : ''}
                    <div class="error-actions">
                        <button id="tts-retry-btn" class="btn btn-sm btn-primary">${Icons.create('refresh-cw', { size: 14 })} Retry</button>
                        <button class="btn btn-sm btn-ghost dismiss-tts-error-btn">Dismiss</button>
                    </div>
                </div>
            </div>
        `;

        // Bind retry button
        const retryBtn = this.els.ttsError.querySelector('#tts-retry-btn');
        if (retryBtn) {
            retryBtn.onclick = () => this.handleTTS();
        }

        // Bind dismiss button
        const dismissBtn = this.els.ttsError.querySelector('.dismiss-tts-error-btn');
        if (dismissBtn) {
            dismissBtn.onclick = () => this.els.ttsError.classList.add('hidden');
        }

        this.els.ttsError.classList.remove('hidden');
    }

    hideTTSModifiedIndicators() {
        if (this.els.ttsModifiedIndicator) {
            this.els.ttsModifiedIndicator.classList.add('hidden');
        }
        if (this.els.voiceChangedIndicator) {
            this.els.voiceChangedIndicator.classList.add('hidden');
        }
        if (this.els.ttsCharCounter) {
            this.els.ttsCharCounter.classList.remove('modified');
        }
    }

    checkTTSModifications() {
        const textChanged = this.els.ttsInput.value !== this.lastGeneratedText;
        const voiceChanged = this.els.voiceSelector.value !== this.lastGeneratedVoice;

        // Show modified indicator if text changed after generation
        if (this.els.ttsModifiedIndicator) {
            if (textChanged && this.lastGeneratedText) {
                this.els.ttsModifiedIndicator.classList.remove('hidden');
            } else {
                this.els.ttsModifiedIndicator.classList.add('hidden');
            }
        }

        // Show voice changed indicator
        if (this.els.voiceChangedIndicator) {
            if (voiceChanged && this.lastGeneratedVoice) {
                this.els.voiceChangedIndicator.classList.remove('hidden');
            } else {
                this.els.voiceChangedIndicator.classList.add('hidden');
            }
        }
    }

    clearTTS() {
        this.els.ttsInput.value = '';
        this.els.audioContainer.innerHTML = '';
        this.els.ttsActions.classList.add('hidden');
        if (this.els.ttsError) this.els.ttsError.classList.add('hidden');
        this.currentTTSAudio = null;
        this.lastGeneratedText = '';
        this.lastGeneratedVoice = '';
        this.hideTTSModifiedIndicators();
        this.updateTTSCharCounter();
    }

    updateTTSCharCounter() {
        if (!this.els.ttsCharCounter) return;
        const count = this.els.ttsInput.value.length;
        const max = 4000; // Updated to match API limit of 4096 with safety margin
        const globalMax = 50000; // Global character limit

        if (count > globalMax) {
            // Over global limit - show error
            this.els.ttsCharCounter.innerHTML = `
                <span class="char-count error">${count.toLocaleString()}</span>
                <span class="chunk-info error">⚠️ Limit exceeded (max: ${globalMax.toLocaleString()})</span>
            `;
            this.els.ttsCharCounter.classList.add('chunked', 'global-limit-exceeded');
        } else if (count > max) {
            const chunks = Math.ceil(count / 4000); // Updated chunk size
            this.els.ttsCharCounter.innerHTML = `
                <span class="char-count">${count.toLocaleString()}</span>
                <span class="chunk-info">(${chunks} parts)</span>
            `;
            this.els.ttsCharCounter.classList.add('chunked');
            this.els.ttsCharCounter.classList.remove('global-limit-exceeded');
        } else {
            this.els.ttsCharCounter.textContent = `${count}/${max}`;
            this.els.ttsCharCounter.classList.remove('chunked', 'global-limit-exceeded');
        }

        // Update styling based on count
        this.els.ttsCharCounter.classList.toggle('warning', count > max * 0.9 && count <= max);
        this.els.ttsCharCounter.classList.toggle('error', count > max && count <= globalMax);
        this.els.ttsCharCounter.classList.toggle('global-error', count > globalMax);
    }

    downloadTTS() {
        if (!this.currentTTSAudio) return;
        const url = URL.createObjectURL(this.currentTTSAudio);
        const link = document.createElement('a');
        link.href = url;
        link.download = `venice-ai-tts-${Date.now()}.mp3`;
        link.click();
        URL.revokeObjectURL(url);
    }

    // === MESSAGE TTS (Inline Audio for Chat Messages) ===

    /**
     * Handle TTS generation for a specific message
     * @param {number} index - Message index in conversation
     */
    async handleMessageTTS(index) {
        const msg = this.currentConversation.messages[index];
        if (!msg || msg.role !== 'assistant' || this.isTTSGenerating) {
            if (this.isTTSGenerating) {
                this.showToast('Please wait for the current generation to finish', 'warning');
            }
            return;
        }

        // Get button element
        const btnElement = this.els.chatContainer.querySelector(
            `.tts-msg-btn[data-index="${index}"]`
        );
        if (!btnElement) return;

        // Check cache
        if (msg.audioBlob) {
            this.playMessageAudio(msg.audioBlob, btnElement, index);
            return;
        }

        // Extract clean text
        const cleanText = this.extractCleanTextForTTS(msg.content);

        if (!cleanText || cleanText.trim().length < 10) {
            this.showToast('Message is empty or too short', 'warning');
            return;
        }

        // Check length limit
        const MAX_TTS_LENGTH = 50000;
        if (cleanText.length > MAX_TTS_LENGTH) {
            this.showToast(
                `Text is too long (${cleanText.length.toLocaleString()} characters)`,
                'error'
            );
            return;
        }

        // Show generating state
        this.isTTSGenerating = true;
        btnElement.disabled = true;
        const originalHTML = btnElement.innerHTML;
        btnElement.innerHTML = Icons.create('loader2', { size: 14, class: 'icon-spin' });

        try {
            // Get voice from settings or use default
            const settings = await Storage.getSettings();
            const voice = settings.defaultTTSVoice || 'af_sky';

            let blob;

            // Determine generation method
            if (cleanText.length > 4000) {
                // Chunked generation with progress
                this.showMessageTTSProgress(index);

                blob = await this.api.generateSpeechChunked(
                    cleanText,
                    { voice: voice },
                    (progress) => this.updateMessageTTSProgress(index, progress),
                    null
                );

                this.hideMessageTTSProgress(index);
            } else {
                // Single API call
                blob = await this.api.textToSpeech(cleanText, voice);
            }

            // Cache audio
            msg.audioBlob = blob;

            // Play audio
            this.playMessageAudio(blob, btnElement, index);

            // Success feedback
            btnElement.innerHTML = Icons.create('check', { size: 14 });
            btnElement.style.color = 'var(--color-success)';

            setTimeout(() => {
                btnElement.innerHTML = originalHTML;
                btnElement.style.color = '';
            }, 2000);

            this.announceToScreenReader('Audio is ready to play');

        } catch (error) {
            console.error('Message TTS error:', error);

            // Error state
            btnElement.innerHTML = Icons.create('alert-circle', { size: 14 });
            btnElement.style.color = 'var(--color-error)';

            // Error message
            let errorMsg = 'Voice generation failed';
            if (error.message?.includes('429')) {
                errorMsg = 'Rate limit exceeded';
            } else if (error.message?.includes('401') || error.message?.includes('403')) {
                errorMsg = 'API key error';
            } else if (error.name === 'AbortError') {
                errorMsg = 'Generation cancelled';
            }

            this.showToast(errorMsg, 'error');

            // Reset button
            setTimeout(() => {
                btnElement.innerHTML = originalHTML;
                btnElement.style.color = '';
            }, 3000);

        } finally {
            this.isTTSGenerating = false;
            btnElement.disabled = false;
        }
    }

    /**
     * Extract clean text from message content for TTS
     * @param {string} content - Raw message content
     * @returns {string} Clean text suitable for TTS
     */
    extractCleanTextForTTS(content) {
        if (!content) return '';

        let text = content;

        // Remove code blocks
        text = text.replace(/```[\s\S]*?```/g, ' [code block] ');
        text = text.replace(/`[^`]+`/g, ' ');

        // Remove markdown links but keep text
        text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

        // Remove markdown images
        text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

        // Remove markdown headers
        text = text.replace(/^#{1,6}\s+/gm, '');

        // Remove markdown bold/italic
        text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
        text = text.replace(/\*([^*]+)\*/g, '$1');
        text = text.replace(/__([^_]+)__/g, '$1');
        text = text.replace(/_([^_]+)_/g, '$1');

        // Remove HTML tags
        text = text.replace(/<[^>]+>/g, '');

        // Remove URLs
        text = text.replace(/https?:\/\/[^\s]+/g, ' ');

        // Clean up whitespace
        text = text.replace(/\s+/g, ' ').trim();

        return text;
    }

    /**
     * Play audio for a message using inline audio player
     * @param {Blob} audioBlob - Audio blob to play
     * @param {HTMLElement} btnElement - Button element for reference
     * @param {number} index - Message index
     */
    playMessageAudio(audioBlob, btnElement, index) {
        const messageEl = btnElement.closest('.message');
        if (!messageEl) return;

        // Remove existing audio player if present
        const existingPlayer = messageEl.querySelector('.message-audio-player');
        if (existingPlayer) {
            existingPlayer.remove();
        }

        // Create audio URL
        const audioUrl = URL.createObjectURL(audioBlob);

        // Create audio player container
        const audioContainer = document.createElement('div');
        audioContainer.className = 'message-audio-player';
        audioContainer.innerHTML = `
            <audio controls autoplay>
                <source src="${audioUrl}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
            <button class="close-audio-btn" title="Close" aria-label="Close audio player">
                ${Icons.create('x', { size: 12 })}
            </button>
        `;

        // Insert after message-actions
        const actionsEl = messageEl.querySelector('.message-actions');
        if (actionsEl && actionsEl.nextSibling) {
            messageEl.insertBefore(audioContainer, actionsEl.nextSibling);
        } else if (actionsEl) {
            actionsEl.parentNode.appendChild(audioContainer);
        }

        // Get audio element
        const audioEl = audioContainer.querySelector('audio');

        // Bind close button
        const closeBtn = audioContainer.querySelector('.close-audio-btn');
        closeBtn.onclick = () => {
            audioEl.pause();
            audioContainer.remove();
            URL.revokeObjectURL(audioUrl);
        };

        // Error handling
        audioEl.onerror = () => {
            audioContainer.remove();
            URL.revokeObjectURL(audioUrl);
            this.showToast('Could not play audio', 'error');
        };

        // Scroll to ensure audio player is visible
        audioContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Show progress indicator for message TTS generation
     * @param {number} index - Message index
     */
    showMessageTTSProgress(index) {
        const messageEl = this.els.chatContainer.querySelector(
            `.message[data-index="${index}"]`
        );
        if (!messageEl) return;

        // Create progress container
        const progressContainer = document.createElement('div');
        progressContainer.className = 'message-tts-progress';
        progressContainer.innerHTML = `
            <div class="tts-progress-bar">
                <div class="tts-progress-fill" style="width: 0%"></div>
            </div>
            <div class="tts-progress-text">Preparing...</div>
        `;

        // Insert after message-actions
        const actionsEl = messageEl.querySelector('.message-actions');
        if (actionsEl && actionsEl.nextSibling) {
            messageEl.insertBefore(progressContainer, actionsEl.nextSibling);
        } else if (actionsEl) {
            actionsEl.parentNode.appendChild(progressContainer);
        }
    }

    /**
     * Update progress for message TTS generation
     * @param {number} index - Message index
     * @param {Object} progress - Progress object from API
     */
    updateMessageTTSProgress(index, progress) {
        const messageEl = this.els.chatContainer.querySelector(
            `.message[data-index="${index}"]`
        );
        if (!messageEl) return;

        const progressContainer = messageEl.querySelector('.message-tts-progress');
        if (!progressContainer) return;

        const { current, total, status } = progress;
        const percent = total > 0 ? (current / total) * 100 : 0;

        const fillEl = progressContainer.querySelector('.tts-progress-fill');
        const textEl = progressContainer.querySelector('.tts-progress-text');

        if (fillEl) {
            fillEl.style.width = `${percent}%`;
        }

        if (textEl) {
            if (status === 'concatenating') {
                textEl.textContent = 'Combining audio...';
            } else if (status === 'retrying') {
                textEl.textContent = 'Retrying...';
            } else if (total > 0) {
                textEl.textContent = `Part ${current}/${total} (${Math.round(percent)}%)`;
            } else {
                textEl.textContent = 'Preparing...';
            }
        }
    }

    /**
     * Hide progress indicator for message TTS
     * @param {number} index - Message index
     */
    hideMessageTTSProgress(index) {
        const messageEl = this.els.chatContainer.querySelector(
            `.message[data-index="${index}"]`
        );
        if (!messageEl) return;

        const progressContainer = messageEl.querySelector('.message-tts-progress');
        if (progressContainer) {
            progressContainer.classList.add('exiting');
            setTimeout(() => progressContainer.remove(), 200);
        }
    }

    // === VISION (Image Analysis) ===
    handleImageUpload(e) {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            this.addImageFile(file);
        }
        e.target.value = ''; // Reset input
    }

    handleImagePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) this.addImageFile(file);
            }
        }
    }

    async addImageFile(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(',')[1];
                this.attachedImages.push({
                    base64,
                    mimeType: file.type,
                    preview: e.target.result
                });
                this.renderAttachedImages();
                resolve();
            };
            reader.readAsDataURL(file);
        });
    }

    renderAttachedImages() {
        if (this.attachedImages.length === 0) {
            this.els.attachedImages.classList.add('hidden');
            this.els.attachedImages.innerHTML = '';
            return;
        }

        this.els.attachedImages.classList.remove('hidden');
        this.els.attachedImages.innerHTML = this.attachedImages.map((img, i) => `
            <div class="attached-image-preview">
                <img src="${img.preview}" alt="Attached">
                <button class="remove-image-btn" data-index="${i}">×</button>
            </div>
        `).join('');

        // Bind remove buttons
        this.els.attachedImages.querySelectorAll('.remove-image-btn').forEach(btn => {
            btn.onclick = async () => {
                const index = parseInt(btn.dataset.index);
                const preview = btn.closest('.attached-image-preview');

                // Animate exit
                if (preview) {
                    preview.classList.add('exiting');
                    await new Promise(resolve => setTimeout(resolve, 150));
                }

                this.attachedImages.splice(index, 1);
                this.renderAttachedImages();
            };
        });
    }

    // === PDF HANDLING ===
    async handlePdfUpload(e) {
        const file = e.target.files[0];
        if (!file || !file.name.endsWith('.pdf')) return;

        try {
            this.els.attachedPdf.classList.remove('hidden');
            this.els.attachedPdf.innerHTML = '📄 Processing PDF...';

            const arrayBuffer = await file.arrayBuffer();
            const result = await PDFParser.extractText(arrayBuffer);

            this.attachedPdfContent = result.pages.map(p => p.text).join('\n\n');

            this.els.attachedPdf.innerHTML = `
                <div class="pdf-preview">
                    <span>📄 ${file.name} (${result.totalPages} pages)</span>
                    <button class="remove-pdf-btn" title="Remove">×</button>
                </div>
            `;

            this.els.attachedPdf.querySelector('.remove-pdf-btn').onclick = () => {
                this.attachedPdfContent = null;
                this.els.attachedPdf.classList.add('hidden');
                this.els.attachedPdf.innerHTML = '';
            };
        } catch (err) {
            console.error('PDF parsing error:', err);
            this.els.attachedPdf.innerHTML = `<span style="color:red">Failed to process PDF</span>`;
        }

        e.target.value = '';
    }
}

// Start App
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons
    if (typeof Icons !== 'undefined') {
        Icons.replaceAllInDocument();
    }

    window.app = new App();
    window.app.init();
});
