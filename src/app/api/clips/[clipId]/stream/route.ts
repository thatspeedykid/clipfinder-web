// src/app/api/clips/[clipId]/stream/route.ts
// Authenticated R2 stream proxy — bucket is PRIVATE, this is the only way to get a video URL.
// Verifies the requesting user owns the clip, then redirects to a 15-min pre-signed R2 URL.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import crypto from 'crypto'

const SIGNED_URL_TTL = 900 // 15 minutes in seconds

function r2SignedUrl(storagePath: string): string {
  const accountId  = process.env.R2_ACCOUNT_ID ?? ''
  const accessKey  = process.env.R2_ACCESS_KEY_ID ?? ''
  const secretKey  = process.env.R2_SECRET_ACCESS_KEY ?? ''
  const bucket     = process.env.R2_BUCKET_NAME ?? 'clipfinder-clips'

  const now        = new Date()
  const pad        = (n: number) => String(n).padStart(2, '0')
  const dateStamp  = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}`
  const amzDate    = `${dateStamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const host       = `${accountId}.r2.cloudflarestorage.com`
  const encodedPath = '/' + bucket + '/' + storagePath.split('/').map(encodeURIComponent).join('/')
  const credScope  = `${dateStamp}/auto/s3/aws4_request`

  // Canonical query string for pre-signed URL
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
    'X-Amz-Credential':    `${accessKey}/${credScope}`,
    'X-Amz-Date':          amzDate,
    'X-Amz-Expires':       String(SIGNED_URL_TTL),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&')

  const canonicalRequest = [
    'GET',
    encodedPath,
    canonicalQueryString,
    `host:${host}\n`,   // canonical headers
    'host',             // signed headers
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const hmac = (key: Buffer | string, data: string): Buffer =>
    crypto.createHmac('sha256', key).update(data).digest()
  const signingKey = hmac(hmac(hmac(hmac(Buffer.from('AWS4' + secretKey, 'utf8'), dateStamp), 'auto'), 's3'), 'aws4_request')
  const signature  = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return `https://${host}${encodedPath}?${canonicalQueryString}&X-Amz-Signature=${signature}`
}

export async function GET(
  req: NextRequest,
  { params }: { params: { clipId: string } }
) {
  try {
    const supabase = createAdminClient()

    // Auth — bearer token or session cookie
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { clipId } = params

    // Fetch clip
    const { data: clip, error: clipErr } = await supabase
      .from('clips')
      .select('id, job_id, storage_path, file_expires_at')
      .eq('id', clipId)
      .single()

    if (clipErr || !clip) return NextResponse.json({ error: 'Clip not found' }, { status: 404 })
    if (!clip.storage_path) return NextResponse.json({ error: 'No file' }, { status: 404 })

    // Verify ownership via job
    const { data: job } = await supabase
      .from('jobs')
      .select('user_id')
      .eq('id', clip.job_id)
      .single()

    if (!job || job.user_id !== user.id) {
      // Admins can access anything
      const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
      if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check expiry
    if (clip.file_expires_at && new Date(clip.file_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Clip expired' }, { status: 410 })
    }

    // Generate pre-signed URL and redirect
    const signedUrl = r2SignedUrl(clip.storage_path)

    // For downloads: pass ?download=1 to set Content-Disposition
    const isDownload = req.nextUrl.searchParams.get('download') === '1'
    if (isDownload) {
      // Proxy the stream directly so browser downloads it with correct filename
      const r2Res = await fetch(signedUrl)
      if (!r2Res.ok) return NextResponse.json({ error: 'File unavailable' }, { status: 502 })
      const filename = `clip-${clipId.slice(0, 8)}.mp4`
      return new NextResponse(r2Res.body, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': r2Res.headers.get('Content-Length') ?? '',
          'Cache-Control': 'private, no-store',
        },
      })
    }

    // For video playback: 302 redirect to signed URL (browser streams directly from R2)
    return NextResponse.redirect(signedUrl, { status: 302 })

  } catch (err) {
    console.error('[clips/stream] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
