import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import crypto from 'crypto'

async function r2Delete(storagePath: string): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME ?? 'clipfinder-clips'
  if (!accountId || !accessKeyId || !secretAccessKey || !storagePath) return
  try {
    const now = new Date()
    const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
    const dateShort = date.slice(0, 8)
    const host = `${accountId}.r2.cloudflarestorage.com`
    const path = `/${bucket}/${storagePath}`
    const payloadHash = crypto.createHash('sha256').update('').digest('hex')
    const canonicalRequest = `DELETE\n${path}\n\nhost:${host}\nx-amz-date:${date}\n\nhost;x-amz-date\n${payloadHash}`
    const credentialScope = `${dateShort}/auto/s3/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`
    const hmac = (key: Buffer | string, data: string) => crypto.createHmac('sha256', key).update(data).digest()
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateShort), 'auto'), 's3'), 'aws4_request')
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    await fetch(`https://${host}${path}`, {
      method: 'DELETE',
      headers: {
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=host;x-amz-date, Signature=${signature}`,
        'x-amz-date': date, Host: host,
      },
    })
  } catch {}
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
