/**
 * icons.js
 * Lucide Icons Helper System for Venice AI Assistant
 * Provides consistent SVG icon usage throughout the extension
 */

const Icons = {
  // Icon SVG paths - Lucide Icons (https://lucide.dev)
  svgs: {
    settings: {
      viewBox: '0 0 24 24',
      path: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'
    },
    'trash-2': {
      viewBox: '0 0 24 24',
      path: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'
    },
    copy: {
      viewBox: '0 0 24 24',
      path: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
    },
    plus: {
      viewBox: '0 0 24 24',
      path: '<path d="M5 12h14"/><path d="M12 5v14"/>'
    },
    share: {
      viewBox: '0 0 24 24',
      path: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>'
    },
    'refresh-cw': {
      viewBox: '0 0 24 24',
      path: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'
    },
    pause: {
      viewBox: '0 0 24 24',
      path: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>'
    },
    play: {
      viewBox: '0 0 24 24',
      path: '<polygon points="6 3 20 12 6 21 6 3"/>'
    },
    pencil: {
      viewBox: '0 0 24 24',
      path: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'
    },
    save: {
      viewBox: '0 0 24 24',
      path: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'
    },
    history: {
      viewBox: '0 0 24 24',
      path: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'
    },
    image: {
      viewBox: '0 0 24 24',
      path: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'
    },
    mic: {
      viewBox: '0 0 24 24',
      path: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'
    },
    'clipboard-list': {
      viewBox: '0 0 24 24',
      path: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>'
    },
    'arrow-left': {
      viewBox: '0 0 24 24',
      path: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'
    },
    download: {
      viewBox: '0 0 24 24',
      path: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'
    },
    folder: {
      viewBox: '0 0 24 24',
      path: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'
    },
    pin: {
      viewBox: '0 0 24 24',
      path: '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>'
    },
    check: {
      viewBox: '0 0 24 24',
      path: '<polyline points="20 6 9 17 4 12"/>'
    },
    'alert-circle': {
      viewBox: '0 0 24 24',
      path: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'
    },
    info: {
      viewBox: '0 0 24 24',
      path: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
    },
    send: {
      viewBox: '0 0 24 24',
      path: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'
    },
    'square': {
      viewBox: '0 0 24 24',
      path: '<rect width="18" height="18" x="3" y="3" rx="2"/>'
    },
    paperclip: {
      viewBox: '0 0 24 24',
      path: '<path d="m14.5 2-8.5 8.5a5.3 5.3 0 0 0 7.5 7.5l8.5-8.5a2.8 2.8 0 0 0-4-4l-8.5 8.5a.3.3 0 0 0 .4.4l8.5-8.5"/>'
    },
    'file-text': {
      viewBox: '0 0 24 24',
      path: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/>'
    },
    search: {
      viewBox: '0 0 24 24',
      path: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'
    },
    globe: {
      viewBox: '0 0 24 24',
      path: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'
    },
    ghost: {
      viewBox: '0 0 24 24',
      path: '<path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2 3 3-3 3 3 2-3 3 3V10a8 8 0 0 0-8-8z"/>'
    },
    message: {
      viewBox: '0 0 24 24',
      path: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
    },
    'message-circle': {
      viewBox: '0 0 24 24',
      path: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'
    },
    sparkles: {
      viewBox: '0 0 24 24',
      path: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>'
    },
    volume2: {
      viewBox: '0 0 24 24',
      path: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>'
    },
    loader2: {
      viewBox: '0 0 24 24',
      path: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'
    },
    x: {
      viewBox: '0 0 24 24',
      path: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
    },
    chevronDown: {
      viewBox: '0 0 24 24',
      path: '<path d="m6 9 6 6 6-6"/>'
    },
    chevronUp: {
      viewBox: '0 0 24 24',
      path: '<path d="m18 15-6-6-6 6"/>'
    },
    edit: {
      viewBox: '0 0 24 24',
      path: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'
    },
    'folder-plus': {
      viewBox: '0 0 24 24',
      path: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><line x1="12" x2="12" y1="10" y2="14"/><line x1="10" x2="14" y1="12" y2="12"/>'
    },
    'file-plus': {
      viewBox: '0 0 24 24',
      path: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" x2="12" y1="18" y2="12"/><line x1="9" x2="15" y1="15" y2="15"/>'
    },
    'grip-vertical': {
      viewBox: '0 0 24 24',
      path: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>'
    },
    menu: {
      viewBox: '0 0 24 24',
      path: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>'
    },
    'chevrons-down': {
      viewBox: '0 0 24 24',
      path: '<path d="m7 6 5 5 5-5"/><path d="m7 13 5 5 5-5"/>'
    },
    'arrow-down': {
      viewBox: '0 0 24 24',
      path: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'
    },
    layers: {
      viewBox: '0 0 24 24',
      path: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'
    }
  },

  /**
   * Create an SVG icon element
   * @param {string} name - Icon name (e.g., 'settings', 'trash-2')
   * @param {Object} options - Options for the icon
   * @param {number} options.size - Icon size in pixels (default: 20)
   * @param {string} options.class - Additional CSS classes
   * @param {string} options.color - Stroke color (default: currentColor)
   * @param {number} options.strokeWidth - Stroke width (default: 2)
   * @returns {string} SVG HTML string
   */
  create(name, options = {}) {
    const icon = this.svgs[name];
    if (!icon) {
      console.warn(`Icon "${name}" not found`);
      return '';
    }

    const {
      size = 20,
      class: className = '',
      color = 'currentColor',
      strokeWidth = 2,
      ariaLabel = '',
      ariaHidden = true
    } = options;

    const classes = [`lucide-icon`, `icon-${name}`, className].filter(Boolean).join(' ');

    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      width="${size}"
      height="${size}"
      viewBox="${icon.viewBox}"
      fill="none"
      stroke="${color}"
      stroke-width="${strokeWidth}"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="${classes}"
      ${ariaHidden ? 'aria-hidden="true"' : ''}
      ${ariaLabel ? `aria-label="${ariaLabel}"` : ''}
    >${icon.path}</svg>`;
  },

  /**
   * Create an icon element and return as DOM element
   * @param {string} name - Icon name
   * @param {Object} options - Options for the icon
   * @returns {HTMLElement} SVG element wrapped in a span
   */
  createElement(name, options = {}) {
    const wrapper = document.createElement('span');
    wrapper.className = 'icon-wrapper';
    wrapper.innerHTML = this.create(name, options);
    return wrapper;
  },

  /**
   * Replace all emoji icons in the document with SVG icons
   * Call this after DOM is loaded
   */
  replaceAllInDocument() {
    // Map of emoji to icon names
    const emojiToIcon = {
      ' SETTINGS_ICON ': 'settings',
      ' TRASH_ICON ': 'trash-2',
      ' COPY_ICON ': 'copy',
      ' PLUS_ICON ': 'plus',
      ' SHARE_ICON ': 'share',
      ' REFRESH_ICON ': 'refresh-cw',
      ' PAUSE_ICON ': 'pause',
      ' PLAY_ICON ': 'play',
      ' PENCIL_ICON ': 'pencil',
      ' SAVE_ICON ': 'save',
      ' HISTORY_ICON ': 'history',
      ' IMAGE_ICON ': 'image',
      ' MIC_ICON ': 'mic',
      ' CLIPBOARD_ICON ': 'clipboard-list',
      ' ARROW_LEFT_ICON ': 'arrow-left',
      ' DOWNLOAD_ICON ': 'download',
      ' FOLDER_ICON ': 'folder',
      ' PIN_ICON ': 'pin',
      ' CHECK_ICON ': 'check',
      ' ALERT_ICON ': 'alert-circle',
      ' INFO_ICON ': 'info',
      ' SEND_ICON ': 'send',
      ' STOP_ICON ': 'square',
      ' ATTACH_ICON ': 'paperclip',
      ' PDF_ICON ': 'file-text',
      ' SEARCH_ICON ': 'search',
      ' GLOBE_ICON ': 'globe',
      ' GHOST_ICON ': 'ghost',
      ' MESSAGE_ICON ': 'message',
      ' SPARKLES_ICON ': 'sparkles',
      ' VOLUME_ICON ': 'volume2',
      ' LOADER_ICON ': 'loader2',
      ' X_ICON ': 'x',
      ' CHEVRON_DOWN_ICON ': 'chevronDown',
      ' CHEVRON_UP_ICON ': 'chevronUp',
      ' EDIT_ICON ': 'edit',
      ' FOLDER_PLUS_ICON ': 'folder-plus',
      ' FILE_PLUS_ICON ': 'file-plus'
    };

    // Find all elements with data-icon attribute
    document.querySelectorAll('[data-icon]').forEach(el => {
      const iconName = el.getAttribute('data-icon');
      if (iconName && this.svgs[iconName]) {
        el.innerHTML = this.create(iconName, {
          size: parseInt(el.dataset.iconSize) || 20,
          class: el.dataset.iconClass || ''
        });
      }
    });
  },

  /**
   * Get icon name from emoji
   * @param {string} emoji - Emoji character
   * @returns {string|null} Icon name or null if not found
   */
  getIconNameFromEmoji(emoji) {
    const emojiMap = {
      ' SETTINGS_ICON ': 'settings',
      ' TRASH_ICON ': 'trash-2',
      ' COPY_ICON ': 'copy',
      ' PLUS_ICON ': 'plus',
      ' SHARE_ICON ': 'share',
      ' REFRESH_ICON ': 'refresh-cw',
      ' PAUSE_ICON ': 'pause',
      ' PLAY_ICON ': 'play',
      ' PENCIL_ICON ': 'pencil',
      ' SAVE_ICON ': 'save',
      ' HISTORY_ICON ': 'history',
      ' IMAGE_ICON ': 'image',
      ' MIC_ICON ': 'mic',
      ' CLIPBOARD_ICON ': 'clipboard-list',
      ' ARROW_LEFT_ICON ': 'arrow-left',
      ' DOWNLOAD_ICON ': 'download',
      ' FOLDER_ICON ': 'folder',
      ' PIN_ICON ': 'pin',
      ' CHECK_ICON ': 'check',
      ' ALERT_ICON ': 'alert-circle',
      ' INFO_ICON ': 'info',
      ' SEND_ICON ': 'send',
      ' STOP_ICON ': 'square',
      ' ATTACH_ICON ': 'paperclip',
      ' PDF_ICON ': 'file-text',
      ' SEARCH_ICON ': 'search',
      ' GLOBE_ICON ': 'globe',
      ' GHOST_ICON ': 'ghost',
      ' MESSAGE_ICON ': 'message',
      ' SPARKLES_ICON ': 'sparkles',
      ' VOLUME_ICON ': 'volume2',
      ' LOADER_ICON ': 'loader2',
      ' X_ICON ': 'x',
      ' CHEVRON_DOWN_ICON ': 'chevronDown',
      ' CHEVRON_UP_ICON ': 'chevronUp',
      ' EDIT_ICON ': 'edit',
      ' FOLDER_PLUS_ICON ': 'folder-plus',
      ' FILE_PLUS_ICON ': 'file-plus'
    };
    return emojiMap[emoji] || null;
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Icons;
}

// Make available globally
window.Icons = Icons;