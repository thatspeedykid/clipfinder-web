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
    console.log('[r2Delete] missing credentials')
    return false
  }
  try {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}`
    const amzDate   = `${dateStamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`

    const host = `${accountId}.r2.cloudflarestorage.com`
    const encodedPath = '/' + bucket + '/' + storagePath.split('/').map(encodeURIComponent).join('/')
    const payloadHash = crypto.createHash('sha256').update('').digest('hex')

    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = ['DELETE', encodedPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')

    const credentialScope = `${dateStamp}/auto/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')

    const hmac = (key: Buffer | string, data: string): Buffer =>
      crypto.createHmac('sha256', key).update(data).digest()
    const signingKey = hmac(hmac(hmac(hmac(Buffer.from('AWS4' + secretAccessKey, 'utf8'), dateStamp), 'auto'), 's3'), 'aws4_request')
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

    const url = `https://${host}${encodedPath}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'host': host,
      },
    })
    const ok = res.ok || res.status === 204 || res.status === 404
    if (!ok) {
      const body = await res.text().catch(() => '')
      console.error(`[r2Delete] FAILED ${res.status} ${storagePath.slice(0,50)} — ${body.slice(0,300)}`)
    } else {
      console.log(`[r2Delete] ✓ ${res.status} deleted ${storagePath.slice(0,50)}`)
    }
    return ok
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
    // Verify job belongs to user first
    const { data: job } = await supabase.from('jobs').select('id').eq('id', jobId).eq('user_id', user.id).single()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    // Get ALL clips for this job (don't filter by user_id - worker may set different user_id on combined clips)
    const { data: clips } = await supabase.from('clips').select('id, storage_path').eq('job_id', jobId)
    console.log(`[history] deleting job ${jobId}: ${clips?.length ?? 0} clips`)

    // Delete from R2
    const storagePaths = (clips ?? []).filter(c => c.storage_path).map(c => c.storage_path!)
    console.log(`[history] R2 paths to delete:`, storagePaths)
    await Promise.all(storagePaths.map(p => r2Delete(p)))

    // Delete from DB
    await supabase.from('clips').delete().eq('job_id', jobId)
    await supabase.from('jobs').delete().eq('id', jobId).eq('user_id', user.id)
    return NextResponse.json({ success: true, deleted: clips?.length ?? 0 })
  }

  // Delete ALL jobs + clips for this user
  // Get all job IDs for this user first
  const { data: userJobs } = await supabase.from('jobs').select('id').eq('user_id', user.id)
  const jobIds = (userJobs ?? []).map(j => j.id)

  // Get ALL clips for these jobs (catches combined clips with different user_id)
  let allClips: {id: string, storage_path?: string}[] = []
  if (jobIds.length > 0) {
    const { data } = await supabase.from('clips').select('id, storage_path').in('job_id', jobIds)
    allClips = data ?? []
  }
  // Also get any clips directly tied to user
  const { data: directClips } = await supabase.from('clips').select('id, storage_path').eq('user_id', user.id)
  const allToDelete = [...allClips, ...(directClips ?? [])].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)

  console.log(`[history] clearing all: ${allToDelete.length} clips`)
  await Promise.all(allToDelete.filter(c => c.storage_path).map(c => r2Delete(c.storage_path!)))
  if (jobIds.length > 0) await supabase.from('clips').delete().in('job_id', jobIds)
  await supabase.from('clips').delete().eq('user_id', user.id)
  await supabase.from('jobs').delete().eq('user_id', user.id)

  return NextResponse.json({ success: true, deleted: allClips?.length ?? 0 })
}
