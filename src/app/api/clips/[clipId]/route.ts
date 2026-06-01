// src/app/api/clips/[clipId]/route.ts
// Allows users to edit their clip title and summary
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { clipId: string } }
) {
  try {
    const supabase = createAdminClient()
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { clipId } = params
    const body = await req.json()
    const { title, summary } = body as { title?: string; summary?: string }

    // Verify clip belongs to this user via job ownership
    const { data: clip } = await supabase
      .from('clips').select('id, job_id').eq('id', clipId).single()
    if (!clip) return NextResponse.json({ error: 'Clip not found' }, { status: 404 })

    const { data: job } = await supabase
      .from('jobs').select('user_id').eq('id', clip.job_id).single()
    if (!job || job.user_id !== user.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const updates: Record<string, string> = {}
    if (typeof title === 'string' && title.trim()) updates.title = title.trim()
    if (typeof summary === 'string') updates.summary = summary.trim()

    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    await supabase.from('clips').update(updates).eq('id', clipId)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[clips PATCH] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
