// src/app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 45

// ─── Tone system prompts ──────────────────────────────────────────────────────
const TONE_PROMPTS: Record<string, string> = {
  drama: `TONE: Drama/Tea Account (2026 style)
You are a streaming drama account with 500k+ followers. Your posts feel like insider gossip from someone who was IN the room.
- Lead with the most unhinged moment — no warmup
- Write like you're telling your mutuals, not writing a press release
- Use 1-2 emojis MAX — placed for impact, not decoration
- No "wait till you see this" filler. Just drop the heat.
- Make the person sound iconic, not evil`,

  tea: `TONE: Tea/Soft Expose (2026 style)
Calm, devastatingly factual. The most dangerous posts are the ones that sound unbothered.
- Open with a cold fact, no emotion
- "So apparently" / "Turns out" / "Friendly reminder that" energy
- Build the story like a court case — evidence first, reaction second
- 1 emoji max, only if it adds irony
- End on a cliffhanger or unanswered question`,

  breaking: `TONE: Breaking News (2026 style)
Write like a journalist covering a live stream beat. Factual but urgent.
- Start with BREAKING: or 🚨 BREAKING:
- Who, what, when — first sentence has all three
- Quote the exact words if possible (only real quotes from transcript)
- No speculation, no opinion — let the facts be wild
- Hashtags that a journalist would use`,

  hype: `TONE: Hype/Celebration (2026 style)
Make the viewer feel like they MISSED something legendary. Pure positive chaos.
- ALL CAPS for key moments (sparingly — 1-2 words max)
- Exclamation energy but not cringe — think sports commentator
- Focus on the reaction, the moment, the energy
- Make them want to share it with their whole group chat
- "This is the clip of the year" / "Nobody was ready" energy`,

  exaggerate: `TONE: Exaggerate/Villain Arc (2026 style)
Dramatize real events to absurd levels. The subject becomes a movie character.
- Write in 4-5 short punchy lines that build like a story beat
- Each line = 1 escalation. No line over 12 words.
- Use 1 emoji at the END of each line (different each time)
- The last line should be the wildest
- Stay factual — just frame it cinematically`,
}

// ─── Platform formats ─────────────────────────────────────────────────────────
const PLATFORM_FORMATS: Record<string, string> = {
  twitter: `PLATFORM: Twitter/X — 2026 format
MAX 280 characters including hashtags. Count carefully.
- Hook in first 8 words — that's all that shows in feed before "more"
- No thread format — one punchy post
- 2-4 hashtags at the end, on the same line
- Trending hashtag style: #Kick #Exposed #Drama #[PersonName]
- DO NOT exceed 280 chars. If over, cut words not hashtags.`,

  instagram: `PLATFORM: Instagram — 2026 format  
Caption up to 400 words. First 125 chars show before "more" — make them count.
- Line 1: The hook (under 125 chars, no hashtag here)
- Lines 2-4: Tell the full story with detail and emotion
- Line 5: CTA — "Save this" / "Tag someone who needs to see this" / "Follow for more clips"
- Blank line, then hashtags: 8-15 hashtags on a single line at the very bottom
- Mix: #[PersonName] #Kick #StreamClips #Drama + niche tags`,

  tiktok: `PLATFORM: TikTok — 2026 format
Caption is 150 chars MAX. Punchy. Hook-first.
- First word must be a hook trigger: "POV" / "Wait" / "No way" / "THEY SAID" / "Bro"
- 3-5 hashtags after the text
- Include at least 1 trending format tag: #fyp #foryou #viral
- No full sentences needed — fragments hit harder
- Think: what would make someone stop scrolling`,

  youtube: `PLATFORM: YouTube Shorts — 2026 format
Write a TITLE and DESCRIPTION. Format exactly like this:

TITLE: [your title here]
DESC: [your description here]

Title rules (60 chars max):
- Front-load the most shocking word or name
- Use reaction format: "He Said WHAT?!" / "She Actually Did This" / "Nobody Expected This"
- 1-2 words in ALL CAPS for emphasis
- Include the person's name if known

Description rules (200 chars max):
- First sentence = what happened (for SEO)
- End with 3-5 hashtags: #Shorts #[PersonName] #Kick #Viral #StreamMoments`,
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
function buildPrompt(
  transcript: string,
  tone: string,
  platform: string,
  streamerName: string,
  clipTitle: string,
  allSocials: boolean
): string {
  const toneText = TONE_PROMPTS[tone] ?? TONE_PROMPTS.drama
  const platformText = PLATFORM_FORMATS[platform] ?? PLATFORM_FORMATS.twitter
  const nameInstruction = streamerName
    ? `The streamer/creator's name is: "${streamerName}". Use this EXACT name throughout. Never use their user ID or a random string.`
    : `No streamer name provided. Refer to them as "the streamer" or extract a name from the transcript if mentioned.`

  if (allSocials) {
    // All-socials mode: 1 perfect post per platform
    return `You are a top-tier social media strategist for a streaming clip channel with millions of followers.
Your job: write ONE single, perfect post for ${platform.toUpperCase()} based on this clip.

== IDENTITY ==
${nameInstruction}
${clipTitle ? `Clip context: ${clipTitle}` : ''}

== TRANSCRIPT ==
${transcript.slice(0, 2500)}

== ${toneText}

== ${platformText}

== YOUR TASK ==
Write EXACTLY ONE post for ${platform.toUpperCase()}. 
- Study the transcript and find the single most viral moment
- Apply the tone and platform format precisely
- Use the streamer's REAL name (${streamerName || 'the streamer'}) — NEVER their user ID
- Only use real quotes from the transcript (exact words)
- Make it feel like it was written by a human who actually watched the clip

OUTPUT: Write only the post. No labels, no preamble, no "Here is your post:". Just the content.`
  }

  // Single platform mode: 3 options
  return `You are a viral social media writer for a streaming clip channel.

== IDENTITY ==
${nameInstruction}
${clipTitle ? `Clip context: ${clipTitle}` : ''}

== TRANSCRIPT ==
${transcript.slice(0, 2500)}

== ${toneText}

== ${platformText}

== YOUR JOB ==
Write 3 different posts in the SAME tone, covering the SAME moment from 3 angles:

OPTION 1 — HOT TAKE: Your punchy reaction. Lead with the most shocking element. Opinion first.
OPTION 2 — PULL QUOTE: Open with a real direct quote from the transcript (in "quotes"), then react.
OPTION 3 — ANNOUNCEMENT: Frame it as breaking news. Create urgency. Make them feel they missed something.

== CRITICAL RULES ==
- Use "${streamerName || 'the streamer'}" by name — NEVER use random IDs or hex strings
- Only quote things actually said in the transcript
- Follow the platform format exactly (char limits, hashtag rules, etc.)
- Each option must feel completely different from the others

== OUTPUT FORMAT — follow exactly:
OPTION 1
[post content]

OPTION 2
[post content]

OPTION 3
[post content]

Start with OPTION 1 immediately. No intro text.`
}

// ─── AI caller ────────────────────────────────────────────────────────────────
async function callAI(prompt: string): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY
  const groqKey   = process.env.GROQ_API_KEY

  const calls: Promise<string>[] = []

  if (geminiKey) {
    calls.push(
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens: 2000 }
        }),
        signal: AbortSignal.timeout(28000),
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
          max_tokens: 2000, temperature: 0.85,
        }),
        signal: AbortSignal.timeout(28000),
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

// ─── Parse 3 options from AI response ────────────────────────────────────────
function parseOptions(raw: string): string[] {
  const blocks = raw.split(/\bOPTION\s+[123]\b/i).map(s => s.trim()).filter(Boolean)
  const options = blocks.slice(0, 3).map(b => b.replace(/^[-–—\s]+/, '').trim())
  while (options.length < 3) options.push(options[0] ?? raw.trim())
  return options.slice(0, 3)
}

// ─── Extract streamer name from URL ──────────────────────────────────────────
function extractStreamerFromUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname.includes('kick.com')) {
      const parts = u.pathname.split('/').filter(Boolean)
      // kick.com/username  or  kick.com/username/clips/clip_id
      // Never use a segment that looks like a clip ID (starts with clip_ or is all hex)
      for (const part of parts) {
        if (part === 'clips' || part.startsWith('clip_')) break
        if (/^[a-f0-9]{8,}$/.test(part)) continue // skip hex IDs
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
    const {
      clipId,
      platform = 'twitter',
      tone = 'drama',
      streamerName: bodyStreamer,
      customContext = '',
      platforms,
      customTitle: bodyCustomTitle,
    } = body

    // Fetch clip + transcript
    const { data: clip } = await supabase
      .from('clips').select('id, title, summary, job_id').eq('id', clipId).single()

    let transcript = clip?.summary ?? ''
    let sourceUrl  = ''
    let videoTitle = clip?.title ?? ''
    let dbStreamer = ''

    if (clip?.job_id) {
      const { data: job } = await supabase
        .from('jobs').select('source_url, video_title, transcript, streamer_name').eq('id', clip.job_id).single()
      sourceUrl = job?.source_url ?? ''
      dbStreamer = job?.streamer_name ?? ''
      if (job?.transcript) transcript = job.transcript
      if (job?.video_title) videoTitle = job.video_title
    }

    // Streamer name priority: body param → DB field → URL extraction
    // Never fall back to a hex ID — rather use "the streamer"
    const rawStreamer = bodyStreamer || dbStreamer || extractStreamerFromUrl(sourceUrl)
    const streamerName = rawStreamer && !/^[a-f0-9]{8,}$/.test(rawStreamer) ? rawStreamer : ''

    if (bodyCustomTitle?.trim()) videoTitle = bodyCustomTitle.trim()

    const targetPlatforms: string[] = platforms ?? [platform]
    const isAllSocials = targetPlatforms.length > 1
    const results: Record<string, { options: string[]; hook_line: string }> = {}

    await Promise.all(targetPlatforms.map(async (p) => {
      const prompt = buildPrompt(transcript || videoTitle, tone, p, streamerName, videoTitle, isAllSocials)
      const raw = await callAI(prompt)
      console.log(`[generate] ${p} len=${raw.length} name="${streamerName}" snippet="${raw.slice(0, 60).replace(/\n/g, ' ')}"`)

      if (isAllSocials) {
        // All-socials mode: wrap single result in array
        results[p] = { options: [raw.trim()], hook_line: '' }
      } else {
        results[p] = { options: parseOptions(raw), hook_line: '' }
      }
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
