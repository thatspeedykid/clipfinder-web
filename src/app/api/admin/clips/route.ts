// src/app/api/admin/clips/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { searchParams } = new URL(req.url)
  const expired = searchParams.get('expired') === 'true'

  let query = supabase
    .from('clips')
    .select(`
      id, title, file_url, file_size_mb, file_expires_at,
      storage_path, created_at, user_id,
      profiles ( email, tier ),
      jobs ( video_title, source_url )
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (expired) {
    query = query.lt('file_expires_at', new Date().toISOString())
  }

  const { data, error: dbError } = await query
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ clips: data ?? [] })
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { clipId, storagePath, deleteAll } = await req.json()

  if (deleteAll) {
    // Delete all expired clips
    const { data: expired } = await supabase.rpc('get_expired_clips')
    let deleted = 0
    for (const clip of expired ?? []) {
      if (clip.storage_path) {
        await supabase.storage.from('clips').remove([clip.storage_path])
      }
      await supabase.from('clips').update({ file_url: null, storage_path: null }).eq('id', clip.id)
      deleted++
    }
    return NextResponse.json({ success: true, deleted })
  }

  if (!clipId) return NextResponse.json({ error: 'clipId required' }, { status: 400 })

  // Delete from storage
  if (storagePath) {
    await supabase.storage.from('clips').remove([storagePath])
  }

  // Clear file fields but keep clip record
  await supabase
    .from('clips')
    .update({ file_url: null, storage_path: null, file_expires_at: null })
    .eq('id', clipId)

  return NextResponse.json({ success: true })
}
