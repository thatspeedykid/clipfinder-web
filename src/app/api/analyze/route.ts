// src/app/api/analyze/route.ts
// Core AI analysis endpoint — runs Gemini + Groq in parallel for speed
// Called after transcription is done. Returns detected clips as JSON.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkQuota, incrementQuota } from '@/lib/quota'
import { fillPrompt, AI_PROMPT, INTERVIEW_CLIP_PROMPT, AUTO_EDIT_PROMPT } from '@/lib/prompts'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`

export const maxDuration = 60 // Vercel Pro allows up to 300s; free plan max 60s

// ── Call Groq LLM ─────────────────────────────────────────────
async function callGroq(prompt: string, model = 'llama-3.3-70b-versatile'): Promise<string> {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.3,
    }),
  })
  if (!res.ok) throw new Error(`Groq error: ${res.status}`)
  const data = await res.json()
  return data.choices[0]?.message?.content ?? ''
}

// ── Call Gemini ───────────────────────────────────────────────
async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4000 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// ── Parse JSON from AI response (handles markdown fences) ──────
function parseClips(raw: string): unknown[] {
  const clean = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  const start = clean.indexOf('[')
  const end = clean.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error('No JSON array found in response')

  return JSON.parse(clean.slice(start, end + 1))
}

// ── Main handler ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()

    // Auth
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Quota check
    const quota = await checkQuota(user.id)
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.message, quota }, { status: 429 })
    }

    const body = await req.json()
    const { jobId, transcript, videoTitle, mode = 'auto', names = '' } = body

    if (!jobId || !transcript) {
      return NextResponse.json({ error: 'jobId and transcript required' }, { status: 400 })
    }

    // Update job status
    await supabase
      .from('jobs')
      .update({ status: 'analyzing', progress: 50, progress_msg: 'AI analyzing transcript...' })
      .eq('id', jobId)

    // Build prompt
    const contextBlock = videoTitle ? `VIDEO TITLE: "${videoTitle}"\n` : ''
    const namesBlock = names ? `People in this video: ${names}\n` : ''

    let promptTemplate = AI_PROMPT
    if (mode === 'interview') promptTemplate = INTERVIEW_CLIP_PROMPT
    if (mode === 'auto_edit') promptTemplate = AUTO_EDIT_PROMPT

    const prompt = fillPrompt(promptTemplate, {
      context_block: contextBlock,
      names_block: namesBlock,
      names,
      transcript: transcript.slice(0, 80000), // Groq 32k context limit safety
      target_sec: '600',
      target_min: '10',
      min_seg_sec: '60',
      score_desc: 'drama, entertainment value, viral potential',
      order: 'chronological',
    })

    // ── Run Gemini + Groq in PARALLEL — winner takes all ──────
    // Both fire simultaneously. Whichever succeeds first wins.
    // If both succeed, Gemini result is preferred (better quality).
    let clips: unknown[] = []
    let provider = 'unknown'

    const results = await Promise.allSettled([
      callGemini(prompt).then(r => ({ provider: 'gemini', raw: r })),
      callGroq(prompt).then(r => ({ provider: 'groq', raw: r })),
    ])

    // Prefer Gemini, fall back to Groq
    for (const result of results) {
      if (result.status === 'fulfilled') {
        try {
          clips = parseClips(result.value.raw) as unknown[]
          provider = result.value.provider
          break
        } catch {
          continue // try next result
        }
      }
    }

    if (clips.length === 0) {
      await supabase
        .from('jobs')
        .update({ status: 'error', error_msg: 'AI could not detect clips in this video.' })
        .eq('id', jobId)
      return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 })
    }

    // Save clips to DB
    const clipRows = (clips as Record<string, unknown>[]).map((clip) => ({
      job_id: jobId,
      user_id: user.id,
      title: clip.title as string,
      summary: clip.summary as string,
      reason: clip.reason as string,
      start_ts: clip.start as string,
      end_ts: clip.end as string,
      score: clip.score as number,
      hook: clip.hook as number,
      engagement: clip.engagement as number,
      shareability: clip.shareability as number,
      speaker: clip.speaker as string,
      duration_sec: tsToSeconds(clip.end as string) - tsToSeconds(clip.start as string),
    }))

    const { error: insertError } = await supabase.from('clips').insert(clipRows)
    if (insertError) throw insertError

    // Update job as analyzed
    await supabase
      .from('jobs')
      .update({
        status: 'cutting',
        progress: 70,
        progress_msg: `Found ${clips.length} clips — sending to cutter...`,
        clips_found: clips.length,
      })
      .eq('id', jobId)

    // Increment user's daily quota
    await incrementQuota(user.id)

    return NextResponse.json({
      success: true,
      clips: clipRows,
      count: clips.length,
      provider,
    })

  } catch (err) {
    console.error('[analyze] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function tsToSeconds(ts: string): number {
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}
