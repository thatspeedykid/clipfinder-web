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
    .select(`id, title, file_url, file_size_mb, file_expires_at, storage_path, created_at, user_id, profiles ( email, tier ), jobs ( video_title, source_url )`)
    .order('created_at', { ascending: false })
    .limit(200)

  if (expired) query = query.lt('file_expires_at', new Date().toISOString())

  const { data, error: dbError } = await query
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ clips: data ?? [] })
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const body = await req.json()
  const { clipId, storagePath, deleteAll, force } = body

  if (deleteAll) {
    // Get all clips (or just expired)
    let query = supabase.from('clips').select('id, storage_path')
    if (!force) {
      query = query.lt('file_expires_at', new Date().toISOString())
    }
    const { data: toDelete, error: fetchErr } = await query
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

    let deleted = 0
    const clips = toDelete ?? []

    // Delete from storage bucket
    const withStorage = clips.filter(c => c.storage_path).map(c => c.storage_path as string)
    if (withStorage.length > 0) {
      await supabase.storage.from('clips').remove(withStorage)
    }

    // Clear file fields on ALL matched clips
    for (const clip of clips) {
      await supabase.from('clips')
        .update({ file_url: null, storage_path: null, file_expires_at: null })
        .eq('id', clip.id)
      deleted++
    }

    return NextResponse.json({ success: true, deleted })
  }

  // Single clip delete
  if (!clipId) return NextResponse.json({ error: 'clipId required' }, { status: 400 })

  if (storagePath) {
    await supabase.storage.from('clips').remove([storagePath])
  }

  const { error: updateErr } = await supabase
    .from('clips')
    .update({ file_url: null, storage_path: null, file_expires_at: null })
    .eq('id', clipId)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
