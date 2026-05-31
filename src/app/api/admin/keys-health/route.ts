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

async function testGemini(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Say ok' }] }], generationConfig: { maxOutputTokens: 5 } }),
        signal: AbortSignal.timeout(8000),
      }
    )
    if (res.status === 429) return { ok: false, error: 'Rate limited' }
    if (res.status === 403) return { ok: false, error: 'Invalid / quota exceeded' }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (e: unknown) { return { ok: false, error: e instanceof Error ? e.message : 'Timeout' } }
}

async function testGroq(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'Say ok' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 429) return { ok: false, error: 'Rate limited' }
    if (res.status === 401) return { ok: false, error: 'Invalid key' }
    if (!res.ok) { const d = await res.json().catch(() => ({})); return { ok: false, error: d?.error?.message ?? `HTTP ${res.status}` } }
    return { ok: true }
  } catch (e: unknown) { return { ok: false, error: e instanceof Error ? e.message : 'Timeout' } }
}

async function testOpenRouter(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct:free', messages: [{ role: 'user', content: 'Say ok' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 429) return { ok: false, error: 'Rate limited' }
    if (res.status === 401) return { ok: false, error: 'Invalid key' }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (e: unknown) { return { ok: false, error: e instanceof Error ? e.message : 'Timeout' } }
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const { searchParams } = new URL(req.url)
  const singleKey = searchParams.get('key')      // e.g. GEMINI_API_KEY_2
  const singleType = searchParams.get('type')    // gemini | groq | openrouter

  // Single key test mode
  if (singleKey && singleType) {
    const keyValue = process.env[singleKey]
    if (!keyValue) return NextResponse.json({ results: [{ name: singleKey, masked: 'not set', ok: false, error: 'Not configured' }] })
    let result: { ok: boolean; error?: string }
    if (singleType === 'gemini') result = await testGemini(keyValue)
    else if (singleType === 'groq') result = await testGroq(keyValue)
    else result = await testOpenRouter(keyValue)
    return NextResponse.json({ results: [{ name: singleKey, masked: keyValue.slice(0, 8) + '...', ...result }] })
  }

  // Test ALL keys
  const geminiKeys = getKeys('GEMINI_API_KEY')
  const groqKeys = getKeys('GROQ_API_KEY')
  const orKeys = getKeys('OPENROUTER_API_KEY')

  const [geminiResults, groqResults, orResults] = await Promise.all([
    Promise.all(geminiKeys.map((k, i) => testGemini(k).then(r => ({
      name: i === 0 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${i + 1}`,
      masked: k.slice(0, 8) + '...', ...r
    })))),
    Promise.all(groqKeys.map((k, i) => testGroq(k).then(r => ({
      name: i === 0 ? 'GROQ_API_KEY' : `GROQ_API_KEY_${i + 1}`,
      masked: k.slice(0, 8) + '...', ...r
    })))),
    Promise.all(orKeys.map((k, i) => testOpenRouter(k).then(r => ({
      name: i === 0 ? 'OPENROUTER_API_KEY' : `OPENROUTER_API_KEY_${i + 1}`,
      masked: k.slice(0, 8) + '...', ...r
    })))),
  ])

  const allResults = [...geminiResults, ...groqResults, ...orResults]
  return NextResponse.json({
    total: allResults.length,
    working: allResults.filter(r => r.ok).length,
    results: allResults,
    modal_worker_url: process.env.MODAL_WORKER_URL ? '✓ Set' : '✗ NOT SET',
  })
}
