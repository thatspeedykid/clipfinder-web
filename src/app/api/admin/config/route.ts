// src/app/api/admin/config/route.ts
// Saves config keys to BOTH Supabase DB (for display) AND Vercel env vars (for runtime)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID // optional

async function upsertVercelEnvVar(key: string, value: string): Promise<{ ok: boolean; error?: string }> {
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
    return { ok: false, error: 'VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set' }
  }

  const teamQuery = VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ''
  const baseUrl = `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env${teamQuery}`

  // Check if env var already exists
  const listRes = await fetch(baseUrl, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
  })

  if (!listRes.ok) return { ok: false, error: `Vercel list failed: ${listRes.status}` }

  const { envs } = await listRes.json()
  const existing = envs?.find((e: { key: string; id: string }) => e.key === key)

  if (existing) {
    // Update existing
    const updateRes = await fetch(
      `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env/${existing.id}${teamQuery ? '?' + teamQuery.slice(1) : ''}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, type: 'encrypted', target: ['production', 'preview', 'development'] }),
      }
    )
    if (!updateRes.ok) return { ok: false, error: `Vercel update failed: ${updateRes.status}` }
  } else {
    // Create new
    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, type: 'encrypted', target: ['production', 'preview', 'development'] }),
    })
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}))
      return { ok: false, error: `Vercel create failed: ${createRes.status} ${err?.error?.message ?? ''}` }
    }
  }

  return { ok: true }
}

async function deleteVercelEnvVar(key: string): Promise<void> {
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) return
  const teamQuery = VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ''
  const listRes = await fetch(`https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env${teamQuery}`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
  })
  if (!listRes.ok) return
  const { envs } = await listRes.json()
  const existing = envs?.find((e: { key: string; id: string }) => e.key === key)
  if (!existing) return
  await fetch(
    `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env/${existing.id}${teamQuery ? '?' + teamQuery.slice(1) : ''}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
  )
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error
  const supabase = createAdminClient()
  const { data } = await supabase.from('admin_config').select('*').order('group_name').order('key')
  return NextResponse.json({ config: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error
  const supabase = createAdminClient()
  const { key, value } = await req.json()
  if (!key || !value) return NextResponse.json({ error: 'key and value required' }, { status: 400 })

  // Save to Supabase DB (masked display)
  const masked = value.length > 8 ? value.slice(0, 4) + '•'.repeat(value.length - 8) + value.slice(-4) : '••••'
  await supabase.from('admin_config').upsert({ key, value: masked, hasValue: true }, { onConflict: 'key' })

  // Push to Vercel env vars
  const vercelResult = await upsertVercelEnvVar(key, value)
  if (!vercelResult.ok) {
    console.error('[config] Vercel sync failed:', vercelResult.error)
    return NextResponse.json({ 
      success: true, 
      warning: `Saved to DB but Vercel sync failed: ${vercelResult.error}. Add VERCEL_API_TOKEN and VERCEL_PROJECT_ID to enable auto-sync.`
    })
  }

  return NextResponse.json({ success: true, vercelSynced: true })
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error
  const supabase = createAdminClient()
  const { key } = await req.json()
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  await supabase.from('admin_config').update({ value: '', hasValue: false }).eq('key', key)
  await deleteVercelEnvVar(key)

  return NextResponse.json({ success: true })
}
