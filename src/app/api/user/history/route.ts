// src/app/api/user/history/route.ts
// Lets users delete their own job history + associated clips
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import crypto from 'crypto'

async function r2Delete(storagePath: string): Promise<boolean> {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME ?? 'clipfinder-clips'
  if (!accountId || !accessKeyId || !secretAccessKey || !storagePath) {
    console.log('[r2Delete] missing credentials, accountId:', !!accountId)
    return false
  }
  try {
    const crypto = require('crypto')
    const now = new Date()
    const pad = (s: string) => s.replace(/[:\-]/g, '').replace(/\.\d{3}/, '').slice(0,15) + 'Z'
    const date = pad(now.toISOString())
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
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    const url = `https://${host}${path}`
    console.log('[r2Delete] deleting:', url.slice(0, 80))
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': authorization, 'x-amz-date': date, 'x-amz-content-sha256': payloadHash, 'Host': host },
    })
    console.log('[r2Delete] status:', res.status, storagePath.slice(0, 40))
    return res.ok || res.status === 204 || res.status === 404
  } catch (e) {
    console.error('[r2Delete] error:', e)
    return false
  }
}


export async function DELETE(req: NextRequest) {
  const supabase = createAdminClient()
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { jobId } = body as { jobId?: string }

  if (jobId) {
    // Delete single job + its clips
    const { data: clips } = await supabase.from('clips').select('id, storage_path').eq('job_id', jobId).eq('user_id', user.id)
    await Promise.all((clips ?? []).filter(c => c.storage_path).map(c => r2Delete(c.storage_path!)))
    await supabase.from('clips').delete().eq('job_id', jobId).eq('user_id', user.id)
    await supabase.from('jobs').delete().eq('id', jobId).eq('user_id', user.id)
    return NextResponse.json({ success: true, deleted: clips?.length ?? 0 })
  }

  // Delete ALL jobs + clips for this user
  const { data: allClips } = await supabase.from('clips').select('id, storage_path').eq('user_id', user.id)
  await Promise.all((allClips ?? []).filter(c => c.storage_path).map(c => r2Delete(c.storage_path!)))
  await supabase.from('clips').delete().eq('user_id', user.id)
  await supabase.from('jobs').delete().eq('user_id', user.id)

  return NextResponse.json({ success: true, deleted: allClips?.length ?? 0 })
}
