# Transcript/Message Edit Modal - Implementation Plan

## Overview

Replace the native browser `prompt()` dialog in the `editMessage()` function with the existing professional modal (`#prompt-editor-modal`). This provides a consistent UX with the prompt editor while maintaining all existing functionality.

## Current State

### Problem Code (sidebar.js, lines 5102-5128)

```javascript
async editMessage(index) {
    const msg = this.currentConversation.messages[index];
    if (!msg || msg.role !== 'user') return;

    const newContent = prompt('Edit:', msg.content);  // ← Native prompt()
    if (newContent === null || newContent.trim() === '') return;

    msg.content = newContent.trim();
    // ... rest of logic
}
```

### Existing Modal Structure (sidebar.html, lines 595-633)

```html
<div id="prompt_editor-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="prompt-editor-title">
    <div class="modal-content prompt-editor-modal">
        <div class="modal-header">
            <h2 id="prompt-editor-title">Edit Prompt</h2>
            <button id="prompt-editor-close" class="btn btn-icon" aria-label="Close">...</button>
        </div>
        <div class="modal-body">
            <!-- Name field (for prompts) -->
            <div class="form-group">
                <label for="prompt-editor-name">Name</label>
                <input type="text" id="prompt-editor-name" placeholder="Prompt name...">
            </div>
            <!-- Category field (for prompts) -->
            <div class="form-group" id="prompt-editor-category-group">...</div>
            <!-- Content field -->
            <div class="form-group">
                <label for="prompt-editor-content">Content</label>
                <textarea id="prompt-editor-content" placeholder="Prompt content..." rows="10"></textarea>
                <div class="prompt-editor-char-count">
                    <span id="prompt-editor-chars">0</span> characters
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button id="prompt-editor-cancel" class="btn btn-secondary">Cancel</button>
            <button id="prompt-editor-save" class="btn btn-primary">Save</button>
        </div>
    </div>
</div>
```

---

## Files to Modify

| File | Changes Required |
|------|-----------------|
| `sidebar.js` | Modify `editMessage()` function; add new `openMessageEditor()` method; add `messageEditorState` tracking |
| `sidebar.html` | Hide name/category fields when in message-edit mode (or use CSS) |
| `styles.css` | Optional: Add styles for message editor mode |

---

## Implementation Steps

### Step 1: Add Message Editor State (sidebar.js)

Add state tracking for the message editor in the `App` constructor, after the `promptEditorState`:

```javascript
// Prompt editor state
this.promptEditorState = {
    type: null,  // 'user' or 'system'
    mode: null,  // 'create' or 'edit'
    existingPrompt: null
};

// NEW: Message editor state
this.messageEditorState = {
    index: null,          // Message index being edited
    originalContent: '',  // Original message content
    callback: null        // Callback function to execute on save
};
```

### Step 2: Create openMessageEditor() Method (sidebar.js)

Add a new method to open the modal for message editing:

```javascript
/**
 * Open the message editor modal for editing transcript/messages
 * @param {number} index - Index of the message in conversation.messages
 * @param {Function} onSave - Callback function to execute after save
 */
openMessageEditor(index, onSave) {
    const msg = this.currentConversation.messages[index];
    if (!msg || msg.role !== 'user') return;

    // Store state
    this.messageEditorState = {
        index: index,
        originalContent: msg.content,
        callback: onSave
    };

    // Configure modal for message editing
    this.els.promptEditorTitle.textContent = 'Edit Message';
    
    // Hide name and category fields (not needed for messages)
    const nameGroup = this.els.promptEditorName?.closest('.form-group');
    const categoryGroup = this.els.promptEditorCategoryGroup;
    if (nameGroup) nameGroup.style.display = 'none';
    if (categoryGroup) categoryGroup.style.display = 'none';

    // Pre-fill content
    this.els.promptEditorContent.value = msg.content;
    this.updatePromptEditorCharCount();

    // Show modal
    this.els.promptEditorModal.classList.remove('hidden');
    
    // Focus textarea
    setTimeout(() => this.els.promptEditorContent.focus(), 100);
}
```

### Step 3: Modify editMessage() Function (sidebar.js)

Replace the current `editMessage()` function:

```javascript
async editMessage(index) {
    const msg = this.currentConversation.messages[index];
    if (!msg || msg.role !== 'user') return;

    // Open the modal editor instead of prompt()
    this.openMessageEditor(index, async (newContent) => {
        if (!newContent || newContent.trim() === '') return;

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

        // Save to storage (if not in temporary mode)
        if (!this.isTemporaryMode) {
            await Storage.saveConversation(this.currentConversation);
        }

        // Generate new response
        this.generateResponse();
    });
}
```

### Step 4: Add saveMessageFromEditor() Method (sidebar.js)

Add a new method to handle save from the message editor:

```javascript
/**
 * Save the edited message from the message editor modal
 */
async saveMessageFromEditor() {
    const { index, callback } = this.messageEditorState;
    
    if (index === null || !callback) {
        this.closeMessageEditor();
        return;
    }

    const newContent = this.els.promptEditorContent.value.trim();
    
    // Execute the callback with new content
    await callback(newContent);
    
    // Close the editor
    this.closeMessageEditor();
}
```

### Step 5: Add closeMessageEditor() Method (sidebar.js)

Add a method to close the message editor and reset state:

```javascript
/**
 * Close the message editor modal
 */
closeMessageEditor() {
    if (this.els.promptEditorModal) {
        this.els.promptEditorModal.classList.add('hidden');
    }
    
    // Reset message editor state
    this.messageEditorState = {
        index: null,
        originalContent: '',
        callback: null
    };
    
    // Note: We don't reset promptEditorState here as it may be used by the prompt editor
}
```

### Step 6: Update Event Bindings (sidebar.js)

Add event listener setup for the message editor in `bindEvents()`. The existing prompt editor handlers can be extended to handle message editing mode:

Find this section in `bindEvents()`:

```javascript
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
```

Replace with:

```javascript
// === PROMPT EDITOR / MESSAGE EDITOR MODAL ===
if (this.els.promptEditorClose) {
    this.els.promptEditorClose.onclick = () => {
        // Check which editor is active
        if (this.messageEditorState.index !== null) {
            this.closeMessageEditor();
        } else {
            this.closePromptEditor();
        }
    };
}
if (this.els.promptEditorCancel) {
    this.els.promptEditorCancel.onclick = () => {
        // Check which editor is active
        if (this.messageEditorState.index !== null) {
            this.closeMessageEditor();
        } else {
            this.closePromptEditor();
        }
    };
}
if (this.els.promptEditorSave) {
    this.els.promptEditorSave.onclick = () => {
        // Check which editor is active
        if (this.messageEditorState.index !== null) {
            this.saveMessageFromEditor();
        } else {
            this.savePromptFromEditor();
        }
    };
}
```

Also update the Escape key handler:

```javascript
// Escape key to close modal (additional handler)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && this.els.promptEditorModal && 
        !this.els.promptEditorModal.classList.contains('hidden')) {
        // Check which editor is active
        if (this.messageEditorState.index !== null) {
            this.closeMessageEditor();
        } else {
            this.closePromptEditor();
        }
    }
});
```

And update the modal backdrop click handler:

```javascript
if (this.els.promptEditorModal) {
    this.els.promptEditorModal.onclick = (e) => {
        if (e.target === this.els.promptEditorModal) {
            // Check which editor is active
            if (this.messageEditorState.index !== null) {
                this.closeMessageEditor();
            } else {
                this.closePromptEditor();
            }
        }
    };
}
```

---

## CSS Considerations (Optional Enhancement)

The existing modal already works well. However, for better UX, you may want to add styles for message editor mode. Add to `styles.css`:

```css
/* Message Editor Mode - hide unnecessary fields */
body.message-editor-mode .prompt-editor-modal #prompt-editor-name,
body.message-editor-mode .prompt-editor-modal #prompt-editor-category-group {
    display: none;
}

/* Make textarea more prominent in message editor mode */
body.message-editor-mode .prompt-editor-modal #prompt-editor-content {
    min-height: 200px;
}
```

Then add the class in `openMessageEditor()`:
```javascript
document.body.classList.add('message-editor-mode');
```

And remove it in `closeMessageEditor()`:
```javascript
document.body.classList.remove('message-editor-mode');
```

---

## Summary of Changes

### sidebar.js

1. **Add `messageEditorState` to constructor** (around line 720):
   - Track message index, original content, and save callback

2. **Add `openMessageEditor()` method** (around line 3655, after `editMessage`):
   - Configure modal title to "Edit Message"
   - Hide name/category fields
   - Pre-fill textarea with message content
   - Store callback for save action

3. **Modify `editMessage()` method** (line 5102):
   - Call `openMessageEditor()` instead of `prompt()`
   - Pass callback that handles the save logic

4. **Add `saveMessageFromEditor()` method**:
   - Execute callback with new content
   - Close modal

5. **Add `closeMessageEditor()` method**:
   - Close modal
   - Reset state

6. **Update event bindings** (in `bindEvents()`):
   - Modify close/cancel/save handlers to check which editor is active
   - Update Escape key and backdrop click handlers

### sidebar.html

No changes required - the existing modal structure works perfectly for both use cases.

### styles.css

No changes required for basic implementation. Optional: Add `.message-editor-mode` class for enhanced styling.

---

## Testing Checklist

- [ ] Click edit button on user message - modal opens with correct content
- [ ] Character counter updates as you type
- [ ] Escape key closes the modal
- [ ] Click outside modal (backdrop) closes it
- [ ] Cancel button closes modal without saving
- [ ] Save button saves content and triggers regeneration
- [ ] Works with both short and long messages (transcripts)
- [ ] Modal is accessible (keyboard navigation, ARIA)
- [ ] Works with dark/light themes

---

## Edge Cases Handled

1. **Empty content**: User cannot save empty content (same as before)
2. **Cancel**: Clicking cancel or pressing Escape closes without saving
3. **Same content**: If user doesn't change anything, still regenerates (consistent with original behavior)
4. **Long transcripts**: Textarea is resizable and supports long content
5. **Temporary mode**: Correctly handles saving vs not saving based on mode
