import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import crypto from 'crypto'

async function r2Delete(storagePath: string): Promise<boolean> {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME ?? 'clipfinder-clips'
  if (!accountId || !accessKeyId || !secretAccessKey || !storagePath) {
    console.log('[r2Delete] missing credentials')
    return false
  }
  try {
    const crypto = require('crypto')
    const now = new Date()
    const date = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 15) + 'Z'
    const dateShort = date.slice(0, 8)
    const host = `${accountId}.r2.cloudflarestorage.com`
    const path = `/${bucket}/${storagePath}`
    const payloadHash = crypto.createHash('sha256').update('').digest('hex')
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = ['DELETE', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const credentialScope = `${dateShort}/auto/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', date, credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
    const hmac = (key: Buffer | string, data: string) => crypto.createHmac('sha256', key).update(data).digest()
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, dateShort), 'auto'), 's3'), 'aws4_request')
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const url = `https://${host}${path}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-date': date,
        'x-amz-content-sha256': payloadHash,
        Host: host,
      },
    })
    const ok = res.ok || res.status === 204 || res.status === 404
    console.log(`[r2Delete] ${ok ? '✓' : '✗'} ${res.status} ${storagePath.slice(0, 50)}`)
    return ok
  } catch (e) {
    console.error('[r2Delete] error:', e)
    return false
  }
}


async function deleteClipsFromR2AndDB(supabase: ReturnType<typeof createAdminClient>, clips: {id: string, storage_path?: string | null}[]) {
  // Delete from R2 in parallel
  await Promise.all(clips.filter(c => c.storage_path).map(c => r2Delete(c.storage_path!)))
  // Delete rows from DB entirely
  const ids = clips.map(c => c.id)
  if (ids.length > 0) {
    await supabase.from('clips').delete().in('id', ids)
  }
  return ids.length
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
  const { clipId, storagePath, deleteAll, expiredOnly } = body as {
    clipId?: string; storagePath?: string; deleteAll?: boolean; expiredOnly?: boolean
  }

  if (deleteAll) {
    // Get all clips or just expired
    let query = supabase.from('clips').select('id, storage_path')
    if (expiredOnly) query = query.lt('file_expires_at', new Date().toISOString())
    const { data: clips, error: fetchErr } = await query
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    const deleted = await deleteClipsFromR2AndDB(supabase, clips ?? [])
    return NextResponse.json({ success: true, deleted })
  }

  // Single clip delete
  if (!clipId) return NextResponse.json({ error: 'clipId required' }, { status: 400 })
  if (storagePath) await r2Delete(storagePath)
  await supabase.from('clips').delete().eq('id', clipId)
  return NextResponse.json({ success: true })
}
