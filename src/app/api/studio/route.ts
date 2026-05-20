// src/app/api/studio/route.ts
// Standalone Post Studio API
// Accepts: URL (extracts transcript), raw transcript text, or just a prompt/description
// No video download — subtitle extraction only, falls back to audio-only for Groq Whisper

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 60

const TONE_PROMPTS: Record<string, string> = {
  drama:      '🔥 DRAMA ACCOUNT — Tea spiller energy. Shocking, pointed, like a real streaming drama page. Use emojis strategically. Pull receipts.',
  tea:        '☕ TEA MODE — Calm but devastating. Matter-of-fact delivery that makes the drama hit harder. "So apparently..." energy. Understated.',
  breaking:   '📰 BREAKING NEWS — Urgent, journalistic. "BREAKING:" opener. Treat it like actual news. Serious tone, facts first.',
  hype:       '💥 HYPE MODE — Celebrate the moment. Positive energy, get people excited to watch. Use energy words. Make it feel unmissable.',
  exaggerate: `🤯 EXAGGERATE MODE — Write a dramatic multi-line story that builds line by line. Use this EXACT format:

🚨 [SHOCKING HEADLINE IN CAPS — name the person and the situation] 😳
[Setup line — what the secret or situation was] 👀
[Escalation — what triggered it or made it worse] 💔
[Twist — how things shifted or got more chaotic] 💸🔥
[Punchline — how wild it ended up] ⚡

Rules: Each line max 12 words. 1-2 emojis at END of each line. Build tension line by line.
Stay factual to the transcript — just massively dramatize real events.
All 3 options follow this same format but cover DIFFERENT angles of the same story.
Hashtags on a separate final line.`,
}

const PLATFORM_LIMITS: Record<string, number> = {
  twitter: 280, instagram: 2200, tiktok: 2200, youtube: 500,
}

const STUDIO_LIMITS: Record<string, number> = {
  free: 3, pro: 25, agency: 100,
}

// ── Quota check for studio ────────────────────────────────────────────────────
async function checkStudioQuota(supabase: ReturnType<typeof createAdminClient>, userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, is_admin, studio_today, studio_reset_at')
    .eq('id', userId)
    .single()

  if (!profile) return { allowed: false, message: 'Profile not found' }
  if (profile.is_admin) return { allowed: true, used: 0, limit: 9999 }

  const limit = STUDIO_LIMITS[profile.tier as keyof typeof STUDIO_LIMITS] ?? STUDIO_LIMITS.free

  // Reset if 24h passed
  const resetAt = new Date(profile.studio_reset_at)
  let used = profile.studio_today
  if (Date.now() - resetAt.getTime() > 86400000) {
    await supabase.from('profiles').update({ studio_today: 0, studio_reset_at: new Date().toISOString() }).eq('id', userId)
    used = 0
  }

  return {
    allowed: used < limit,
    used,
    limit,
    tier: profile.tier,
    message: used >= limit ? `Daily studio limit reached (${used}/${limit}). ${profile.tier === 'free' ? 'Upgrade to Pro for 25/day.' : 'Resets in 24 hours.'}` : undefined,
  }
}

async function incrementStudioQuota(supabase: ReturnType<typeof createAdminClient>, userId: string) {
  const { data } = await supabase.from('profiles').select('studio_today').eq('id', userId).single()
  await supabase.from('profiles').update({ studio_today: (data?.studio_today ?? 0) + 1 }).eq('id', userId)
}

// ── Build prompt from context ─────────────────────────────────────────────────
function buildStudioPrompt(context: string, tone: string, platform: string): string {
  const limit = PLATFORM_LIMITS[platform] ?? 280
  const platformNote = {
    twitter:   `Twitter/X. Max ${limit} chars per option.`,
    instagram: `Instagram caption. Hook in first line. 8-12 hashtags on last line.`,
    tiktok:    `TikTok caption. Punchy, lowercase fine. 3-5 hashtags. Max 150 chars.`,
    youtube:   `YouTube Shorts description. First line is SEO hook. Call to action included.`,
  }[platform] ?? `Max ${limit} chars per option.`

  return `You are a social media writer for @MarsScumbags, a streaming drama/clip channel.

== CONTENT / CONTEXT ==
${context}

== TONE ==
${TONE_PROMPTS[tone] ?? TONE_PROMPTS.drama}

== PLATFORM ==
${platformNote}

== YOUR JOB ==
Write 3 posts ALL in the same tone. Each covers the same event from a DIFFERENT ANGLE:

OPTION 1 — HOT TAKE
Punchy opinion or reaction. Lead with the most shocking element.
Strong opener → context → spicy take or quote → hashtags.

OPTION 2 — PULL QUOTE
Lead with an actual direct quote or close paraphrase (in quotes), then react.
"Quote" → reaction/commentary → hashtags.

OPTION 3 — ANNOUNCEMENT HOOK
Frame like breaking news. Make people feel they NEED to watch.
Hook with urgency → what happened → call to action → hashtags.

== OUTPUT FORMAT — EXACTLY THIS ==
OPTION 1
[post text]

OPTION 2
[post text]

OPTION 3
[post text]

== HASHTAG RULES ==
- Real names from the content ONLY — never invent names
- Platform tags only if relevant (#Kick #Twitch #YouTube)
- Drama tags if they fit (#Exposed #Drama #Beef #Scandal)
- NEVER #gaming #streamer unless literally about gameplay
- 3-5 hashtags per option, each option gets its own
- No preamble before OPTION 1 — start immediately`
}

// ── Call AI ───────────────────────────────────────────────────────────────────
async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 800 } }),
    }
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const d = await res.json()
  return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

async function callGroqLLM(prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.8 }),
  })
  if (!res.ok) throw new Error(`Groq ${res.status}`)
  const d = await res.json()
  return d.choices?.[0]?.message?.content?.trim() ?? ''
}

async function generate(prompt: string): Promise<string> {
  const [g, q] = await Promise.allSettled([callGemini(prompt), callGroqLLM(prompt)])
  if (g.status === 'fulfilled' && g.value) return g.value
  if (q.status === 'fulfilled' && q.value) return q.value
  throw new Error('All AI providers failed')
}

function parseOptions(raw: string): string[] {
  const parts = raw.split(/^OPTION \d+\s*$/m).filter(p => p.trim())
  return parts.length > 0 ? parts.slice(0, 3).map(p => p.trim()) : [raw.trim()]
}

// ── Extract transcript from URL (no video download) ───────────────────────────
async function extractTranscriptFromUrl(url: string): Promise<{ transcript: string; title: string; method: string }> {
  const workerUrl = process.env.NEXT_PUBLIC_MODAL_WORKER_URL
  if (!workerUrl) throw new Error('Worker not configured')

  // Call a lightweight Modal endpoint for subtitle extraction
  const res = await fetch(workerUrl.replace('-start', '-extract'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      authToken: process.env.WORKER_SECRET ?? '',
      mode: 'subtitles_only', // tells worker to use --skip-download
    }),
  })

  if (!res.ok) throw new Error('Transcript extraction failed')
  return res.json()
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()

    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Quota check
    const quota = await checkStudioQuota(supabase, user.id)
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.message, quota }, { status: 429 })
    }

    const body = await req.json()
    const {
      inputType,       // 'url' | 'transcript' | 'prompt'
      input,           // the actual URL, transcript text, or prompt description
      platform = 'twitter',
      tone = 'drama',
      title = '',      // optional context title
    } = body

    if (!input?.trim()) return NextResponse.json({ error: 'Input is required' }, { status: 400 })
    if (!TONE_PROMPTS[tone]) return NextResponse.json({ error: `Unknown tone: ${tone}` }, { status: 400 })

    let context = ''
    let extractedTitle = title
    let extractMethod = inputType

    // ── Build context based on input type ─────────────────────────────────────
    if (inputType === 'url') {
      // Try to extract transcript from URL without downloading
      try {
        const extracted = await extractTranscriptFromUrl(input)
        context = extracted.transcript
        extractedTitle = extracted.title || title
        extractMethod = `url:${extracted.method}`
      } catch (e) {
        // If extraction fails, use URL as context hint
        context = `Video URL: ${input}\nTitle: ${title || 'Unknown'}\n(Transcript unavailable — generate based on URL context)`
        extractMethod = 'url:failed'
      }
    } else if (inputType === 'transcript') {
      // Raw transcript pasted by user
      context = `${title ? `Title: ${title}\n\n` : ''}Transcript:\n${input.slice(0, 8000)}`
    } else {
      // Prompt/description — just use it as-is
      context = `${title ? `Title/Context: ${title}\n\n` : ''}What happened:\n${input}`
    }

    // Generate hook + posts in parallel
    const hookPrompt = `Pull the single most quotable or shocking moment from this content as a standalone hook line (1 sentence, under 100 chars, no emojis):\n\n${context.slice(0, 2000)}`

    const [hookResult, mainResult] = await Promise.allSettled([
      generate(hookPrompt),
      generate(buildStudioPrompt(context, tone, platform)),
    ])

    const hookLine = hookResult.status === 'fulfilled' ? hookResult.value : ''
    const mainRaw = mainResult.status === 'fulfilled' ? mainResult.value : ''

    if (!mainRaw) return NextResponse.json({ error: 'Generation failed' }, { status: 500 })

    // Increment quota
    await incrementStudioQuota(supabase, user.id)

    return NextResponse.json({
      success: true,
      platform,
      tone,
      options: parseOptions(mainRaw),
      hook_line: hookLine,
      extracted_title: extractedTitle,
      extract_method: extractMethod,
      quota: { used: (quota.used ?? 0) + 1, limit: quota.limit },
    })

  } catch (err) {
    console.error('[studio] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  // Returns user's studio quota status
  try {
    const supabase = createAdminClient()
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const quota = await checkStudioQuota(supabase, user.id)
    return NextResponse.json({ quota })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
