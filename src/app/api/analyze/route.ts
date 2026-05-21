// src/app/api/analyze/route.ts
// Parallel AI analysis — rotates across ALL available keys simultaneously
// Add more keys via env vars: GEMINI_API_KEY_2, GEMINI_API_KEY_3, GROQ_API_KEY_2 etc.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkQuota, incrementQuota } from '@/lib/quota'
import { fillPrompt, AI_PROMPT, INTERVIEW_CLIP_PROMPT, AUTO_EDIT_PROMPT } from '@/lib/prompts'

export const maxDuration = 60

function getKeys(base: string): string[] {
  const keys: string[] = []
  const first = process.env[base]
  if (first) keys.push(first)
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`${base}_${i}`]
    if (k) keys.push(k)
  }
  return keys
}

async function callGeminiKey(apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4000 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!text) throw new Error('Gemini empty response')
  return text
}

async function callGroqKey(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.3,
    }),
  })
  if (!res.ok) throw new Error(`Groq error: ${res.status}`)
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('Groq empty response')
  return text
}

async function callOpenRouterKey(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://clipfinder.app',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.3,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter error: ${res.status}`)
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('OpenRouter empty response')
  return text
}

function parseClips(raw: string): unknown[] {
  const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const start = clean.indexOf('[')
  const end = clean.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error('No JSON array in response')
  return JSON.parse(clean.slice(start, end + 1))
}

async function analyzeWithAllKeys(prompt: string): Promise<{ clips: unknown[], provider: string }> {
  const geminiKeys = getKeys('GEMINI_API_KEY')
  const groqKeys = getKeys('GROQ_API_KEY')
  const orKeys = getKeys('OPENROUTER_API_KEY')

  console.log(`[analyze] firing ${geminiKeys.length} Gemini + ${groqKeys.length} Groq + ${orKeys.length} OpenRouter keys in parallel`)

  const calls: Promise<{ provider: string; raw: string }>[] = [
    ...geminiKeys.map((key, i) =>
      callGeminiKey(key, prompt).then(raw => ({ provider: `gemini-${i + 1}`, raw }))
    ),
    ...groqKeys.map((key, i) =>
      callGroqKey(key, prompt).then(raw => ({ provider: `groq-${i + 1}`, raw }))
    ),
    ...orKeys.map((key, i) =>
      callOpenRouterKey(key, prompt).then(raw => ({ provider: `openrouter-${i + 1}`, raw }))
    ),
  ]

  if (calls.length === 0) throw new Error('No API keys configured')

  const results = await Promise.allSettled(calls)

  const successes = results
    .filter((r): r is PromiseFulfilledResult<{ provider: string; raw: string }> => r.status === 'fulfilled')
    .sort((a, b) => {
      const rank = (p: string) => p.startsWith('gemini') ? 0 : p.startsWith('groq') ? 1 : 2
      return rank(a.value.provider) - rank(b.value.provider)
    })

  for (const result of successes) {
    try {
      const clips = parseClips(result.value.raw)
      if (clips.length > 0) {
        console.log(`[analyze] winner: ${result.value.provider} with ${clips.length} clips`)
        return { clips, provider: result.value.provider }
      }
    } catch { continue }
  }

  throw new Error('All API keys failed or returned no clips')
}

function tsToSeconds(ts: string): number {
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const workerSecret = process.env.WORKER_SECRET ?? ''
    let userId: string

    const isServiceCall = workerSecret && token === workerSecret
    
    if (isServiceCall) {
      const bodyClone = await req.clone().json()
      userId = bodyClone.userId ?? 'service'
    } else {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token)
      if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      userId = user.id
    }

    // Only check quota for real user calls, not worker service calls
    if (!isServiceCall) {
      const quota = await checkQuota(userId)
      if (!quota.allowed) return NextResponse.json({ error: quota.message, quota }, { status: 429 })
    }

    const body = await req.json()
    const { jobId, transcript, videoTitle, mode = 'auto', names = '' } = body
    if (!jobId || !transcript) return NextResponse.json({ error: 'jobId and transcript required' }, { status: 400 })

    await supabase.from('jobs').update({ status: 'analyzing', progress: 50, progress_msg: 'AI analyzing transcript...' }).eq('id', jobId)

    const contextBlock = videoTitle ? `VIDEO TITLE: "${videoTitle}"\n` : ''
    const namesBlock = names ? `People in this video: ${names}\n` : ''
    let promptTemplate = AI_PROMPT
    if (mode === 'interview') promptTemplate = INTERVIEW_CLIP_PROMPT
    if (mode === 'auto_edit') promptTemplate = AUTO_EDIT_PROMPT

    const prompt = fillPrompt(promptTemplate, {
      context_block: contextBlock, names_block: namesBlock, names,
      transcript: transcript.slice(0, 80000),
      target_sec: '600', target_min: '10', min_seg_sec: '60',
      score_desc: 'drama, entertainment value, viral potential', order: 'chronological',
    })

    const { clips, provider } = await analyzeWithAllKeys(prompt)

    const clipRows = (clips as Record<string, unknown>[]).map((clip) => ({
      job_id: jobId, user_id: userId,
      title: clip.title as string, summary: clip.summary as string, reason: clip.reason as string,
      start_ts: clip.start as string, end_ts: clip.end as string,
      score: clip.score as number, hook: clip.hook as number,
      engagement: clip.engagement as number, shareability: clip.shareability as number,
      speaker: clip.speaker as string,
      duration_sec: tsToSeconds(clip.end as string) - tsToSeconds(clip.start as string),
    }))

    const { error: insertError } = await supabase.from('clips').insert(clipRows)
    if (insertError) throw insertError

    await supabase.from('jobs').update({
      status: 'cutting', progress: 70,
      progress_msg: `Found ${clips.length} clips via ${provider} — cutting...`,
      clips_found: clips.length,
    }).eq('id', jobId)

    if (!isServiceCall) await incrementQuota(userId)
    return NextResponse.json({ success: true, clips: clipRows, count: clips.length, provider })

  } catch (err) {
    console.error('[analyze] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
