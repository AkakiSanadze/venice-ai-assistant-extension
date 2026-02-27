# Reading Comfort Theme Implementation Plan

## Overview
Add a third theme option "Reading Comfort" (warm/sepia tones) between dark and light themes for comfortable extended reading sessions.

## Current Theme System

### Structure
- **CSS Custom Properties**: All themes use `:root[data-theme="..."]` selectors in `styles.css`
- **Theme Storage**: Via `Storage.updateSettings({ theme })` in `storage.js`
- **Theme Application**: `Sidebar.applyTheme()` in `sidebar.js` line 1729
- **Theme Selector**: Dropdown in `sidebar.html` lines 495-498

### Existing Themes
| Theme | CSS Selector | Background | Text |
|-------|-------------|------------|------|
| Dark | `:root[data-theme="dark"]` | `#0D0D0F` | `#F5F5F7` |
| Light | `:root[data-theme="light"]` | `#FFFFFF` | `#0f172a` |
| System | Resolved to dark/light based on OS preference | — | — |

---

## Implementation Steps

### Step 1: Add CSS Theme Variables
**File**: `styles.css`
**Location**: After light theme (line 233), add new section

```css
/* ==================== READING COMFORT THEME ==================== */
:root[data-theme="reading"] {
  /* Background Layers - Warm sepia tones */
  --color-bg-primary: #FDF6E3;      /* Solarized light base */
  --color-bg-secondary: #F5EFDC;    /* Slightly darker warm */
  --color-bg-tertiary: #EEE8D5;     /* Warm tertiary */
  --color-bg-overlay: #FAF4E4;      /* Overlay background */

  /* Legacy aliases */
  --bg-primary: var(--color-bg-primary);
  --bg-secondary: var(--color-bg-secondary);
  --bg-tertiary: var(--color-bg-tertiary);
  --bg-glass: rgba(255, 248, 230, 0.7);
  --border-glass: rgba(139, 119, 82, 0.15);

  /* Text Colors - Soft warm browns */
  --color-text-primary: #3D3526;   /* Deep brown - main text */
  --color-text-secondary: #5C5344; /* Medium brown */
  --color-text-muted: #8B7C5E;     /* Muted warm */
  --color-text-disabled: #C4B9A3;   /* Disabled state */

  /* Legacy aliases */
  --text-primary: var(--color-text-primary);
  --text-secondary: var(--color-text-secondary);
  --text-muted: var(--color-text-muted);

  /* Accent Colors - Muted warm accent */
  --color-accent: #B5886D;          /* Warm terracotta */
  --color-accent-hover: #9E7559;    /* Darker terracotta */
  --color-accent-secondary: #8B6F4E; /* Warm brown */
  --accent-primary: var(--color-accent);
  --accent-secondary: var(--color-accent-secondary);
  --accent-gradient: linear-gradient(135deg, #B5886D, #8B6F4E, #7A6145);

  /* Semantic Colors - Adjusted for warm theme */
  --color-success: #6B8E5F;         /* Sage green */
  --color-warning: #D4A84B;         /* Warm gold */
  --color-error: #C27B6B;           /* Muted red */
  --color-info: #7B9BC7;            /* Soft blue */
  --success: var(--color-success);
  --warning: var(--color-warning);
  --error: var(--color-error);

  /* Message Bubbles */
  --user-bubble-bg: #E8DCC8;
  --user-bubble-border: #D4C4A8;
  --assistant-bubble-bg: #F5EFDC;
  --assistant-bubble-border: #E0D4BE;
  --user-bubble: rgba(181, 136, 109, 0.15);
  --assistant-bubble: rgba(61, 53, 38, 0.05);

  /* Borders */
  --border-subtle: rgba(139, 119, 82, 0.08);
  --border-default: rgba(139, 119, 82, 0.15);
  --border-strong: rgba(139, 119, 82, 0.25);

  /* Shadows */
  --shadow-glass: 0 8px 32px rgba(139, 119, 82, 0.12);
}
```

### Step 2: Add Theme-Specific Overrides
**File**: `styles.css`
**Location**: After existing dark/light overrides (~line 1700-1710)

Add overrides for reading theme:

```css
/* Reading Comfort theme adjustments */
:root[data-theme="reading"] .message-stats {
  background: rgba(61, 53, 38, 0.08);
}

:root[data-theme="reading"] .message-user {
  background: var(--color-accent);
  color: white;
}

:root[data-theme="reading"] .message-assistant {
  background: var(--color-bg-secondary);
  border-left: 3px solid var(--color-accent);
}

:root[data-theme="reading"] .message-audio-player,
:root[data-theme="reading"] .message-tts-progress {
  background: var(--color-bg-secondary);
}

:root[data-theme="reading"] .chain-step-item,
:root[data-theme="reading"] .chain-step-prompt,
:root[data-theme="reading"] .chain-step-system-prompt,
:root[data-theme="reading"] .chain-execution-output {
  background: var(--color-bg-secondary);
}
```

### Step 3: Add Dropdown Option
**File**: `sidebar.html`
**Location**: Line 495-498

```html
<select id="theme-selector">
  <option value="system">System</option>
  <option value="dark">Dark</option>
  <option value="reading">Reading Comfort</option>
  <option value="light">Light</option>
</select>
```

**Note**: Order places "Reading Comfort" between dark and light, matching user preference.

### Step 4: JavaScript - No Changes Required
The existing `applyTheme()` method in `sidebar.js` already handles any theme value:
- It checks if theme === 'system' to resolve OS preference
- Otherwise sets `data-theme` attribute directly
- New theme will work automatically

---

## Files to Modify

| File | Changes |
|------|---------|
| `styles.css` | Add ~50 lines for new theme + ~15 lines for overrides |
| `sidebar.html` | Add 1 new `<option>` element |

---

## Testing Checklist

- [ ] Theme appears in dropdown
- [ ] Selecting theme persists across page reloads
- [ ] All UI components render correctly (messages, buttons, inputs, etc.)
- [ ] System theme detection still works
- [ ] No contrast accessibility issues
- [ ] Smooth transition between themes

---

## Optional Enhancements (Future)

1. **Auto-detect reading mode**: Option to auto-apply reading theme at certain hours
2. **Custom accent color**: Allow users to pick accent color for reading theme
3. **Font optimization**: Larger base font size option for reading theme
