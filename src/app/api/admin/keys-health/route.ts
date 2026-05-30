// src/app/api/admin/keys-health/route.ts
// Tests each configured AI API key and returns status
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'

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

async function testGemini(key: string): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say "ok" in one word.' }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
        signal: AbortSignal.timeout(8000),
      }
    )
    if (res.status === 429) return { ok: false, error: 'Rate limited' }
    if (res.status === 403) return { ok: false, error: 'Invalid key or quota exceeded' }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, model: 'gemini-2.5-flash' }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Timeout' }
  }
}

async function testGroq(key: string): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Say "ok".' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 429) return { ok: false, error: 'Rate limited' }
    if (res.status === 401) return { ok: false, error: 'Invalid key' }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      return { ok: false, error: d?.error?.message ?? `HTTP ${res.status}` }
    }
    return { ok: true, model: 'llama-3.3-70b' }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Timeout' }
  }
}

async function testOpenRouter(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [{ role: 'user', content: 'Say "ok".' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 429) return { ok: false, error: 'Rate limited' }
    if (res.status === 401) return { ok: false, error: 'Invalid key' }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Timeout' }
  }
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const geminiKeys = getKeys('GEMINI_API_KEY')
  const groqKeys = getKeys('GROQ_API_KEY')
  const orKeys = getKeys('OPENROUTER_API_KEY')

  const [geminiResults, groqResults, orResults] = await Promise.all([
    Promise.all(geminiKeys.map((k, i) => testGemini(k).then(r => ({ name: `Gemini #${i + 1}`, masked: k.slice(0, 8) + '...', ...r })))),
    Promise.all(groqKeys.map((k, i) => testGroq(k).then(r => ({ name: `Groq #${i + 1}`, masked: k.slice(0, 8) + '...', ...r })))),
    Promise.all(orKeys.map((k, i) => testOpenRouter(k).then(r => ({ name: `OpenRouter #${i + 1}`, masked: k.slice(0, 8) + '...', ...r })))),
  ])

  const allResults = [...geminiResults, ...groqResults, ...orResults]
  const workingCount = allResults.filter(r => r.ok).length

  return NextResponse.json({
    total: allResults.length,
    working: workingCount,
    results: allResults,
    modal_worker_url: process.env.MODAL_WORKER_URL ? '✓ Set' : '✗ NOT SET — extension jobs will get stuck in queued!',
  })
}
