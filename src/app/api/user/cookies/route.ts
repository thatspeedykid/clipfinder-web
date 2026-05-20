// src/app/api/user/cookies/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { cookies } = await req.json()
    if (!cookies?.trim()) return NextResponse.json({ error: 'cookies required' }, { status: 400 })

    // Save cookies to user_secrets table
    await supabase.from('user_secrets').upsert({
      user_id: user.id,
      yt_cookies: cookies.trim(),
      updated_at: new Date().toISOString(),
    })

    // Update saved_at on profile so we can check expiry
    await supabase.from('profiles').update({
      yt_cookie_saved_at: new Date().toISOString(),
    }).eq('id', user.id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[user/cookies] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('yt_cookie_saved_at')
      .eq('id', user.id)
      .single()

    return NextResponse.json({
      has_cookies: !!profile?.yt_cookie_saved_at,
      saved_at: profile?.yt_cookie_saved_at ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
