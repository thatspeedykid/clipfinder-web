// src/app/api/admin/clips/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import crypto from 'crypto'

// Sign R2 requests using AWS Signature V4 (no SDK needed)
async function r2Delete(storagePath: string): Promise<boolean> {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME ?? 'clipfinder-clips'
  if (!accountId || !accessKeyId || !secretAccessKey) return false

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`
  const region = 'auto'
  const service = 's3'
  const now = new Date()
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateShort = date.slice(0, 8)

  const host = `${accountId}.r2.cloudflarestorage.com`
  const path = `/${bucket}/${storagePath}`

  const canonicalHeaders = `host:${host}\nx-amz-date:${date}\n`
  const signedHeaders = 'host;x-amz-date'
  const payloadHash = crypto.createHash('sha256').update('').digest('hex')

  const canonicalRequest = `DELETE\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const credentialScope = `${dateShort}/${region}/${service}/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`

  const hmac = (key: Buffer | string, data: string) =>
    crypto.createHmac('sha256', key).update(data).digest()

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateShort), region), service), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  try {
    const res = await fetch(`${endpoint}${path}`, {
      method: 'DELETE',
      headers: { 'Authorization': authorization, 'x-amz-date': date, 'Host': host },
    })
    return res.ok || res.status === 204 || res.status === 404
  } catch (e) {
    console.error('[r2 delete] error:', e)
    return false
  }
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error
  const supabase = createAdminClient()
  const { data, error: dbError } = await supabase
    .from('clips')
    .select(`id, title, file_url, file_size_mb, file_expires_at, storage_path, created_at, user_id,
      profiles ( email, tier ), jobs ( video_title, source_url )`)
    .order('created_at', { ascending: false })
    .limit(200)
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ clips: data ?? [] })
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error
  const supabase = createAdminClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { clipId, storagePath, deleteAll, force } = body as { clipId?: string; storagePath?: string; deleteAll?: boolean; force?: boolean }

  if (deleteAll) {
    let query = supabase.from('clips').select('id, storage_path')
    if (!force) query = query.lt('file_expires_at', new Date().toISOString()).not('storage_path', 'is', null)
    const { data: toDelete, error: fetchErr } = await query
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

    const clips = toDelete ?? []
    let deleted = 0; let storageDeleted = 0

    await Promise.all(clips.filter(c => c.storage_path).map(async c => {
      const ok = await r2Delete(c.storage_path!)
      if (ok) storageDeleted++
    }))

    for (const clip of clips) {
      const { error: upErr } = await supabase.from('clips')
        .update({ file_url: null, storage_path: null, file_expires_at: null }).eq('id', clip.id)
      if (!upErr) deleted++
    }
    return NextResponse.json({ success: true, deleted, storageDeleted })
  }

  if (!clipId) return NextResponse.json({ error: 'clipId required' }, { status: 400 })
  if (storagePath) await r2Delete(storagePath)
  await supabase.from('clips').update({ file_url: null, storage_path: null, file_expires_at: null }).eq('id', clipId)
  return NextResponse.json({ success: true })
}
