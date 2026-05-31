// src/app/api/admin/clips/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

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
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { clipId, storagePath, deleteAll, force } = body as {
    clipId?: string; storagePath?: string; deleteAll?: boolean; force?: boolean
  }

  if (deleteAll) {
    // Get clips to delete
    let query = supabase.from('clips').select('id, storage_path, file_url')
    
    if (!force) {
      // Purge expired: clips where expiry is in the past OR has a file_url (was processed)
      query = query.or(`file_expires_at.lt.${new Date().toISOString()},storage_path.not.is.null`)
        .lt('file_expires_at', new Date().toISOString())
    }
    
    const { data: toDelete, error: fetchErr } = await query
    if (fetchErr) {
      console.error('[purge] fetch error:', fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    const clips = toDelete ?? []
    let deleted = 0
    let storageDeleted = 0

    // Batch delete from storage
    const storagePaths = clips.filter(c => c.storage_path).map(c => c.storage_path as string)
    if (storagePaths.length > 0) {
      const { error: storageErr } = await supabase.storage.from('clips').remove(storagePaths)
      if (storageErr) console.error('[purge] storage delete error:', storageErr)
      else storageDeleted = storagePaths.length
    }

    // Clear file fields on all matched clips
    for (const clip of clips) {
      const { error: updateErr } = await supabase.from('clips')
        .update({ file_url: null, storage_path: null, file_expires_at: null })
        .eq('id', clip.id)
      if (!updateErr) deleted++
    }

    console.log(`[purge] deleted ${deleted} clips, ${storageDeleted} from storage`)
    return NextResponse.json({ success: true, deleted, storageDeleted })
  }

  // Single clip delete
  if (!clipId) return NextResponse.json({ error: 'clipId required' }, { status: 400 })

  if (storagePath) {
    await supabase.storage.from('clips').remove([storagePath as string])
  }

  const { error: updateErr } = await supabase.from('clips')
    .update({ file_url: null, storage_path: null, file_expires_at: null })
    .eq('id', clipId)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
