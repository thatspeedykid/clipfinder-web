// src/app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 45

// ─── Tone prompts ─────────────────────────────────────────────────────────────
const TONE_PROMPTS: Record<string, string> = {
  drama: `TONE: Drama/Tea Account (2026)
You are a streaming drama account with 500k followers. Insider gossip energy.
- Lead with the most unhinged moment — no warmup
- Write like you're telling your mutuals what just happened
- 1-2 emojis MAX, placed for impact not decoration
- Make the person sound iconic, not evil`,

  tea: `TONE: Calm Tea/Soft Expose (2026)
Devastatingly factual. Unbothered delivery.
- Open with a cold fact, zero emotion
- "So apparently" / "Turns out" / "Friendly reminder that" energy
- Build like a court case — evidence first, reaction second
- 1 emoji max. End on unanswered question or cliffhanger`,

  breaking: `TONE: Breaking News (2026)
Journalist covering a live stream beat. Factual but urgent.
- Start BREAKING: or 🚨 BREAKING:
- Who + what + when in the first sentence
- Quote exact words from transcript only (no made-up quotes)
- No speculation — let the facts be wild`,

  hype: `TONE: Hype/Celebration (2026)
Make them feel they MISSED something legendary.
- ALL CAPS for 1-2 key words max
- Exclamation energy but not cringe — sports commentator
- "Nobody was ready" / "Clip of the year" energy
- Focus on the reaction, the moment, the chaos`,

  exaggerate: `TONE: Villain Arc / Exaggerate (2026)
Dramatize real events cinematically. Subject becomes a movie character.
- 4-5 SHORT punchy lines that build like story beats
- Each line max 12 words. 1 emoji at END of each line (different each)
- Last line = the wildest escalation
- Stay factual — just frame it like a film trailer`,
}

// ─── Platform formats ─────────────────────────────────────────────────────────
const PLATFORM_FORMATS: Record<string, string> = {
  twitter: `PLATFORM: Twitter/X
HARD LIMIT: 280 characters total including hashtags. Count every character.
- Hook in first 8 words (all that shows before "more")
- One punchy paragraph — no threads
- 2-4 hashtags at end on same line: #Kick #Exposed #[PersonName]
- If over 280 chars, cut words not hashtags`,

  instagram: `PLATFORM: Instagram
Up to 400 words. First 125 chars show before "more" — hook must be there.
- Line 1: Hook (under 125 chars, no hashtag)
- Lines 2-4: Full story with detail and emotion, short paragraphs
- Line 5: CTA — "Save this" / "Tag someone" / "Follow for more"
- Blank line then 8-15 hashtags: #[Name] #Kick #Drama #StreamClips + niche tags`,

  tiktok: `PLATFORM: TikTok
HARD LIMIT: 150 characters total. Punchy. Hook word FIRST.
- First word: "POV" / "Wait" / "No way" / "THEY SAID" / "Bro"
- 3-5 hashtags after: always include #fyp or #foryou
- Fragments hit harder than sentences
- Think: what makes someone stop mid-scroll`,

  youtube: `PLATFORM: YouTube Shorts
Output EXACTLY this format — two lines, nothing else:
TITLE: [title here]
DESC: [description here]

Title (60 chars max): front-load shocking word or name, reaction format "He Said WHAT?!" / "Nobody Expected This", 1-2 words ALL CAPS
Description (200 chars max): what happened in plain words for SEO, end with #Shorts #[Name] #Viral #StreamMoments`,
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
function buildPrompt(transcript: string, tone: string, platform: string, streamerName: string, clipTitle: string, singlePost: boolean): string {
  const nameNote = streamerName
    ? `Streamer name: "${streamerName}" — use this EXACT name. Never use IDs, hex strings, or placeholders.`
    : `No name available — say "the streamer" or pull a name from the transcript if mentioned.`

  const header = `You are a viral social media writer for a streaming clip channel.
${nameNote}
${clipTitle ? `Clip context: ${clipTitle}` : ''}

TRANSCRIPT:
${transcript.slice(0, 2000)}

${TONE_PROMPTS[tone] ?? TONE_PROMPTS.drama}

${PLATFORM_FORMATS[platform] ?? PLATFORM_FORMATS.twitter}`

  if (singlePost) {
    return `${header}

Write ONE single perfect post for ${platform.toUpperCase()}. Apply the tone and format exactly.
Only use real quotes from the transcript. Use the streamer's actual name.
Output ONLY the post — no labels, no "here is your post", no preamble.`
  }

  return `${header}

Write 3 posts in the SAME tone from 3 different angles:

OPTION 1 — HOT TAKE: Punchy opinion. Lead with the most shocking element.
OPTION 2 — PULL QUOTE: Open with a real quote from the transcript in "quotes", then react.
OPTION 3 — ANNOUNCEMENT: Breaking news frame. Create urgency. Make them feel they missed it.

RULES:
- Use "${streamerName || 'the streamer'}" by name — never IDs or random strings
- Only quote things actually said in the transcript
- Each option must feel completely different

OUTPUT — follow exactly, no intro:
OPTION 1
[post]

OPTION 2
[post]

OPTION 3
[post]`
}

// ─── Individual AI callers ────────────────────────────────────────────────────
async function callGemini(prompt: string, fast: boolean, keyOverride?: string): Promise<string> {
  const key = keyOverride ?? process.env.GEMINI_API_KEY
  if (!key) throw new Error('no gemini key')
  // Use flash for fast mode (all-socials), pro for single detailed generations
  const model = fast ? 'gemini-2.0-flash' : 'gemini-2.0-flash'
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: fast ? 600 : 1500 }
      }),
      signal: AbortSignal.timeout(fast ? 12000 : 20000),
    }
  )
  const d = await res.json()
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!text.trim()) throw new Error('gemini empty')
  return text
}

async function callGroq(prompt: string, fast: boolean, model?: string, keyOverride?: string): Promise<string> {
  const key = keyOverride ?? process.env.GROQ_API_KEY
  if (!key) throw new Error('no groq key')
  // Fast: 8b-instant is Groq's fastest + cheapest, good enough for social posts
  const m = model ?? (fast ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile')
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: m,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: fast ? 600 : 1500,
      temperature: 0.85,
    }),
    signal: AbortSignal.timeout(fast ? 10000 : 18000),
  })
  const d = await res.json()
  const text = d.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('groq empty')
  return text
}

// Pick the right API keys based on user tier
// Free tier → free keys (rate-limited but fine for 3 clips/day users)
// Pro/Agency → paid keys (higher rate limits)
function getKeys(tier: string): { gemini: string | undefined; groq: string | undefined } {
  const isPaid = tier === 'pro' || tier === 'agency'
  return {
    gemini: (isPaid ? process.env.GEMINI_API_KEY_PAID : undefined) ?? process.env.GEMINI_API_KEY,
    groq:   (isPaid ? process.env.GROQ_API_KEY_PAID   : undefined) ?? process.env.GROQ_API_KEY,
  }
}

// Race all available AIs — first non-empty response wins
async function callAI(prompt: string, fast = false, tier = 'free'): Promise<string> {
  const { gemini, groq } = getKeys(tier)
  const calls: Promise<string>[] = []
  if (gemini) calls.push(callGemini(prompt, fast, gemini))
  if (groq)   calls.push(callGroq(prompt, fast, undefined, groq))
  if (calls.length === 0) throw new Error('No AI keys configured')
  try {
    return await Promise.any(calls)
  } catch {
    throw new Error('All AI calls failed or returned empty')
  }
}

// For All Socials: split 4 platforms across available AIs to distribute load
// Twitter+TikTok → Groq (fast, short output), Instagram+YouTube → Gemini (better long-form)
async function callAIForPlatform(prompt: string, platform: string, tier = 'free'): Promise<string> {
  const { gemini, groq } = getKeys(tier)

  if (gemini && groq) {
    const useGroq = platform === 'twitter' || platform === 'tiktok'
    const primary  = useGroq ? callGroq(prompt, true, undefined, groq) : callGemini(prompt, true, gemini)
    const fallback = useGroq ? callGemini(prompt, true, gemini)        : callGroq(prompt, true, undefined, groq)
    try { return await primary } catch { return await fallback }
  }

  return callAI(prompt, true, tier)
}

// ─── Parse 3 options ──────────────────────────────────────────────────────────
function parseOptions(raw: string): string[] {
  const blocks = raw.split(/\bOPTION\s+[123]\b/i).map(s => s.trim()).filter(Boolean)
  const options = blocks.slice(0, 3).map(b => b.replace(/^[-–—\s]+/, '').trim())
  while (options.length < 3) options.push(options[0] ?? raw.trim())
  return options.slice(0, 3)
}

// ─── Streamer name extraction ─────────────────────────────────────────────────
function extractStreamerFromUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname.includes('kick.com')) {
      for (const part of u.pathname.split('/').filter(Boolean)) {
        if (part === 'clips' || part.startsWith('clip_')) break
        if (/^[a-f0-9]{8,}$/.test(part)) continue
        return part
      }
    }
    if (u.hostname.includes('twitch.tv')) return u.pathname.split('/').filter(Boolean)[0] ?? ''
    if (u.hostname.includes('twitter.com') || u.hostname.includes('x.com'))
      return u.pathname.split('/').filter(Boolean)[0]?.replace('@', '') ?? ''
    if (u.hostname.includes('tiktok.com'))
      return u.pathname.split('/').filter(Boolean)[0]?.replace('@', '') ?? ''
  } catch {}
  return ''
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { clipId, platform = 'twitter', tone = 'drama', streamerName: bodyStreamer, platforms, customTitle: bodyCustomTitle } = body

    // Get user tier to decide which API keys to use
    const { data: profile } = await supabase.from('profiles').select('tier, is_admin').eq('id', user.id).single()
    const tier = profile?.is_admin ? 'agency' : (profile?.tier ?? 'free')

    const { data: clip } = await supabase.from('clips').select('id, title, summary, job_id').eq('id', clipId).single()
    let transcript = clip?.summary ?? ''
    let sourceUrl  = ''
    let videoTitle = clip?.title ?? ''
    let dbStreamer = ''

    if (clip?.job_id) {
      const { data: job } = await supabase.from('jobs').select('source_url, video_title, transcript, streamer_name').eq('id', clip.job_id).single()
      sourceUrl = job?.source_url ?? ''
      dbStreamer = job?.streamer_name ?? ''
      if (job?.transcript) transcript = job.transcript
      if (job?.video_title) videoTitle = job.video_title
    }

    // Name priority: body → DB → URL. Never use a hex ID.
    const rawName = bodyStreamer || dbStreamer || extractStreamerFromUrl(sourceUrl)
    const streamerName = rawName && !/^[a-f0-9]{8,}$/.test(rawName) ? rawName : ''
    if (bodyCustomTitle?.trim()) videoTitle = bodyCustomTitle.trim()

    const targetPlatforms: string[] = platforms ?? [platform]
    const isAllSocials = targetPlatforms.length > 1
    const results: Record<string, { options: string[]; hook_line: string }> = {}

    if (isAllSocials) {
      await Promise.all(targetPlatforms.map(async (p) => {
        const prompt = buildPrompt(transcript || videoTitle, tone, p, streamerName, videoTitle, true)
        const raw = await callAIForPlatform(prompt, p, tier)
        console.log(`[generate:all] ${p} tier=${tier} len=${raw.length}`)
        results[p] = { options: [raw.trim()], hook_line: '' }
      }))
    } else {
      const prompt = buildPrompt(transcript || videoTitle, tone, platform, streamerName, videoTitle, false)
      const raw = await callAI(prompt, false, tier)
      console.log(`[generate:single] ${platform} tier=${tier} len=${raw.length} name="${streamerName}"`)
      results[platform] = { options: parseOptions(raw), hook_line: '' }
    }

    if (targetPlatforms.length === 1) {
      return NextResponse.json({ ...results[targetPlatforms[0]], streamer: streamerName })
    }
    return NextResponse.json({ platforms: results, streamer: streamerName })

  } catch (err) {
    console.error('[generate] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
