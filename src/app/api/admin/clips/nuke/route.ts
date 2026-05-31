import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import crypto from 'crypto'

async function r2Delete(storagePath: string): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME ?? 'clipfinder-clips'
  if (!accountId || !accessKeyId || !secretAccessKey || !storagePath) return
  try {
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
    await fetch(`https://${host}${path}`, {
      method: 'DELETE',
      headers: {
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-date': date,
        'x-amz-content-sha256': payloadHash,
        Host: host,
      },
    })
  } catch (e) {
    console.error('[nuke] r2Delete error:', e)
  }
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error
  const supabase = createAdminClient()

  // Get all clips with storage paths first
  const { data: clips } = await supabase
    .from('clips')
    .select('id, storage_path')
    .not('storage_path', 'is', null)

  // Delete from R2 in parallel
  if (clips?.length) {
    console.log(`[nuke] deleting ${clips.length} files from R2`)
    await Promise.all(clips.map(c => r2Delete(c.storage_path!)))
    console.log(`[nuke] R2 deletion complete`)
  }

  // Delete ALL rows from DB
  const { error: delErr, count } = await supabase
    .from('clips')
    .delete({ count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  return NextResponse.json({ success: true, deleted: count, r2Deleted: clips?.length ?? 0 })
}
