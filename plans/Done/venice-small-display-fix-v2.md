# Venice Small Display Fix v2 - სამოქმედო გეგმა

## პრობლემის აღწერა

**Venice Small** და მსგავსი სწრაფი მოდელების გამოყენებისას, AI-ის პასუხი ვიზუალურად **ბოლომდე არ ჩანს** UI-ში — თვალსაჩინო ტექსტი შუაში "ჩერდება". თუმცა, Copy ღილაკით **სრული ტექსტი** მოდის. ეს ადასტურებს, რომ მონაცემები მეხსიერებაში სრულად ინახება, მხოლოდ DOM-ში ვიზუალური გამოჩენა არ ხდება.

**ამჟამინდელი სტატუსი:** v1 ფიქსი (სტრიქონები [`sidebar.js:4338-4340`](sidebar.js:4338)) **განხორციელებულია**, მაგრამ პრობლემა შეიძლება მაინც არსებობდეს ქვემოთ ჩამოთვლილი მიზეზების გამო.

---

## ძირითადი მიზეზები (პრიორიტეტულობის მიხედვით)

### 1. Race Condition: `chunkBuffer` vs `latestChunk` (🔴 მაღალი პრიორიტეტი)

**აღწერა:**
[`scheduleUIUpdate()`](sidebar.js:4220) იყენებს ორ ბუფერს — `chunkBuffer` და `latestChunk`. როდესაც ახალი chunk-ი 16ms-ზე ნაკლები ინტერვალით მოდის, ის **მხოლოდ** `chunkBuffer`-ში ინახება. `chunkBuffer`-ის შიგთავსი `latestChunk`-ში გადადის **მხოლოდ** მაშინ, თუ `BATCH_INTERVAL` (16ms) გასულია. თუ ბოლო chunk-ები სწრაფ ბურსტებში მოვიდა, ბოლო შიგთავსი `latestChunk`-ში ვერ გადადის.

**ფაილი/ხაზები:** [`sidebar.js:4220-4244`](sidebar.js:4220)

```
API chunks → scheduleUIUpdate() → chunkBuffer (16ms ბარიერი) → latestChunk → rAF → performUIUpdate()
                                                                    ↑
                                              ბოლო chunk-ები ამ ბარიერს ვერ გადადიან!
```

**გადაწყვეტა:**
`onComplete` callback-ში (ხაზი 4338) დამატებული ფინალური სრული რენდერი ამ პრობლემას **აგვარებს** — ეს ფიქსი უკვე განხორციელებულია.

---

### 2. DOM Reference დაკარგვა (🟡 საშუალო პრიორიტეტი)

**აღწერა:**
[`generateResponse()`](sidebar.js:4129)-ში `contentElement` ლოკალური ცვლადია. `onComplete` callback-ი async closure-ია. თუ გარე კოდმა შეძლო `msgElement`-ის DOM-დან ამოღება (მაგ., ახალი საუბრის დაწყება, regenerate) `onComplete`-ის გაშვებამდე, `contentElement` ჩამოჭრილი reference-ი გახდება — ის DOM-ში **აღარ იქნება** და `innerHTML`-ის მინიჭება გავლენას ვერ მოახდენს ვიზუალზე.

**ფაილი/ხაზები:** [`sidebar.js:4155-4158`](sidebar.js:4155) (ლოკ. ცვლადები) + [`sidebar.js:4319`](sidebar.js:4319) (onComplete)

**გადაწყვეტა:**
`onComplete`-ში `contentElement`-ის გამოყენებამდე გადამოწმება: `document.contains(contentElement)`.

---

### 3. `pendingUpdate` flag-ის ჩარჩენა `true`-ზე (🟡 საშუალო პრიორიტეტი)

**აღწერა:**
[`scheduleUIUpdate()`](sidebar.js:4237) იყენებს `pendingUpdate` flag-ს `requestAnimationFrame`-ის გასაგრძელებლად. `performUIUpdate()` ამ flag-ს `false`-ზე ანულებს [`sidebar.js:4240`](sidebar.js:4240). მაგრამ თუ `performUIUpdate` exception-ს გაისვრის, flag ჩარჩება `true`-ზე და **შემდეგი** `requestAnimationFrame` **არასდროს** დაიგეგმება. ეს ნიშნავს, რომ ყველა შემდგომი chunk ვიზუალურად ignored იქნება.

**ფაილი/ხაზები:** [`sidebar.js:4237-4243`](sidebar.js:4237)

**გადაწყვეტა:**
`performUIUpdate`-ის გარშემო `try/finally` ბლოკი, სადაც `finally` ყოველთვის `pendingUpdate = false`-ს ადგენს.

---

### 4. CSS `overflow` / `max-height` შეზღუდვა `.message-content`-ზე (🟡 საშუალო პრიორიტეტი)

**აღწერა:**
თუ [`styles.css`](styles.css)-ში `.message-content`-ს ან მის wrapper-ს აქვს `overflow: hidden` + `max-height`, ან `height: [fixed]` constraint, ტექსტი ვიზუალურად შეიძლება "ჩამოჭრილი" ჩანდეს, მაშინ როდესაც DOM-ში სრულად არის.

**კონფიგურაციის ადგილი:** [`styles.css`](styles.css) — `.message-content`, `.message`, `.chat-container` კლასები

**გადაწყვეტა:**
CSS audit — გადამოწმება, ხომ არ არის `max-height` + `overflow: hidden` კომბინაცია სტრიმინგის დროს; საჭიროების შემთხვევაში `overflow: visible` სტრიმინგის ბოლოს.

---

### 5. Virtual Scrolling Side-Effects (🟢 დაბალი პრიორიტეტი)

**აღწერა:**
[`checkEnableVirtualScroll()`](sidebar.js:4852) ჩართავს ვირტუალ სქროლინგს 50+ შეტყობინებასთან. ვირტუალ სქროლინგის დროს, შეტყობინება შეიძლება "off-screen"-ად ჩაითვალოს და DOM-ში სხვაგვარად მოიქცეს. [`handleChatScroll()`](sidebar.js:4711)-ში [`updateVisibleRange()`](sidebar.js:4727)-ის გამოძახება შეიძლება visible range-ს ყოველი სქროლ-ივენთზე განაახლებდეს.

**ფაილი/ხაზები:** [`sidebar.js:4852-4863`](sidebar.js:4852), [`sidebar.js:4682-4705`](sidebar.js:4682)

**გადაწყვეტა:**
სტრიმინგის დროს ვირტუალ სქროლინგის ინვალიდაცია — `this.isStreaming` flag-ის შემოწმება `checkEnableVirtualScroll()` ან `handleChatScroll()`-ში.

---

### 6. `markdownWorker.renderSync()` Exception (🟢 დაბალი პრიორიტეტი)

**აღწერა:**
[`renderSync()`](sidebar.js:135) ეძახის [`MarkdownRenderer.render()`](markdown-renderer.js)-ს main thread-ზე. თუ markdown-ის parsing-ის დროს exception მოხდა (malformed content), `contentElement.innerHTML = ...` ხაზი შეწყვეტს შესრულებას exception-ის გარეშე ხილული შეცდომის გარეშე.

**ფაილი/ხაზები:** [`sidebar.js:4339`](sidebar.js:4339), [`sidebar.js:135-137`](sidebar.js:135)

**გადაწყვეტა:**
`try/catch` `onComplete`-ის ფინალური რენდერის ირგვლივ + fallback-ი სუფთა ტექსტზე.

---

## განხორციელების გეგმა

### ფაზა 1: Defensive Fixes (უსაფრთხო ცვლილებები — `sidebar.js`)

- [ ] **1.1** — DOM reference validation: `contentElement`-ის შემოწმება `onComplete`-ში `document.contains()`-ით
- [ ] **1.2** — `pendingUpdate` flag leak fix: `try/finally` ბლოკი `requestAnimationFrame`-ის callback-ში
- [ ] **1.3** — `onComplete` ფინალური რენდერის `try/catch` დამატება + plain-text fallback

### ფაზა 2: CSS/Visual Fixes (`styles.css`)

- [ ] **2.1** — `.message-content` overflow audit: `overflow: hidden` + `max-height` კომბინაციის ამოღება/გამოსწორება
- [ ] **2.2** — სტრიმინგის დროსათვის dedicated class: `.message-streaming .message-content` — `overflow: visible`

### ფაზა 3: Streaming Hardening (`sidebar.js`)

- [ ] **3.1** — ვირტუალ სქროლინგის სტრიმინგის shield: `if (this.isStreaming) return;` `checkEnableVirtualScroll()`-ში
- [ ] **3.2** — `chunkBuffer` flush `onComplete`-ის დასაწყისში: `latestChunk = chunkBuffer` onComplete callback-ის პირველ სტრიქონზე
- [ ] **3.3** — Cancel-safe streaming: `pendingUpdate`-ის nullification `stopGeneration()`-ში

### ფაზა 4: Debug & Monitoring

- [ ] **4.1** — Debug logging `onComplete`-ში: `console.debug('[stream:complete] contentLength:', assistantMsg.content.length)`
- [ ] **4.2** — DOM validation log: `console.warn` თუ `contentElement` DOM-ში aღar არის
- [ ] **4.3** — სატესტო სცენარების გაშვება ორივე მოდელზე

---

## კონკრეტული კოდის ცვლილებები

### sidebar.js — ფაზა 1 + 3

#### ცვლილება 1: `pendingUpdate` flag leak fix + DOM check (`sidebar.js:4237-4244`)

```js
// BEFORE (sidebar.js:4237-4244)
if (!pendingUpdate) {
    pendingUpdate = true;
    requestAnimationFrame(() => {
        pendingUpdate = false;
        performUIUpdate(latestChunk, latestThinking);
    });
}

// AFTER — try/finally guarantees flag is always cleared
if (!pendingUpdate) {
    pendingUpdate = true;
    requestAnimationFrame(() => {
        try {
            performUIUpdate(latestChunk, latestThinking);
        } finally {
            pendingUpdate = false;
        }
    });
}
```

#### ცვლილება 2: `chunkBuffer` flush + DOM validation + try/catch in `onComplete` (`sidebar.js:4319-4340`)

```js
// BEFORE (sidebar.js:4319)
async (fullText, fullThinking, usage) => {
    stopThinkingTimer();
    this.isStreaming = false;
    // ...
    assistantMsg.content = fullText.replace(...).trim();
    assistantMsg.thinking = fullThinking;

    // Final render to ensure visual matches stored content
    contentElement.innerHTML = this.markdownWorker.renderSync(assistantMsg.content);
    MarkdownRenderer.setupListeners(contentElement);
    // ...

// AFTER — flush buffer + DOM guard + try/catch
async (fullText, fullThinking, usage) => {
    // Flush any pending chunk buffer immediately (prevents race on fast models)
    if (chunkBuffer) {
        latestChunk = chunkBuffer;
        chunkBuffer = '';
    }

    stopThinkingTimer();
    this.isStreaming = false;
    // ...
    assistantMsg.content = fullText.replace(...).trim();
    assistantMsg.thinking = fullThinking;

    // Final render — guarded: check DOM reference is still live
    if (document.contains(contentElement)) {
        try {
            contentElement.innerHTML = this.markdownWorker.renderSync(assistantMsg.content);
            MarkdownRenderer.setupListeners(contentElement);
        } catch (renderErr) {
            // Fallback to plain text if markdown render fails
            console.warn('[stream:complete] Markdown render failed, falling back to text:', renderErr);
            contentElement.textContent = assistantMsg.content;
        }
    } else {
        console.warn('[stream:complete] contentElement no longer in DOM — skipping final render');
    }
    // ...
```

#### ცვლილება 3: Virtual scroll shield during streaming (`sidebar.js:4852-4863`)

```js
// BEFORE (sidebar.js:4852)
checkEnableVirtualScroll() {
    const messageCount = this.currentConversation?.messages?.length || 0;
    const shouldEnable = messageCount > 50;
    // ...
}

// AFTER — never enable virtual scroll while streaming
checkEnableVirtualScroll() {
    // Do not activate virtual scrolling during active streaming
    // (would interfere with live content updates to the streaming message)
    if (this.isStreaming) return;

    const messageCount = this.currentConversation?.messages?.length || 0;
    const shouldEnable = messageCount > 50;
    // ...
}
```

#### ცვლილება 4: `pendingUpdate` cleanup in `stopGeneration()` (`sidebar.js:4434-4439`)

```js
// BEFORE (sidebar.js:4434)
stopGeneration() {
    this.api.abortStream();
    this.isStreaming = false;
    this.els.sendBtn.classList.remove('hidden');
    this.els.stopBtn.classList.add('hidden');
}

// AFTER — also nullify any pending rAF state
stopGeneration() {
    this.api.abortStream();
    this.isStreaming = false;
    // Note: pendingUpdate is in closure scope of generateResponse(),
    // so we can't directly access it here. The try/finally fix in
    // scheduleUIUpdate() handles this case.
    this.els.sendBtn.classList.remove('hidden');
    this.els.stopBtn.classList.add('hidden');
}
```

---

### styles.css — ფაზა 2

```css
/* Audit and fix: ensure .message-content never clips during stream */
/* Location: search for .message-content in styles.css */

/* ADD — streaming class to message element during generation */
/* This class is added via: msgElement.classList.add('streaming') in renderMessage() */
/* and removed in onComplete callback */

.message.streaming .message-content {
    overflow: visible;
    /* Explicitly override any max-height that might exist */
    max-height: none;
}

/* Ensure the chat container scroll still works */
.chat-container {
    overflow-y: auto; /* confirm this is set */
}
```

**შენიშვნა:** ახალი hardcoded ფერები **არ** ემატება — მხოლოდ layout properties.

---

## ტესტირების სცენარები

1. **Venice Small — სწრაფი პასუხი:** გაგზავნეთ მოკლე შეკითხვა (`"Say 'hello'"`) Venice Small-ზე — პასუხი ბოლომდე უნდა ჩანდეს
2. **Venice Small — გრძელი პასუხი:** გაგზავნეთ `"Write a 500 word essay"` — სქროლი ბოლომდე, ტექსტი უნდა იყოს სრული და ვიზუალი Copy-ს შინაარსს უნდა ემთხვეოდეს
3. **GPT OSS 120b:** იმავე ტესტების გაშვება — ქცევა უნდა იყოს იდენტური (regression check)
4. **Stop + Resume:** სტრიმინგი გაჩერდეს Abort-ით, ახლად დაიწყოს — `pendingUpdate` flag ჩარჩენა არ უნდა მოხდეს
5. **Rapid multiple messages:** 5 შეტყობინება სწრაფ თანმიმდევრობაში — DOM reference leak არ უნდა მოხდეს
6. **Virtual scroll + streaming:** 55+ შეტყობინების კონვერსაციაში ახალი პასუხი — ვირტუალ სქროლინგი სტრიმინგის დროს არ უნდა გააქტიურდეს
7. **Copy vs Visual match:** ყოველ ტესტში Copy-ს შინაარსი ვიზუალს **ზუსტად** უნდა ემთხვეოდეს

---

## წარმატების კრიტერიუმები

- [ ] Venice Small-ის პასუხი ვიზუალურად **სრულად** ჩანს (ბოლო სიტყვა/სიმბოლო ხილულია)
- [ ] Copy ღილაკი და ვიზუალი **ზუსტად** ემთხვევა ყველა მოდელზე
- [ ] GPT OSS 120b (და სხვა მოდელები) — regression არ არის
- [ ] Abort + retry scenario — `pendingUpdate` flag-ი არ ჩარჩება
- [ ] Chrome DevTools Console — არ ჩანს uncaught exceptions streaming closure-ში
- [ ] `[stream:complete]` debug log ჩანს ყოველი გენერაციის ბოლოს (ფაზა 4)

---

## რისკები და შემთხვევითობები

- **რისკი 1:** `document.contains(contentElement)` — false positive (შემსუბუქება: fallback logging + silent skip, UI-ზე გავლენა არ ექნება)
- **რისკი 2:** `chunkBuffer` flush `onComplete`-ში — double-render ორი იდენტური chunk-ის დასრენდერება (შემსუბუქება: ეს idempotent ოპერაციაა, DOM output იდენტური იქნება)
- **რისკი 3:** CSS `.message.streaming` class — თუ class-ის დამატება/ამოღება გამოტოვდება error case-ში, element სარჩება `streaming` კლასით (შემსუბუქება: `try/finally`-ში class ამოღება `onComplete`-სა და error callback-ში)
- **რისკი 4:** Virtual scroll shield — 50+ შეტყობინების კონვერსაციაში სტრიმინგის შემდეგ virtual scroll-ი **ჩაირთვება** `onComplete`-ის შემდეგ (შემსუბუქება: `checkEnableVirtualScroll()` გამოძახება `onComplete` ბოლოს)
- **რისკი 5:** Chrome MV3 CSP — `styles.css`-ში ნებისმიერი inline style ინჟექცია წარუმატებელია (შემსუბუქება: ყველა CSS [`styles.css`](styles.css)-ში class-ის მეშვეობით)

---

## დამატებითი კონტექსტი

### v1 ფიქსი (უკვე განხორციელებული)

[`sidebar.js:4338-4340`](sidebar.js:4338)-ზე:

```js
// Final render to ensure visual matches stored content
contentElement.innerHTML = this.markdownWorker.renderSync(assistantMsg.content);
MarkdownRenderer.setupListeners(contentElement);
```

ეს ფიქსი **პირველ** (და მთავარ) race condition-ს წყვეტს. v2 გეგმა ამ ბაზაზე აშენებს **defensive layers**-ს edge cases-ისთვის.

### სტრიმინგის Timing Diagram (Venice Small vs Large Models)

```
Venice Large: |chunk1|---------|chunk2|---------|chunk3|-----|complete|
                        16ms+           16ms+           16ms+
              → ყველა chunk latestChunk-ში გადადის ✅

Venice Small: |chunk1||chunk2||chunk3||complete|
               <16ms   <16ms   <16ms
              → chunk2, chunk3 chunkBuffer-ში ჩარჩება ❌ (v1 ფიქსამდე)
              → onComplete ფინალური render გამოსწორდება ✅ (v1 ფიქსი)
              → DOM reference check + buffer flush = ✅ (v2 ფიქსი)
```
