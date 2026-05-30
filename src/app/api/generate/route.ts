// src/app/api/generate/route.ts
// Platform-optimized post generation with streamer name support
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 30

// Platform-specific format instructions based on current 2026 algos
const PLATFORM_FORMATS: Record<string, string> = {
  twitter: `FORMAT FOR TWITTER/X (2026 algorithm):
- 280 char limit total including hashtags
- First line is the hook — must stop the scroll in 2 seconds
- No links (suppressed in algo). Use thread format [1/x] if needed.
- 2-3 hashtags max, at end, relevant and trending
- Engagement bait works: "Quote RT if...", "Who was right?", polls implied
- Conversational tone, no corporate speak
- Retweet-worthy: controversial, surprising, or shareable opinion`,

  instagram: `FORMAT FOR INSTAGRAM (2026 algorithm):
- First 125 chars show before "more" — make them count
- Long captions (800-2200 chars) get MORE reach in 2026 — tell the full story
- Line breaks every 1-2 sentences for readability
- 5-10 hashtags, mix of niche + broad, at the END after a line break
- Start with a hook question or bold statement
- CTA at end: "Save this", "Tag someone", "Follow for more drama"
- No clickbait — Instagram punishes it now`,

  tiktok: `FORMAT FOR TIKTOK (2026 algorithm):
- 150 char limit for caption
- Keep it SHORT and punchy — TikTok users don't read long captions
- 3-5 hashtags that are ACTIVELY trending
- Use: #StreamerDrama #GamingTikTok #Twitch #Kick + 1-2 niche tags
- First word should be a hook: "POV:", "Wait for it", "They really said"
- Emojis replace words where possible
- NO external links mentioned`,

  youtube: `FORMAT FOR YOUTUBE SHORTS (2026 algorithm):
- Title: 60-70 chars max, front-load the keyword, ALL CAPS for key words
- Description: 150-200 chars, include streamer name + context
- 3-5 hashtags at the END of description (#Shorts mandatory)
- Title format: "[STREAMER NAME] [SHOCKING VERB] [WHAT HAPPENED] 😱"
- Make title feel like a reaction: "I Can't Believe He Said This"
- #Shorts #StreamerMoments are mandatory hashtags
- Separate title from description clearly`,
}

const TONE_PROMPTS: Record<string, string> = {
  drama: '🔥 DRAMA ACCOUNT — Tea spiller energy. Shocking, pointed, like a real streaming drama page. Use emojis strategically.',
  tea: '☕ TEA MODE — Calm but devastating. "So apparently..." energy. Understated but the drama hits harder.',
  breaking: '📰 BREAKING — Urgent, journalistic. Treat it like actual breaking news. Facts first.',
  hype: '💥 HYPE MODE — Celebrate the moment. Positive energy, make it feel unmissable.',
  exaggerate: `🤯 EXAGGERATE — Dramatic multi-line story. Format:
🚨 [SHOCKING HEADLINE — caps, name the person] 😳
[Setup — what happened] 👀
[Escalation — what made it worse] 💔
[Twist — how things shifted] 💸🔥
[Punchline — how wild it ended] ⚡
Each line max 12 words. Build tension. Hashtags on final line.`,
}

type ClipData = {
  clipId?: string
  title?: string
  summary?: string
  transcript?: string
  streamerName?: string
  customContext?: string
  score?: number
}

function buildPrompt(clip: ClipData, tone: string, platform: string): string {
  const streamer = clip.streamerName ? `STREAMER/CREATOR: ${clip.streamerName}` : ''
  const customCtx = clip.customContext ? `\nUSER CONTEXT: ${clip.customContext}` : ''

  if (platform === 'youtube') {
    return `You are a YouTube Shorts expert creating viral video metadata.
${streamer}
CLIP TITLE: ${clip.title ?? 'Streaming clip'}
WHAT HAPPENED: ${clip.summary ?? ''}
${clip.transcript ? `TRANSCRIPT EXCERPT: "${clip.transcript.slice(0, 500)}"` : ''}
${customCtx}

TONE: ${TONE_PROMPTS[tone] ?? TONE_PROMPTS.drama}

${PLATFORM_FORMATS.youtube}

Generate 3 different YouTube Shorts metadata options. Each option must have:
TITLE: [the title]
DESCRIPTION: [the description with hashtags]

Separate each option with ---

Return ONLY the 3 options, no extra text.`
  }

  return `You are a viral social media expert for ${platform === 'twitter' ? 'Twitter/X' : platform === 'instagram' ? 'Instagram' : 'TikTok'}.
${streamer}
CLIP TITLE: ${clip.title ?? 'Streaming clip'}
WHAT HAPPENED: ${clip.summary ?? ''}
${clip.transcript ? `KEY QUOTE: "${clip.transcript.slice(0, 300)}"` : ''}
${customCtx}

TONE: ${TONE_PROMPTS[tone] ?? TONE_PROMPTS.drama}

${PLATFORM_FORMATS[platform] ?? ''}

Write EXACTLY 3 different post options for this clip. Each covers a different angle:
Option 1 (Hot Take): Your punchy opinion/reaction
Option 2 (Pull Quote): Lead with an actual quote, then react  
Option 3 (Announcement): Frame as breaking news/must-watch

Rules:
- Each must be complete and ready to post
- Respect the character limits for ${platform}
- Use the streamer's actual name: ${clip.streamerName || 'the streamer'}
- Stay true to what actually happened
- Make each one distinctly different in angle

Return ONLY the 3 options separated by ---
No labels, no numbering, just the raw post text.`
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
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 2000 } }),
      }).then(r => r.json()).then(d => d.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
    )
  }

  if (groqKey) {
    calls.push(
      fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 2000, temperature: 0.7 }),
      }).then(r => r.json()).then(d => d.choices?.[0]?.message?.content ?? '')
    )
  }

  if (calls.length === 0) throw new Error('No AI API keys configured')

  const results = await Promise.allSettled(calls)
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.trim()) return r.value
  }
  throw new Error('All AI calls failed')
}

function extractStreamerFromUrl(url: string): string {
  try {
    const u = new URL(url)
    // kick.com/username or kick.com/username/clips/...
    if (u.hostname.includes('kick.com')) {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts[0] && parts[0] !== 'clips') return parts[0]
    }
    // twitter.com/username or x.com/username
    if (u.hostname.includes('twitter.com') || u.hostname.includes('x.com')) {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts[0]) return parts[0].replace('@', '')
    }
    // tiktok.com/@username
    if (u.hostname.includes('tiktok.com')) {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts[0]?.startsWith('@')) return parts[0].replace('@', '')
    }
    // twitch.tv/username
    if (u.hostname.includes('twitch.tv')) {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts[0]) return parts[0]
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
    const {
      clipId, platform = 'twitter', tone = 'drama',
      streamerName, customContext, sourceUrl,
      platforms, // array for multi-platform at once
    } = body

    // Fetch clip data
    const { data: clip } = await supabase
      .from('clips')
      .select('id, title, summary, job_id')
      .eq('id', clipId)
      .single()

    // Get source URL from job if not provided
    let finalSourceUrl = sourceUrl
    if (!finalSourceUrl && clip?.job_id) {
      const { data: job } = await supabase.from('jobs').select('source_url').eq('id', clip.job_id).single()
      finalSourceUrl = job?.source_url
    }

    // Auto-extract streamer name from URL if not provided
    const resolvedStreamer = streamerName || extractStreamerFromUrl(finalSourceUrl || '')

    const clipData: ClipData = {
      clipId,
      title: clip?.title,
      summary: clip?.summary,
      streamerName: resolvedStreamer,
      customContext,
    }

    // Generate for multiple platforms at once
    const targetPlatforms: string[] = platforms ?? [platform]

    const results: Record<string, { options: string[]; hook_line: string }> = {}

    await Promise.all(targetPlatforms.map(async (p) => {
      const prompt = buildPrompt(clipData, tone, p)
      const raw = await callAI(prompt)

      // Parse options separated by ---
      let parsedOptions: string[]
      if (p === 'youtube') {
        // YouTube has TITLE: / DESCRIPTION: format
        const blocks = raw.split(/---+/).map((s: string) => s.trim()).filter(Boolean)
        parsedOptions = blocks.slice(0, 3)
      } else {
        parsedOptions = raw.split(/---+/).map((s: string) => s.trim()).filter(Boolean).slice(0, 3)
      }

      // Pad to 3 if needed
      while (parsedOptions.length < 3) parsedOptions.push(parsedOptions[0] ?? raw)

      // Extract hook line (first meaningful line)
      const firstOption = parsedOptions[0] ?? ''
      const hookLine = firstOption.split('\n')[0]?.replace(/^[🚨🔥☕📰💥🤯]?\s*/, '').slice(0, 100) ?? ''

      results[p] = { options: parsedOptions.slice(0, 3), hook_line: hookLine }
    }))

    // Return single platform or all
    if (targetPlatforms.length === 1) {
      return NextResponse.json({ ...results[targetPlatforms[0]], streamer: resolvedStreamer })
    }
    return NextResponse.json({ platforms: results, streamer: resolvedStreamer })

  } catch (err) {
    console.error('[generate] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
