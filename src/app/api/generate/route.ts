// src/app/api/generate/route.ts
// Post Studio — uses the real ClipFinder prompts from clipfinder_core.py
// Generates 3 options per platform, all same tone different angles

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 30

// ── Tone definitions — direct port from clipfinder_core.py TWEET_TONE_PROMPTS ──
const TONE_PROMPTS: Record<string, string> = {
  drama: '🔥 DRAMA ACCOUNT — Tea spiller energy. Shocking, pointed, like a real streaming drama page. Use emojis strategically. Pull receipts.',
  tea: '☕ TEA MODE — Calm but devastating. Matter-of-fact delivery that makes the drama hit harder. "So apparently..." energy. Understated.',
  breaking: '📰 BREAKING NEWS — Urgent, journalistic. "BREAKING:" opener. Treat it like actual news. Serious tone, facts first.',
  hype: '💥 HYPE MODE — Celebrate the moment. Positive energy, get people excited to watch. Use energy words. Make it feel unmissable.',
  exaggerate: `🤯 EXAGGERATE MODE — Write a dramatic multi-line story that builds line by line. Use this EXACT format:

🚨 [SHOCKING HEADLINE IN CAPS — name the person and the situation] 😳
[Setup line — what the secret or situation was] 👀
[Escalation — what triggered it or made it worse] 💔
[Twist — how things shifted or got more chaotic] 💸🔥
[Punchline — how wild it ended up] ⚡

Rules: Each line max 12 words. 1-2 emojis at END of each line. Build tension line by line.
Stay factual to the transcript — just massively dramatize real events.
Never mean-spirited toward the person — make them the legendary main character.
All 3 options follow this same format but cover DIFFERENT angles of the same story.
Hashtags on a separate final line.`,
}

// ── Platform-specific max chars ──────────────────────────────────────────────
const PLATFORM_LIMITS: Record<string, number> = {
  twitter: 280,
  instagram: 2200,
  tiktok: 2200,
  youtube: 500,
}

// ── Main prompt — port of TWEET_PROMPT from clipfinder_core.py ───────────────
function buildPrompt(clip: ClipData, tone: string, platform: string): string {
  const limit = PLATFORM_LIMITS[platform] ?? 280
  const platformNote = platform === 'twitter'
    ? `Max ${limit} chars per option.`
    : platform === 'instagram'
    ? `Instagram caption. Hook in first line. 8-12 hashtags on last line. Max ${limit} chars.`
    : platform === 'tiktok'
    ? `TikTok caption. Punchy, lowercase is fine. 3-5 hashtags. Max 150 chars.`
    : `YouTube Shorts description. First line is SEO hook. Add call to action. Max ${limit} chars.`

  return `You are a social media writer for @MarsScumbags, a streaming drama/clip channel.
Read the transcript carefully. Identify WHO is involved, WHAT happened, and the most shocking/quotable moment.

== PEOPLE & CONTEXT ==
Clip title: ${clip.title}
Summary: ${clip.summary}
Speaker: ${clip.speaker || 'unknown'}
${clip.transcript_excerpt ? `\nTranscript excerpt:\n${clip.transcript_excerpt}` : ''}

== TONE ==
${TONE_PROMPTS[tone] ?? TONE_PROMPTS.drama}

== PLATFORM ==
${platformNote}

== YOUR JOB ==
Write 3 posts ALL in the same tone above. Each post covers the same event but from a DIFFERENT ANGLE:

OPTION 1 — HOT TAKE
Your punchy opinion or reaction to what happened. Lead with the most shocking element.
Structure: Strong opener (can be all caps or shocking statement) → context sentence → spicy take or quote → hashtags
Must reference a SPECIFIC moment or quote from the transcript.

OPTION 2 — PULL QUOTE
Lead with an actual direct quote or close paraphrase from the transcript (in quotes), then react to it.
Structure: "Quote from transcript" → your reaction/commentary → hashtags
The quote must be real and specific — not made up.

OPTION 3 — ANNOUNCEMENT HOOK
Frame it like breaking news or a must-see moment. Make people feel like they NEED to watch the clip.
Structure: Hook that creates urgency or curiosity → what happened → call to action or cliffhanger → hashtags
No clickbait that doesn't deliver — be specific about what happens.

== OUTPUT FORMAT ==
Write EXACTLY this — no preamble, no labels other than OPTION 1/2/3:

OPTION 1
[post text]

OPTION 2
[post text]

OPTION 3
[post text]

== HASHTAG RULES ==
- Use ACTUAL NAMES from the transcript/context ONLY — never invent or assume names not mentioned
- Use platform only if relevant (#Kick #Twitch #YouTube)
- Use drama type if it fits (#Exposed #Drama #Beef #Leaked #Scandal)
- NEVER use #gaming #gamingscandal #gamer #streamer unless literally about gameplay
- Each option gets its OWN hashtags matching what THAT post says
- 3-5 hashtags max per option

== RULES ==
- All 3 options MUST be in the same tone — do NOT switch styles between options
- Each option must feel different in angle and structure but same energy
- Use REAL quotes and REAL moments — never make things up
- No preamble before OPTION 1 — start writing immediately`
}

// ── Hook line prompt ──────────────────────────────────────────────────────────
function buildHookPrompt(clip: ClipData): string {
  return `You are an expert at writing viral hooks for social media clips.
Pull the single most quotable, shocking, or funny moment from this clip as a standalone hook line.

Clip title: ${clip.title}
Summary: ${clip.summary}
${clip.transcript_excerpt ? `Transcript excerpt:\n${clip.transcript_excerpt}` : ''}

RULES:
- 1 sentence max, under 100 characters
- Must be something someone actually said OR a punchy description of the moment
- If it's a direct quote from the transcript, wrap it in quotation marks
- No emojis, no hashtags — just the raw line

Return ONLY the hook line. Nothing else.`
}

type ClipData = {
  title: string
  summary: string
  speaker?: string
  transcript_excerpt?: string
}

// ── Parse the OPTION 1/2/3 format from AI response ───────────────────────────
function parseOptions(raw: string): string[] {
  const options: string[] = []
  const parts = raw.split(/^OPTION \d+\s*$/m).filter(p => p.trim())
  for (const part of parts) {
    const cleaned = part.trim()
    if (cleaned) options.push(cleaned)
  }
  // Fallback: if parsing fails, return the whole thing as one option
  if (options.length === 0 && raw.trim()) {
    return [raw.trim()]
  }
  return options.slice(0, 3)
}

async function callGroq(prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.8,
    }),
  })
  if (!res.ok) throw new Error(`Groq error: ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

async function callGemini(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 800 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

async function generate(prompt: string): Promise<string> {
  const [geminiResult, groqResult] = await Promise.allSettled([
    callGemini(prompt),
    callGroq(prompt),
  ])
  if (geminiResult.status === 'fulfilled' && geminiResult.value) return geminiResult.value
  if (groqResult.status === 'fulfilled' && groqResult.value) return groqResult.value
  throw new Error('All AI providers failed')
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { clipId, platform = 'twitter', tone = 'drama' } = body
    if (!clipId) return NextResponse.json({ error: 'clipId required' }, { status: 400 })

    // Validate tone and platform
    if (!TONE_PROMPTS[tone]) return NextResponse.json({ error: `Unknown tone: ${tone}` }, { status: 400 })
    if (!PLATFORM_LIMITS[platform]) return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 })

    // Get clip data
    const { data: clip } = await supabase
      .from('clips')
      .select('title, summary, reason, speaker, start_ts, end_ts, job_id')
      .eq('id', clipId)
      .eq('user_id', user.id)
      .single()

    if (!clip) return NextResponse.json({ error: 'Clip not found' }, { status: 404 })

    // Get transcript excerpt for this clip's time range
    const { data: job } = await supabase
      .from('jobs')
      .select('transcript')
      .eq('id', clip.job_id)
      .single()

    let transcriptExcerpt = ''
    if (job?.transcript) {
      const lines = job.transcript.split('\n')
      const startSec = tsToSeconds(clip.start_ts)
      const endSec = tsToSeconds(clip.end_ts)
      const relevant = lines.filter((line: string) => {
        const match = line.match(/\[(\d{2}):(\d{2}):(\d{2})/)
        if (!match) return false
        const lineSec = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
        return lineSec >= startSec && lineSec <= endSec
      })
      transcriptExcerpt = relevant
        .slice(0, 30)
        .join('\n')
        .replace(/\[\d{2}:\d{2}:\d{2}\.\d{2}\] /g, '')
    }

    const clipData: ClipData = {
      title: clip.title,
      summary: clip.summary,
      speaker: clip.speaker,
      transcript_excerpt: transcriptExcerpt,
    }

    // Run hook + main generation in parallel
    const [hookResult, mainResult] = await Promise.allSettled([
      generate(buildHookPrompt(clipData)),
      generate(buildPrompt(clipData, tone, platform)),
    ])

    const hookLine = hookResult.status === 'fulfilled' ? hookResult.value : ''
    const mainRaw = mainResult.status === 'fulfilled' ? mainResult.value : ''

    if (!mainRaw) {
      return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
    }

    const options = parseOptions(mainRaw)

    return NextResponse.json({
      success: true,
      platform,
      tone,
      options,        // array of 3 post options
      hook_line: hookLine,
      raw: mainRaw,  // full raw output for debugging
    })

  } catch (err) {
    console.error('[generate] error:', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}

function tsToSeconds(ts: string): number {
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}
