// src/app/api/generate/route.ts
// Uses actual ClipFinder prompts from clipfinder_core.py
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 30

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
Never mean-spirited — make them the legendary main character.
All 3 options follow this same format but cover DIFFERENT angles of the same story.
Hashtags on a separate final line.`
}

const PLATFORM_FORMATS: Record<string, string> = {
  twitter: `PLATFORM: Twitter/X (280 char limit per option)
- Max 280 chars including hashtags
- 3-5 hashtags at the end
- No links`,

  instagram: `PLATFORM: Instagram (caption, up to 2200 chars)
- Write a longer engaging caption that tells the full story
- First 125 chars are shown before "more" — hook hard
- Line breaks every 1-2 sentences
- 5-10 hashtags at the very END after a blank line
- End with a CTA: "Save this" / "Tag someone" / "Follow for more"`,

  tiktok: `PLATFORM: TikTok (150 char limit)
- MAX 150 chars total
- 3-5 trending hashtags
- Start with hook word: "POV:" / "Wait for it" / "They really said"
- Punchy, no full sentences needed`,

  youtube: `PLATFORM: YouTube Shorts
- Write a TITLE (60 chars max) and DESCRIPTION (150 chars) separately
- Title: front-load keyword, ALL CAPS for key words, reaction-style
- Format each option as:
TITLE: [title here]
DESC: [description + #Shorts #StreamerMoments]`
}

function buildPrompt(
  transcript: string,
  tone: string,
  platform: string,
  streamerName: string,
  clipTitle: string,
  customContext: string
): string {
  const context = [
    streamerName ? `Streamer/Creator: ${streamerName}` : '',
    clipTitle ? `Clip title: ${clipTitle}` : '',
    customContext ? `Extra context: ${customContext}` : '',
  ].filter(Boolean).join('\n')

  const toneText = TONE_PROMPTS[tone] ?? TONE_PROMPTS.drama
  const platformText = PLATFORM_FORMATS[platform] ?? PLATFORM_FORMATS.twitter

  return `You are a social media writer for a streaming drama/clip channel.
Read the transcript carefully. Identify WHO is involved, WHAT happened, and the most shocking/quotable moment.

== PEOPLE & CONTEXT ==
${context || 'No additional context provided'}

== TRANSCRIPT ==
${transcript.slice(0, 3000)}

== TONE ==
${toneText}

== ${platformText}

== YOUR JOB ==
Write 3 options ALL in the same tone. Each covers the same event from a DIFFERENT ANGLE:

OPTION 1 — HOT TAKE
Your punchy opinion or reaction. Lead with the most shocking element.
Strong opener → context → spicy take or quote → hashtags

OPTION 2 — PULL QUOTE  
Lead with an actual direct quote from the transcript (in quotes), then react.
"Quote from transcript" → your reaction → hashtags
The quote must be REAL and SPECIFIC — not made up.

OPTION 3 — ANNOUNCEMENT HOOK
Frame it like breaking news. Make people feel they NEED to watch.
Hook that creates urgency → what happened → cliffhanger → hashtags

== HASHTAG RULES ==
- Use ACTUAL NAMES from transcript/context ONLY — never invent names not mentioned
- Use platform only if relevant (#Kick #Twitch #YouTube)
- Use drama type if it fits (#Exposed #Drama #Beef #Leaked #Scandal)
- NEVER use #gaming #gamer #streamer unless literally about gameplay
- Each option gets its OWN hashtags
- 3-5 hashtags max per option

== OUTPUT FORMAT ==
Write EXACTLY this — no preamble, no extra labels:

OPTION 1
[content]

OPTION 2
[content]

OPTION 3
[content]

== RULES ==
- All 3 options MUST be in the same tone
- Use REAL quotes and REAL moments — never make things up
- Reference ${streamerName || 'the streamer'} by name throughout
- No preamble before OPTION 1 — start writing immediately`
}

async function callAI(prompt: string): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY
  const groqKey = process.env.GROQ_API_KEY

  const calls: Promise<string>[] = []

  if (geminiKey) {
    calls.push(
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 3000 }
        }),
        signal: AbortSignal.timeout(25000),
      }).then(r => r.json()).then(d => d.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
    )
  }

  if (groqKey) {
    calls.push(
      fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 3000, temperature: 0.8,
        }),
        signal: AbortSignal.timeout(25000),
      }).then(r => r.json()).then(d => d.choices?.[0]?.message?.content ?? '')
    )
  }

  if (calls.length === 0) throw new Error('No AI API keys configured')

  const results = await Promise.allSettled(calls)
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.trim()) return r.value
  }
  throw new Error('All AI calls failed')
}

function parseOptions(raw: string): string[] {
  const options: string[] = []
  const blocks = raw.split(/\bOPTION\s+[123]\b/i).map(s => s.trim()).filter(Boolean)
  for (const block of blocks.slice(0, 3)) {
    options.push(block.trim())
  }
  while (options.length < 3) options.push(options[0] ?? raw)
  return options.slice(0, 3)
}

function extractHookLine(transcript: string): string {
  if (!transcript) return ''
  const sentences = transcript.split(/[.!?]/).map(s => s.trim()).filter(s => s.length > 15 && s.length < 120)
  return sentences[0] ?? ''
}

function extractStreamerFromUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname.includes('kick.com')) {
      const parts = u.pathname.split('/').filter(Boolean)
      return parts[0] && parts[0] !== 'clips' ? parts[0] : ''
    }
    if (u.hostname.includes('twitter.com') || u.hostname.includes('x.com')) {
      return u.pathname.split('/').filter(Boolean)[0]?.replace('@', '') ?? ''
    }
    if (u.hostname.includes('tiktok.com')) {
      return u.pathname.split('/').filter(Boolean)[0]?.replace('@', '') ?? ''
    }
    if (u.hostname.includes('twitch.tv')) {
      return u.pathname.split('/').filter(Boolean)[0] ?? ''
    }
  } catch {}
  return ''
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { clipId, platform = 'twitter', tone = 'drama', streamerName: bodyStreamer, customContext = '', platforms, customTitle: bodyCustomTitle } = body

    // Fetch clip + transcript
    const { data: clip } = await supabase.from('clips').select('id, title, summary, job_id').eq('id', clipId).single()

    let transcript = clip?.summary ?? ''
    let sourceUrl = ''
    let videoTitle = clip?.title ?? ''

    if (clip?.job_id) {
      const { data: job } = await supabase.from('jobs').select('source_url, video_title, transcript').eq('id', clip.job_id).single()
      sourceUrl = job?.source_url ?? ''
      if (job?.transcript) transcript = job.transcript
      if (job?.video_title) videoTitle = job.video_title
    }

    const streamerName = bodyStreamer || extractStreamerFromUrl(sourceUrl) || ''
    // Use user-provided title if set — helps AI generate better targeted content
    if (bodyCustomTitle?.trim()) videoTitle = bodyCustomTitle.trim()
    const hookLine = extractHookLine(transcript)

    const targetPlatforms: string[] = platforms ?? [platform]
    const results: Record<string, { options: string[]; hook_line: string }> = {}

    await Promise.all(targetPlatforms.map(async (p) => {
      const prompt = buildPrompt(transcript || videoTitle, tone, p, streamerName, videoTitle, customContext)
      const raw = await callAI(prompt)
      const options = parseOptions(raw)
      results[p] = { options, hook_line: hookLine }
    }))

    if (targetPlatforms.length === 1) {
      return NextResponse.json({ ...results[targetPlatforms[0]], streamer: streamerName })
    }
    return NextResponse.json({ platforms: results, streamer: streamerName })

  } catch (err) {
    console.error('[generate] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
