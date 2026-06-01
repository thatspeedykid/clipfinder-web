// src/lib/r2.ts
// Shared R2 pre-signed URL generator — bucket is PRIVATE, use these for <video> src
import crypto from 'crypto'

export function r2SignedUrl(storagePath: string, ttlSeconds = 900): string {
  const accountId = process.env.R2_ACCOUNT_ID ?? ''
  const accessKey = process.env.R2_ACCESS_KEY_ID ?? ''
  const secretKey = process.env.R2_SECRET_ACCESS_KEY ?? ''
  const bucket    = process.env.R2_BUCKET_NAME ?? 'clipfinder-clips'

  const now       = new Date()
  const pad       = (n: number) => String(n).padStart(2, '0')
  const dateStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}`
  const amzDate   = `${dateStamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const host      = `${accountId}.r2.cloudflarestorage.com`
  const encodedPath = '/' + bucket + '/' + storagePath.split('/').map(encodeURIComponent).join('/')
  const credScope = `${dateStamp}/auto/s3/aws4_request`

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
    'X-Amz-Credential':    `${accessKey}/${credScope}`,
    'X-Amz-Date':          amzDate,
    'X-Amz-Expires':       String(ttlSeconds),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQS = Object.keys(queryParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`).join('&')

  const canonicalRequest = ['GET', encodedPath, canonicalQS, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')

  const hmac = (key: Buffer | string, data: string): Buffer =>
    crypto.createHmac('sha256', key).update(data).digest()
  const signingKey = hmac(hmac(hmac(hmac(Buffer.from('AWS4' + secretKey, 'utf8'), dateStamp), 'auto'), 's3'), 'aws4_request')
  const signature  = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return `https://${host}${encodedPath}?${canonicalQS}&X-Amz-Signature=${signature}`
}
