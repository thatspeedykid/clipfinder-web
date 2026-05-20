// src/app/api/generate/route.ts
// Post Studio generator — creates platform-specific posts for a clip
// Runs Gemini + Groq in parallel, returns fastest good result

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 30

const PLATFORM_PROMPTS: Record<string, (clip: ClipData, tone: string) => string> = {
  twitter: (clip, tone) => `You are a viral Twitter/X content writer for a drama/streaming clip channel.
Write a tweet for this clip. ${TONE_INSTRUCTIONS[tone]}

Clip title: ${clip.title}
Summary: ${clip.summary}
Speaker: ${clip.speaker || 'unknown'}
Hook line: ${clip.hook_line || ''}

RULES:
- Max 260 characters (leave room for a link)
- No generic phrases like "You won't believe" or "This is crazy"
- Write like a real person, not a brand
- Use the actual names from the clip if known
- End with a cliffhanger or reaction if possible
- 1-2 relevant emojis max, used naturally not spammed

Return ONLY the tweet text. Nothing else.`,

  instagram: (clip, tone) => `You are a viral Instagram caption writer for a drama/streaming clip page.
Write an Instagram caption for this clip. ${TONE_INSTRUCTIONS[tone]}

Clip title: ${clip.title}
Summary: ${clip.summary}
Speaker: ${clip.speaker || 'unknown'}

RULES:
- 150-300 characters for the main caption
- Add 8-12 relevant hashtags on a new line at the end
- Hook in the first line — make them stop scrolling
- Use line breaks for readability
- Emojis used naturally, not every word

Return ONLY the caption with hashtags. Nothing else.`,

  tiktok: (clip, tone) => `You are a viral TikTok caption writer for a drama/streaming clip account.
Write a TikTok caption for this clip. ${TONE_INSTRUCTIONS[tone]}

Clip title: ${clip.title}
Summary: ${clip.summary}

RULES:
- Max 150 characters
- Punchy, conversational, lowercase is fine
- 3-5 hashtags at the end (mix trending + niche)
- Make it feel like a real person posted it, not a brand

Return ONLY the caption. Nothing else.`,

  youtube: (clip, tone) => `You are a YouTube Shorts description writer for a drama/streaming clip channel.
Write a YouTube Shorts description for this clip. ${TONE_INSTRUCTIONS[tone]}

Clip title: ${clip.title}
Summary: ${clip.summary}
Speaker: ${clip.speaker || 'unknown'}

RULES:
- First line is the hook (shows in search) — max 100 chars
- 2-3 sentences of context below
- Add 5-8 hashtags at the end
- Include a call to action (subscribe, follow, etc.)

Return ONLY the description. Nothing else.`,

  hook: (clip, _tone) => `You are an expert at writing viral hooks for social media clips.
Pull the single most quotable, shocking, or funny moment from this clip as a standalone hook line.

Clip title: ${clip.title}
Summary: ${clip.summary}
Transcript excerpt: ${clip.transcript_excerpt || clip.summary}

RULES:
- 1 sentence max, under 100 characters
- Must be something someone actually said OR a punchy description of the moment
- If it's a quote, use quotation marks
- No emojis, no hashtags — just the raw line

Return ONLY the hook line. Nothing else.`,
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  drama:   'Tone: Drama. Lean into the conflict, the betrayal, the shocking moment. Make it feel like the biggest thing that happened today.',
  hype:    'Tone: Hype. High energy, excited, make people feel like they NEED to watch this right now.',
  neutral: 'Tone: Neutral. Just state what happened clearly and compellingly. Let the moment speak for itself.',
  funny:   'Tone: Funny. Lean into the absurdity or comedy of the situation. Dry humor works well here.',
}

type ClipData = {
  title: string
  summary: string
  speaker?: string
  hook_line?: string
  transcript_excerpt?: string
}

async function callGroq(prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.7,
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
      generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
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
  // Prefer Gemini, fall back to Groq
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
    const { clipId, platform = 'twitter', tone = 'drama', regenerate = false } = body

    if (!clipId) return NextResponse.json({ error: 'clipId required' }, { status: 400 })

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
      // Pull lines within the clip's time range
      const lines = job.transcript.split('\n')
      const startSec = tsToSeconds(clip.start_ts)
      const endSec = tsToSeconds(clip.end_ts)
      const relevant = lines.filter(line => {
        const match = line.match(/\[(\d{2}):(\d{2}):(\d{2})/)
        if (!match) return false
        const lineSec = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
        return lineSec >= startSec && lineSec <= endSec
      })
      transcriptExcerpt = relevant.slice(0, 20).join('\n').replace(/\[\d{2}:\d{2}:\d{2}\.\d{2}\] /g, '')
    }

    const clipData: ClipData = {
      title: clip.title,
      summary: clip.summary,
      speaker: clip.speaker,
      transcript_excerpt: transcriptExcerpt,
    }

    // Generate hook line first if not twitter (used in other prompts)
    let hookLine = ''
    if (platform !== 'hook') {
      try {
        hookLine = await generate(PLATFORM_PROMPTS.hook(clipData, tone))
        clipData.hook_line = hookLine
      } catch { /* hook generation failed, continue without it */ }
    }

    // Generate the requested platform post
    const promptFn = PLATFORM_PROMPTS[platform]
    if (!promptFn) return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 })

    const generated = await generate(promptFn(clipData, tone))

    return NextResponse.json({
      success: true,
      platform,
      tone,
      content: generated,
      hook_line: hookLine || generated,
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
