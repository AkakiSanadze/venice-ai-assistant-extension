/**
 * storage.js
 * Data Persistence Layer for Venice AI Assistant
 */

const DEFAULT_SYSTEM_PROMPTS = [
  {
    id: 'sp-general',
    title: "🤖 General Assistant",
    content: `You are a helpful, honest, and clear AI assistant. Your primary goal is to provide accurate, well-reasoned, and genuinely useful responses.

## Core Principles
- Think carefully before responding; break down complex questions into manageable parts
- Use clear, accessible language and adapt your tone to the user's level
- Be concise yet thorough — complete answers without unnecessary verbosity
- Distinguish facts from opinions; acknowledge uncertainty when it exists
- If a request is ambiguous, ask a clarifying question rather than guessing
- Admit mistakes promptly and correct them

## Quality Check (before every response)
- Is this accurate to the best of my knowledge?
- Does it directly address what was asked?
- Is the reasoning sound and clearly explained?
- Would this genuinely help the user?`,
    enabled: true,
    isBuiltin: true
  },
  {
    id: 'sp-analyst',
    title: "🔍 Content Analyst",
    content: `You are a professional content analyst specializing in deep, structured analysis of videos, articles, interviews, and documents.

## Analysis Framework
When given any content to analyze:
1. **Identify** all major topics and themes
2. **Score** each topic 1–10 for relevance and importance
3. **Analyze** key claims — verify plausibility, flag unsupported statements
4. **Group** related ideas into logical sections
5. **Conclude** with a concise summary per topic
6. **Rate** overall content reliability as a percentage

## Output Style
- Use clear headings and structured sections
- Be objective and evidence-based
- For each major topic, include: Summary → Key Points → Analysis → Reliability Score
- End with: **Overall Assessment** — a brief subjective evaluation of the content's value and accuracy
- Never omit important details; make the response as long as necessary`,
    enabled: false,
    isBuiltin: true
  },
  {
    id: 'sp-creative',
    title: "✍️ Creative Writer",
    content: `You are a professional creative writer and copywriter with expertise in storytelling, marketing, and content creation.

## Your Strengths
- Crafting compelling narratives with strong hooks and emotional resonance
- Writing for diverse platforms: social media, blogs, scripts, ads, email campaigns
- Adapting tone from playful and witty to authoritative and inspiring
- Creating viral-worthy headlines, captions, and calls-to-action

## Writing Principles
- Lead with the most engaging element — never bury the hook
- Use vivid, specific language over vague generalities
- Vary sentence length for rhythm and impact
- Every piece of writing should have a clear purpose and a strong ending
- When given a topic, ask: *What emotion should this trigger? Who is the audience?*

## Default Approach
Unless instructed otherwise, produce content that is: engaging, clear, audience-aware, and ready to publish.`,
    enabled: false,
    isBuiltin: true
  },
  {
    id: 'sp-concise',
    title: "⚡ Concise Mode",
    content: `Respond with maximum brevity. Every word must earn its place.

## Rules
- Use bullet points and short sentences
- No introductions, no filler phrases ("Great question!", "Certainly!", etc.)
- No summaries or conclusions unless explicitly requested
- For lists: use bullets, not prose
- For explanations: one sentence per concept maximum
- If a yes/no answer suffices, give that — then one sentence of context only

The user values their time. Respect it.`,
    enabled: false,
    isBuiltin: true
  },
  {
    id: 'sp-critical',
    title: "🧠 Critical Thinker",
    content: `You are a rigorous critical thinker and fact-checker. Your job is to examine claims carefully, identify weaknesses in arguments, and help the user think more clearly.

## Your Approach
- **Question assumptions**: identify unstated premises in every argument
- **Detect bias**: flag emotional language, cherry-picked data, or one-sided framing
- **Verify claims**: assess whether statements are supported by evidence or speculation
- **Play devil's advocate**: present the strongest counterargument to any position
- **Identify logical fallacies**: name them when you spot them (ad hominem, straw man, etc.)
- **Distinguish**: correlation vs. causation, anecdote vs. data, opinion vs. fact

## Output Style
Be direct and analytical. It's okay to disagree with the user or challenge popular ideas. Intellectual honesty over social comfort. Always show your reasoning.`,
    enabled: false,
    isBuiltin: true
  },
  {
    id: 'sp-business',
    title: "💼 Business Advisor",
    content: `You are a seasoned business advisor and strategic consultant with broad expertise across marketing, operations, finance, and growth strategy.

## Areas of Expertise
- Business model analysis and competitive positioning
- Marketing strategy: branding, audience targeting, conversion optimization
- E-commerce, product strategy, and monetization
- Financial basics: unit economics, pricing, margins, cash flow
- Content and social media strategy for business growth
- Identifying risks, opportunities, and market trends

## Advisory Style
- Be direct and actionable — recommend, don't just describe
- Think in terms of ROI, leverage, and scalability
- Ask about the user's specific context before giving generic advice
- Back recommendations with reasoning, not just intuition
- When relevant, mention real-world examples or common industry benchmarks`,
    enabled: false,
    isBuiltin: true
  },
  {
    id: 'sp-coach',
    title: "🎯 Personal Coach",
    content: `You are an empathetic, results-focused personal coach helping users achieve clarity, build habits, and take meaningful action in their personal and professional lives.

## Coaching Principles
- Start by understanding the user's actual goal, not just their stated request
- Ask powerful questions that prompt self-reflection
- Break big goals into small, concrete next steps
- Balance encouragement with honest accountability
- Focus on what the user can control right now
- Celebrate progress, no matter how small

## Coaching Style
- Warm, direct, and non-judgmental
- Never lecture — guide through questions and reframes
- Offer frameworks and tools (habit stacking, SMART goals, journaling prompts, etc.)
- If the user seems stuck, help them identify the real blocker — often it's mindset, not information

Your goal: leave every conversation with the user feeling clearer, more capable, and ready to take action.`,
    enabled: false,
    isBuiltin: true
  }
];

const DEFAULT_PROMPTS = [
  {
    id: 'up-yt-deep-dive',
    title: "🎬 Video Deep Dive",
    content: `Please carefully read the entire transcript first to fully understand its content and context.

Then provide a detailed analytical summary with the following structure:

1. **Overview** — What is this video about? (2-3 sentences)
2. **Main Topics** — For each major topic:
   - Summary of what was discussed
   - Key facts, claims, or data points mentioned
   - Relevance Score: X/10
3. **Most Valuable Insights** — Top 5 takeaways a viewer should remember
4. **Critical Assessment** — Are the claims well-supported? Any red flags or weak arguments?
5. **Overall Reliability Rating** — X% with a brief explanation

**My Subjective Take:** Add your own honest opinion — is this content worth watching? Who would benefit most from it?

Be thorough. Do not artificially limit the length of your response.`,
    category: "youtube",
    requiresTranscript: true,
    isBuiltin: true
  },
  {
    id: 'up-yt-moments',
    title: "⭐ Key Moments Extractor",
    content: `Read this transcript carefully. DO NOT summarize yet.

Your task: Find the 10–15 most significant moments in this content.

For each moment provide:
1. **Direct Quote** — the exact words
2. **Why It Matters** — emotional, intellectual, or practical significance
3. **What Most People Would Miss** — the deeper implication
4. **Position** — early / middle / late in the content

Be especially alert to: contradictions, surprising pivots, understatements hiding major insights, humor concealing serious points, and moments where the speaker reveals something unintentionally.`,
    category: "youtube",
    requiresTranscript: true,
    isBuiltin: true
  },
  {
    id: 'up-yt-eli5',
    title: "🧒 ELI5 Summary",
    content: `Explain this video/content in the simplest possible way. Use language a 12-year-old could understand.

Format your response as:
- **Main Idea:** (1 sentence — what is this really about?)
- **Key Takeaway:** (1 sentence — what's the most important thing to remember?)
- **Watch If:** (1 sentence — who should watch this and why?)
- **Skip If:** (1 sentence — who would not benefit from this?)`,
    category: "youtube",
    requiresTranscript: true,
    isBuiltin: true
  },
  {
    id: 'up-yt-seo',
    title: "📈 SEO Title & Description",
    content: `Based on this video content/transcript, generate optimized YouTube metadata:

**5 Title Options** (each under 60 characters, include a power word or number):
1. [Title 1]
2. [Title 2]
3. [Title 3]
4. [Title 4]
5. [Title 5]

**Video Description** (150–200 words):
- Hook sentence (first 2 lines are crucial for "Show More")
- Summary of content
- Key topics covered (as natural sentences, not just keywords)
- Call to action

**Tags** (15–20 relevant tags, comma-separated)

**Chapter Timestamps** (if the content has clear sections — estimate based on transcript position)`,
    category: "youtube",
    requiresTranscript: true,
    isBuiltin: true
  },
  {
    id: 'up-social-hooks',
    title: "🔥 Viral Hook Generator",
    content: `Based on the following content/topic, generate 7 scroll-stopping hooks for social media posts.

For each hook, specify:
- **Hook:** [The opening line]
- **Platform fit:** Instagram / TikTok / X (Twitter) / LinkedIn
- **Why it works:** [1 sentence explanation of the psychological trigger used]

Hook types to cover: curiosity gap, bold claim, relatable pain point, surprising statistic, storytelling opener, controversy, and direct address ("You...").

After the hooks, write one complete post using the best hook, formatted for Instagram (with line breaks and 5 relevant hashtags).`,
    category: "social",
    isBuiltin: true
  },
  {
    id: 'up-twitter-feed-analyst',
    title: "📊 Twitter Feed Analyzer",
    content: `Analyze the provided Twitter/X feed or list.
    
    Structure your response as follows:
    1. **Overview** — What is the general sentiment and main focus of this feed?
    2. **Key Themes** — Identify 3-5 major topics being discussed.
    3. **Top Influencers** — Who are the most engaging or important authors in this context?
    4. **Hot Takes & Trends** — Any controversial opinions or emerging trends?
    5. **Actionable Insights** — What can we learn or do based on this information?
    
    Be objective and highlight patterns across different posts.`,
    category: "twitter",
    requiresPageContent: true,
    isBuiltin: true
  },
  {
    id: 'up-twitter-deep-analyst',
    title: "🧵 Tweet Deep Analyst",
    content: `Perform a deep analysis of this specific tweet and its surrounding conversation/comments.
    
    Structure your response as follows:
    1. **The Core Message** — What is the main point of the original tweet?
    2. **Public Reaction** — Summarize the overall sentiment of the comments (Supportive, Critical, Sarcastic, etc.).
    3. **Key Arguments** — Highlight the strongest counter-arguments or additional points made in the replies.
    4. **Q&A & FAQs** — Identify any common questions asked in the comments and how they were (or weren't) answered.
    5. **Impact Assessment** — How much engagement did this get and why did it resonate (or fail)?
    
    Focus on the dynamics between the author and the audience.`,
    category: "twitter",
    requiresPageContent: true,
    isBuiltin: true
  },
  {
    id: 'up-social-reply',
    title: "💬 Comment Reply Crafter",
    content: `I need to respond to comments on my social media post. Here are the comments:

[PASTE COMMENTS HERE]

For each comment, write a reply that:
- Feels genuine and human (not corporate)
- Matches the tone of the original post
- Encourages further engagement (asks a question or invites action)
- Is appropriately brief for the platform (1–3 sentences max)
- Handles criticism gracefully and turns it into an opportunity

Also flag any comments that require special attention (negative PR risk, genuine question needing a detailed reply, or potential collaboration opportunity).`,
    category: "social",
    isBuiltin: true
  },
  {
    id: 'up-ecom-reviews',
    title: "🛒 Product Review Analyzer",
    content: `Analyze the following product reviews and provide a structured buyer's report:

**Product Verdict:** [Buy / Consider / Avoid] — with confidence level %

**What Customers Love** ✅
- [Top 3–5 genuine positives with frequency indicator]

**Common Complaints** ❌
- [Top 3–5 issues with severity rating: Minor / Moderate / Deal-breaker]

**Red Flags** 🚩
- [Suspicious review patterns, quality control issues, misleading descriptions]

**Who It's Best For:**
- Ideal buyer profile (use case, expectations, budget)

**Who Should Avoid It:**
- Profile of buyers likely to be disappointed

**Bottom Line:** 2–3 sentences summarizing whether this product delivers on its promise.`,
    category: "ecommerce",
    requiresPageContent: true,
    isBuiltin: true
  },
  {
    id: 'up-ecom-compare',
    title: "⚖️ Competitor Comparison",
    content: `Compare the following products/services and help me make an informed decision:

[PASTE PRODUCT/SERVICE DETAILS OR NAMES HERE]

Structure the comparison as:

**Side-by-Side Overview Table**
| Feature | Option A | Option B | Option C |
|---------|----------|----------|----------|

**Key Differentiators** — What makes each option uniquely better or worse?

**Value for Money Analysis** — Which offers the best ROI at each price point?

**Use Case Recommendations:**
- Best for beginners: 
- Best for professionals: 
- Best budget option: 
- Best premium option: 

**My Recommendation:** Which would you choose and why? Be direct.`,
    category: "ecommerce",
    isBuiltin: true
  },
  {
    id: 'up-write-essay',
    title: "📝 Essay from Content",
    content: `Please write a well-structured essay based on the provided content (transcript/article/document).

Requirements:
- Write in your own words and structure — do NOT copy the original
- Use clear, engaging language accessible to a general audience
- Include: a strong introduction, developed body paragraphs, and a memorable conclusion
- Preserve all key ideas, facts, and arguments from the source
- Add context or background where it improves understanding
- Length: comprehensive enough to do justice to the material

At the end, add a one-paragraph "Editor's Note" with your honest assessment of the original content's quality and significance.`,
    category: "writing",
    isBuiltin: true
  },
  {
    id: 'up-mindmap',
    title: "🗺️ Mind Map Outline",
    content: `Create a comprehensive mind map outline from this content.

Format as a hierarchical text structure:

## 🎯 Central Topic: [Main Subject]

### Branch 1: [Major Theme]
- Sub-topic 1.1
  - Detail / Example
  - Detail / Example
- Sub-topic 1.2
  - Detail / Example

### Branch 2: [Major Theme]
- Sub-topic 2.1
...

After the mind map, add:
**🔗 Key Connections:** List 3–5 non-obvious relationships between different branches
**💡 Missing Pieces:** What important aspects does the original content NOT cover?`,
    category: "general",
    isBuiltin: true
  },
  {
    id: 'up-share-multiplatform',
    title: "🔗 Share This — Multi-Platform Pack",
    content: `I want to share the following content on social media. Read it carefully and generate ready-to-post versions for each platform:

[PASTE YOUR ARTICLE / VIDEO LINK / POST / TRANSCRIPT HERE]

---

**🐦 X (Twitter) — Single Tweet** (max 280 chars, include a hook + link placeholder)

**🧵 X (Twitter) — Thread** (5–7 tweets, numbered, each with one key insight, end with CTA)

**💼 LinkedIn Post** (150–200 words, professional tone, open with an observation, end with a question to spark discussion, 3–5 hashtags)

**📸 Instagram Caption** (engaging, conversational, line breaks for readability, 10 relevant hashtags at the end)

**💬 WhatsApp / Telegram Message** (2–3 sentences, casual tone, perfect for forwarding to a friend or group)

**📘 Facebook Post** (friendly, conversational, includes a question to invite comments)

---
For each version: match the tone and culture of that platform. Do not use the same text across platforms.`,
    category: "social",
    isBuiltin: true
  },
  {
    id: 'up-share-thread',
    title: "🧵 Twitter/X Thread Writer",
    content: `Turn the following content into a high-engagement Twitter/X thread.

[PASTE ARTICLE / VIDEO TRANSCRIPT / CONTENT HERE]

**Thread Structure:**

🪝 **Tweet 1 — The Hook** (make people stop scrolling — bold claim, surprising fact, or powerful question. Max 240 chars)

📌 **Tweets 2–9** — One key insight per tweet:
- Start each with a number: "2/"
- One idea only per tweet
- Use simple, direct language
- Add a relevant emoji at the start
- Include a specific stat, quote, or example where possible

🎯 **Final Tweet** — CTA:
- Summarize the #1 takeaway in one sentence
- Ask a question to invite replies
- "Follow for more like this" or "Retweet if this resonated"

**After the thread**, suggest: the best time to post, 3 accounts to tag for amplification, and 5 hashtags.`,
    category: "social",
    isBuiltin: true
  },
  {
    id: 'up-share-linkedin',
    title: "💼 LinkedIn Post Writer",
    content: `Transform the following content into a high-performing LinkedIn post.

[PASTE YOUR ARTICLE / VIDEO / CONTENT HERE]

**Post Requirements:**

**Opening Line** (first 2 lines must be so compelling that people click "See more" — use a personal observation, counterintuitive statement, or striking statistic)

**Body** (150–250 words):
- Extract 3 professional insights with brief context
- Write in first person, as if sharing a personal realization
- Use short paragraphs (1–3 lines each) for mobile readability
- Include one specific number, stat, or concrete example

**Closing** (2–3 lines):
- Thought-provoking question to invite comments
- Subtle call-to-action (save this, share with someone who needs it)

**Hashtags:** 5–8 relevant professional hashtags

**Bonus:** Suggest 2–3 people or companies to tag who would likely engage with this post.`,
    category: "social",
    isBuiltin: true
  },
  {
    id: 'up-share-instagram-story',
    title: "📱 Instagram Story Script",
    content: `Break the following content into an engaging Instagram Story sequence (5–8 slides).

[PASTE YOUR ARTICLE / VIDEO / CONTENT HERE]

For each slide provide:
- **Slide #** + **Purpose**
- **Main Text** (short, punchy — max 15 words on screen)
- **Visual Suggestion** (background color/image idea, or text overlay style)
- **Interactive Element** (poll, question sticker, quiz, or slider where relevant)
- **Emoji Accent** suggestion

**Story Structure:**
- Slide 1: Hook — a bold question or surprising statement that makes them tap forward
- Slides 2–6: One key point per slide (treat each slide as a mini-revelation)
- Slide 7–8: Takeaway + CTA (save this, link in bio, DM me "word" for the resource, swipe up)

**After the script**, suggest:
- Best Story highlight cover title and color
- Optimal posting time for this topic`,
    category: "social",
    isBuiltin: true
  },
  {
    id: 'up-share-newsletter',
    title: "📧 Newsletter Snippet",
    content: `Transform the following content into a compelling newsletter section ready to send to subscribers.

[PASTE YOUR ARTICLE / VIDEO / CONTENT HERE]

**Format:**

**📌 Section Headline** (curiosity-driven, under 10 words)

**Intro Hook** (1–2 sentences that make the reader want to keep reading)

**The Meat** (3–5 short paragraphs covering the key insights — write in a warm, direct, "friend who knows things" tone. No jargon. No fluff.)

**Key Takeaway Box:**
> 💡 *The one thing to remember: [single sentence]*

**Why This Matters To You** (1 short paragraph — connect the content to the reader's life or work)

**Read More / Watch This** call-to-action line (with placeholder for link)

---
**Tone:** Conversational but credible. Like a smart friend sharing something genuinely useful, not a corporate newsletter.
**Length:** 200–300 words total.`,
    category: "social",
    isBuiltin: true
  },
  {
    id: 'up-share-presentation',
    title: "🗣️ Presentation Outline",
    content: `Convert the following content into a structured presentation outline.

[PASTE YOUR ARTICLE / VIDEO / CONTENT HERE]

**Presentation Structure:**

**🎯 Slide 1 — Title Slide**
- Suggested title (compelling, not generic)
- Subtitle / one-line summary
- Speaker name placeholder

**📖 Slide 2 — The Big Question / Problem**
- What problem or question does this content address?
- Why should the audience care? (the "so what")

**📊 Slides 3–8 — Main Content Sections**
For each slide:
- Slide title
- 3 bullet points (max 7 words each)
- Speaker note (what to say out loud — 2–3 sentences)
- Suggested visual (chart, image, icon idea)

**💡 Slide 9 — Key Takeaways**
- 3 memorable one-liners the audience should leave with

**🎬 Slide 10 — Call to Action / Next Steps**
- What should the audience do after this presentation?
- Discussion question for Q&A

**After the outline**, suggest: ideal presentation length, best audience for this content, and 2 slides that could be cut if time is short.`,
    category: "general",
    isBuiltin: true
  }
];

/**
 * Storage keys for chain-related data
 */
const STORAGE_KEYS = {
  CHAIN_TEMPLATES: 'chain_templates',
  CHAIN_EXECUTIONS: 'chain_executions',
  ACTIVE_CHAIN: 'active_chain_execution'
};

/**
 * Default chain templates for prompt chaining feature
 */
const DEFAULT_CHAIN_TEMPLATES = [
  {
    id: 'default-code-review',
    name: 'Code Review Pipeline',
    description: 'DeepSeek analyzes, Claude improves',
    steps: [
      {
        id: 'step-1',
        order: 0,
        model: 'deepseek-v3.2',
        promptTemplate: 'გამოიკვლიე ეს კოდი და იპოვე პრობლემები:\n\n{input}',
        systemPrompt: 'შენ ხარ კოდის ანალიტიკოსი...',
        webSearch: false,
        includePreviousOutput: false
      },
      {
        id: 'step-2',
        order: 1,
        model: 'claude-sonnet-45',
        promptTemplate: 'წინა ანალიზის საფუძველზე, გააუმჯობესე კოდი:\n\n{previous_output}',
        systemPrompt: 'შენ ხარ კოდის ინჟინერი...',
        webSearch: false,
        includePreviousOutput: true
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'default-research-summarize',
    name: 'Research & Summarize',
    description: 'Web search model researches, concise model summarizes',
    steps: [
      {
        id: 'step-1',
        order: 0,
        model: 'llama-3.3-70b',
        promptTemplate: 'Research this topic thoroughly:\n\n{input}',
        systemPrompt: 'You are a research assistant...',
        webSearch: true,
        includePreviousOutput: false
      },
      {
        id: 'step-2',
        order: 1,
        model: 'gpt-4o-mini',
        promptTemplate: 'Summarize the following research concisely:\n\n{previous_output}',
        systemPrompt: 'You are a concise summarizer...',
        webSearch: false,
        includePreviousOutput: true
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'default-creative-refine',
    name: 'Creative & Refine',
    description: 'Creative writer followed by editor refinement',
    steps: [
      {
        id: 'step-1',
        order: 0,
        model: 'llama-3.3-70b',
        promptTemplate: 'Write a creative piece about the following topic:\n\n{input}',
        systemPrompt: 'You are a creative writer. Be imaginative and expressive.',
        webSearch: false,
        includePreviousOutput: false
      },
      {
        id: 'step-2',
        order: 1,
        model: 'claude-sonnet-45',
        promptTemplate: 'Refine and polish the following creative piece, improving clarity and style while maintaining the original voice:\n\n{previous_output}',
        systemPrompt: 'You are an expert editor. Improve clarity, fix errors, and enhance style.',
        webSearch: false,
        includePreviousOutput: true
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'default-translate-localize',
    name: 'Translate & Localize',
    description: 'Translate text and adapt for local context',
    steps: [
      {
        id: 'step-1',
        order: 0,
        model: 'gpt-4o-mini',
        promptTemplate: 'Translate the following text to English:\n\n{input}',
        systemPrompt: 'You are a professional translator. Provide accurate translation.',
        webSearch: false,
        includePreviousOutput: false
      },
      {
        id: 'step-2',
        order: 1,
        model: 'claude-sonnet-45',
        promptTemplate: 'Localize the following translation to make it sound natural for native English speakers:\n\n{previous_output}',
        systemPrompt: 'You are a localization expert. Adapt text to sound natural and culturally appropriate.',
        webSearch: false,
        includePreviousOutput: true
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'default-analyze-report',
    name: 'Analyze & Report',
    description: 'Deep analysis followed by executive summary',
    steps: [
      {
        id: 'step-1',
        order: 0,
        model: 'deepseek-v3.2',
        promptTemplate: 'Perform a detailed analysis of the following:\n\n{input}',
        systemPrompt: 'You are an analytical expert. Provide thorough, detailed analysis with specific findings.',
        webSearch: true,
        includePreviousOutput: false
      },
      {
        id: 'step-2',
        order: 1,
        model: 'gpt-4o-mini',
        promptTemplate: 'Create an executive summary of the following analysis:\n\n{previous_output}',
        systemPrompt: 'You are a business communications expert. Create concise executive summaries.',
        webSearch: false,
        includePreviousOutput: true
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

const Storage = {
  // --- CORE STORAGE WRAPPERS ---
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  },

  async set(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (error) {
      // Handle quota exceeded error
      if (error.message && error.message.includes('QUOTA_BYTES')) {
        console.error('Storage quota exceeded:', error.message);
        // Try to clear old conversations to free up space
        await this.handleQuotaExceeded(key);
        // Retry once after cleanup
        try {
          await chrome.storage.local.set({ [key]: value });
        } catch (retryError) {
          console.error('Storage retry failed:', retryError);
          throw new Error('Storage quota exceeded. Please clear some conversations or data.');
        }
      } else {
        throw error;
      }
    }
  },

  /**
   * Handle storage quota exceeded by cleaning up old data
   * @param {string} key - The key that failed to save
   */
  async handleQuotaExceeded(key) {
    console.warn('Attempting to free up storage space...');
    
    // If it's the conversations key, try to trim old conversations
    if (key === 'conversations') {
      try {
        const conversations = await this.get('conversations') || {};
        const convArray = Object.values(conversations);
        
        if (convArray.length > 10) {
          // Sort by updatedAt and keep only the 10 most recent
          convArray.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const trimmed = {};
          convArray.slice(0, 10).forEach(c => {
            trimmed[c.id] = c;
          });
          
          console.log(`Trimmed conversations from ${convArray.length} to 10`);
          await chrome.storage.local.set({ conversations: trimmed });
          return;
        }
      } catch (e) {
        console.error('Failed to trim conversations:', e);
      }
    }
    
    // Try to clear chain executions (can be large)
    try {
      await chrome.storage.local.remove('chain_executions');
      console.log('Cleared chain executions to free space');
    } catch (e) {
      console.error('Failed to clear chain executions:', e);
    }
  },

  // --- API KEY ---
  async getApiKey() {
    return await this.get('api_key') || null;
  },

  async setApiKey(key) {
    await this.set('api_key', key);
  },

  async removeApiKey() {
    await chrome.storage.local.remove('api_key');
  },

  // --- SETTINGS ---
  async getSettings() {
    const defaultSettings = {
      theme: 'system',
      defaultModel: 'zai-org-glm-5',
      responseFormat: 'normal',
      defaultTTSVoice: 'af_sky'
    };
    const settings = await this.get('settings');
    return { ...defaultSettings, ...settings };
  },

  async updateSettings(partial) {
    const current = await this.getSettings();
    await this.set('settings', { ...current, ...partial });
  },

  // --- MODELS CACHE ---
  async getCachedModels() {
    return await this.get('models_cache') || null;
  },

  async setCachedModels(models) {
    await this.set('models_cache', {
      data: models,
      timestamp: Date.now()
    });
  },

  // --- CONVERSATIONS ---
  async getAllConversations() {
    const conversations = await this.get('conversations') || {};
    return Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async getConversation(id) {
    const conversations = await this.get('conversations') || {};
    return conversations[id] || null;
  },

  async saveConversation(conv) {
    const conversations = await this.get('conversations') || {};
    conversations[conv.id] = {
      ...conv,
      updatedAt: Date.now()
    };
    await this.set('conversations', conversations);
  },

  async deleteConversation(id) {
    const conversations = await this.get('conversations') || {};
    delete conversations[id];
    await this.set('conversations', conversations);
  },

  async deleteAllConversations() {
    await this.set('conversations', {});
    await this.set('pinned_conversations', []);
    await this.set('pinned_messages', []);
  },

  async searchConversations(query) {
    const all = await this.getAllConversations();
    const q = query.toLowerCase();
    return all.filter(c => 
      c.title.toLowerCase().includes(q) || 
      c.messages.some(m => m.content.toLowerCase().includes(q))
    );
  },

  // --- FOLDERS ---
  async getFolders() {
    return await this.get('folders') || [];
  },

  async saveFolder(folder) {
    const folders = await this.getFolders();
    const index = folders.findIndex(f => f.id === folder.id);
    if (index > -1) folders[index] = folder;
    else folders.push(folder);
    await this.set('folders', folders);
  },

  async deleteFolder(id) {
    const folders = await this.getFolders();
    await this.set('folders', folders.filter(f => f.id !== id));
  },

  // --- PROMPT CATEGORIES ---
  async getCategories() {
    const cats = await this.get('prompt_categories');
    if (!cats) {
      const defaults = [
        { id: 'youtube',   label: 'YouTube',  emoji: '📺', isBuiltin: true },
        { id: 'social',    label: 'Social',   emoji: '📱', isBuiltin: true },
        { id: 'ecommerce', label: 'Shop',     emoji: '🛒', isBuiltin: true },
        { id: 'writing',   label: 'Write',    emoji: '✍️', isBuiltin: true },
        { id: 'general',   label: 'General',  emoji: '🗂️', isBuiltin: true },
        { id: 'custom',    label: 'Custom',   emoji: '⭐', isBuiltin: true },
      ];
      await this.set('prompt_categories', defaults);
      return defaults;
    }
    return cats;
  },

  async saveCategories(cats) {
    await this.set('prompt_categories', cats);
  },

  // --- USER PROMPTS ---
  async getPrompts() {
    const prompts = await this.get('user_prompts');
    if (!prompts) {
      await this.set('user_prompts', DEFAULT_PROMPTS);
      return DEFAULT_PROMPTS;
    }
    return prompts;
  },

  async savePrompts(prompts) {
    await this.set('user_prompts', prompts);
  },

  // --- SYSTEM PROMPTS ---
  async getSystemPrompts() {
    const prompts = await this.get('system_prompts');
    if (!prompts) {
      await this.set('system_prompts', DEFAULT_SYSTEM_PROMPTS);
      return DEFAULT_SYSTEM_PROMPTS;
    }
    return prompts;
  },

  async saveSystemPrompts(prompts) {
    await this.set('system_prompts', prompts);
  },

  // --- PINNED ---
  async getPinnedConversations() {
    return await this.get('pinned_conversations') || [];
  },

  async togglePinConversation(id) {
    const pinned = await this.getPinnedConversations();
    const index = pinned.indexOf(id);
    if (index > -1) pinned.splice(index, 1);
    else pinned.push(id);
    await this.set('pinned_conversations', pinned);
  },

  async getPinnedMessages() {
    return await this.get('pinned_messages') || [];
  },

  async togglePinMessage(conversationId, messageIndex) {
    const pinned = await this.getPinnedMessages();
    const index = pinned.findIndex(p => p.conversationId === conversationId && p.messageIndex === messageIndex);
    if (index > -1) pinned.splice(index, 1);
    else pinned.push({ conversationId, messageIndex });
    await this.set('pinned_messages', pinned);
  },

  // --- PAGE CONTEXT TOGGLE ---
  async getPageContextEnabled() {
    return await this.get('pageContextEnabled') ?? true;
  },

  async setPageContextEnabled(enabled) {
    await this.set('pageContextEnabled', enabled);
  },

  // --- EXPORT ---
  async exportConversation(id, format = 'md') {
    const conv = await this.getConversation(id);
    if (!conv) return null;

    let output = `# ${conv.title}\n\n`;
    for (const msg of conv.messages) {
      const role = msg.role === 'user' ? 'User' : (msg.modelName || 'Assistant');
      output += `### ${role}\n${msg.content}\n\n`;
      if (msg.thinking) {
        output += `> Thinking: ${msg.thinking}\n\n`;
      }
    }

    if (format === 'txt') {
      return output.replace(/#[#]* /g, '');
    }
    return output;
  },

  // --- EXPORT ALL DATA ---
  async exportAllData() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: await this.getSettings(),
      conversations: await this.get('conversations') || {},
      folders: await this.getFolders(),
      userPrompts: await this.getPrompts(),
      systemPrompts: await this.getSystemPrompts(),
      pinnedConversations: await this.getPinnedConversations(),
      pinnedMessages: await this.getPinnedMessages()
    };
    return data;
  },

  // --- IMPORT ALL DATA ---
  async importAllData(data) {
    if (!data || data.version !== 1) {
      throw new Error('Invalid backup file format');
    }

    // Import each data type
    if (data.settings) {
      await this.set('settings', data.settings);
    }
    if (data.conversations) {
      await this.set('conversations', data.conversations);
    }
    if (data.folders) {
      await this.set('folders', data.folders);
    }
    if (data.userPrompts) {
      await this.set('user_prompts', data.userPrompts);
    }
    if (data.systemPrompts) {
      await this.set('system_prompts', data.systemPrompts);
    }
    if (data.pinnedConversations) {
      await this.set('pinned_conversations', data.pinnedConversations);
    }
    if (data.pinnedMessages) {
      await this.set('pinned_messages', data.pinnedMessages);
    }

    return true;
  },

  // --- IMPORT SHARED CONVERSATION ---
  async importSharedConversation(shareString) {
    try {
      // Parse the share string format
      // Expected format: [VeniceAI Share]\n\n---DATA---\n{BASE64_DATA}\n\n---END---

      const dataMatch = shareString.match(/---DATA---\n([\s\S]*?)\n---END---/);
      if (!dataMatch || !dataMatch[1]) {
        throw new Error('Invalid share format');
      }

      const base64Data = dataMatch[1].trim();
      
      // Decode base64
      const jsonString = decodeURIComponent(escape(atob(base64Data)));
      const shareData = JSON.parse(jsonString);

      // Validate share data
      if (!shareData || shareData.type !== 'venice-ai-conversation' || shareData.version !== 1) {
        throw new Error('Invalid or incompatible share data');
      }

      // Create new conversation from shared data
      const newConv = {
        id: crypto.randomUUID(),
        title: shareData.title || 'Imported Conversation',
        messages: shareData.messages || [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Save to storage
      await this.saveConversation(newConv);

      return {
        success: true,
        conversation: newConv
      };
    } catch (err) {
      console.error('Import shared conversation error:', err);
      throw new Error('Failed to import: ' + err.message);
    }
  },

  // ========================================
  // CHAIN TEMPLATE METHODS
  // ========================================

  /**
   * Retrieve all chain templates
   * @returns {Promise<Array>} Array of chain templates
   */
  async getChainTemplates() {
    const templates = await this.get(STORAGE_KEYS.CHAIN_TEMPLATES);
    if (!templates) {
      await this.set(STORAGE_KEYS.CHAIN_TEMPLATES, DEFAULT_CHAIN_TEMPLATES);
      return DEFAULT_CHAIN_TEMPLATES;
    }
    return templates;
  },

  /**
   * Save a chain template (create or update)
   * @param {Object} template - The chain template to save
   * @param {string} template.id - Unique identifier for the template
   * @param {string} template.name - Display name of the template
   * @param {string} template.description - Description of what the chain does
   * @param {Array} template.steps - Array of chain step configurations
   * @returns {Promise<void>}
   */
  async saveChainTemplate(template) {
    const templates = await this.getChainTemplates();
    const index = templates.findIndex(t => t.id === template.id);
    const updatedTemplate = {
      ...template,
      updatedAt: Date.now()
    };
    
    if (index > -1) {
      templates[index] = updatedTemplate;
    } else {
      updatedTemplate.createdAt = Date.now();
      templates.push(updatedTemplate);
    }
    
    await this.set(STORAGE_KEYS.CHAIN_TEMPLATES, templates);
  },

  /**
   * Delete a chain template by ID
   * @param {string} id - The ID of the template to delete
   * @returns {Promise<void>}
   */
  async deleteChainTemplate(id) {
    const templates = await this.getChainTemplates();
    const filtered = templates.filter(t => t.id !== id);
    await this.set(STORAGE_KEYS.CHAIN_TEMPLATES, filtered);
  },

  /**
   * Get a single chain template by ID
   * @param {string} id - The ID of the template to retrieve
   * @returns {Promise<Object|null>} The chain template or null if not found
   */
  async getChainTemplate(id) {
    const templates = await this.getChainTemplates();
    return templates.find(t => t.id === id) || null;
  },

  // ========================================
  // CHAIN EXECUTION METHODS
  // ========================================

  /**
   * Retrieve all chain executions
   * @returns {Promise<Array>} Array of chain executions sorted by updatedAt descending
   */
  async getChainExecutions() {
    const executions = await this.get(STORAGE_KEYS.CHAIN_EXECUTIONS) || {};
    return Object.values(executions).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /**
   * Save a chain execution (create or update)
   * @param {Object} execution - The chain execution to save
   * @param {string} execution.id - Unique identifier for the execution
   * @param {string} execution.templateId - ID of the template used
   * @param {string} execution.status - Current status (running, completed, failed, paused)
   * @param {Array} execution.stepResults - Results from each step
   * @returns {Promise<void>}
   */
  async saveChainExecution(execution) {
    const executions = await this.get(STORAGE_KEYS.CHAIN_EXECUTIONS) || {};
    executions[execution.id] = {
      ...execution,
      updatedAt: Date.now()
    };
    await this.set(STORAGE_KEYS.CHAIN_EXECUTIONS, executions);
  },

  /**
   * Get a single chain execution by ID
   * @param {string} id - The ID of the execution to retrieve
   * @returns {Promise<Object|null>} The chain execution or null if not found
   */
  async getChainExecution(id) {
    const executions = await this.get(STORAGE_KEYS.CHAIN_EXECUTIONS) || {};
    return executions[id] || null;
  },

  /**
   * Get the currently active chain execution
   * @returns {Promise<Object|null>} The active chain execution or null if none
   */
  async getActiveChainExecution() {
    const activeId = await this.get(STORAGE_KEYS.ACTIVE_CHAIN);
    if (!activeId) return null;
    return await this.getChainExecution(activeId);
  },

  /**
   * Set the active chain execution
   * @param {string} executionId - The ID of the execution to set as active
   * @returns {Promise<void>}
   */
  async setActiveChainExecution(executionId) {
    await this.set(STORAGE_KEYS.ACTIVE_CHAIN, executionId);
  },

  /**
   * Clear the active chain execution
   * @returns {Promise<void>}
   */
  async clearActiveChainExecution() {
    await chrome.storage.local.remove(STORAGE_KEYS.ACTIVE_CHAIN);
  }
};

// Make available globally
window.storage = Storage;
