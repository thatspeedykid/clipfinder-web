// src/app/api/admin/clips/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { S3Client, DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME ?? 'clipfinder-clips'
  if (!accountId || !accessKeyId || !secretAccessKey) return { s3: null, bucket }
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return { s3, bucket }
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
  const { s3, bucket } = getR2Client()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { clipId, storagePath, deleteAll, force } = body as { clipId?: string; storagePath?: string; deleteAll?: boolean; force?: boolean }

  if (deleteAll) {
    let query = supabase.from('clips').select('id, storage_path')
    if (!force) query = query.lt('file_expires_at', new Date().toISOString()).not('storage_path', 'is', null)

    const { data: toDelete, error: fetchErr } = await query
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

    const clips = toDelete ?? []
    let deleted = 0
    let storageDeleted = 0

    // Batch delete from R2
    const paths = clips.filter(c => c.storage_path).map(c => ({ Key: c.storage_path as string }))
    if (paths.length > 0 && s3) {
      try {
        await s3.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: paths }
        }))
        storageDeleted = paths.length
      } catch (e) {
        console.error('[purge] R2 batch delete error:', e)
      }
    }

    // Update DB
    for (const clip of clips) {
      const { error: upErr } = await supabase.from('clips')
        .update({ file_url: null, storage_path: null, file_expires_at: null })
        .eq('id', clip.id)
      if (!upErr) deleted++
    }

    return NextResponse.json({ success: true, deleted, storageDeleted })
  }

  // Single delete
  if (!clipId) return NextResponse.json({ error: 'clipId required' }, { status: 400 })

  if (storagePath && s3) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: storagePath as string }))
    } catch (e) {
      console.error('[delete] R2 error:', e)
    }
  }

  const { error: updateErr } = await supabase.from('clips')
    .update({ file_url: null, storage_path: null, file_expires_at: null })
    .eq('id', clipId)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
