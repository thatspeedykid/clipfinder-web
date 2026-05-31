import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const { data: expired } = await supabase
    .from('clips').select('id, storage_path')
    .lt('file_expires_at', new Date().toISOString())
    .not('storage_path', 'is', null)
  if (!expired?.length) return NextResponse.json({ cleaned: 0 })
  await Promise.all(expired.map(c => r2Delete(c.storage_path!)))
  await supabase.from('clips').delete().in('id', expired.map(c => c.id))
  console.log(`[cron] cleaned ${expired.length} expired clips`)
  return NextResponse.json({ cleaned: expired.length })
}
