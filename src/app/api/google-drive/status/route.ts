// src/app/api/google-drive/status/route.ts
// GET  — return Drive connection status for settings page
// DELETE — disconnect Drive (revoke + clear tokens)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('gdrive_connected, gdrive_email')
      .eq('id', user.id)
      .single()

    return NextResponse.json({
      connected: profile?.gdrive_connected ?? false,
      email: profile?.gdrive_email ?? null,
    })
  } catch (err) {
    console.error('[google-drive/status] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get token to revoke it with Google
    const { data: secrets } = await supabase
      .from('user_secrets')
      .select('gdrive_access_token')
      .eq('user_id', user.id)
      .single()

    if (secrets?.gdrive_access_token) {
      // Best-effort revoke
      fetch(`https://oauth2.googleapis.com/revoke?token=${secrets.gdrive_access_token}`, { method: 'POST' })
        .catch(() => {})
    }

    // Clear tokens
    await supabase
      .from('user_secrets')
      .update({
        gdrive_access_token: null,
        gdrive_refresh_token: null,
        gdrive_token_expires_at: null,
        gdrive_email: null,
        gdrive_connected_at: null,
      })
      .eq('user_id', user.id)

    await supabase
      .from('profiles')
      .update({ gdrive_connected: false, gdrive_email: null })
      .eq('id', user.id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[google-drive/disconnect] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
