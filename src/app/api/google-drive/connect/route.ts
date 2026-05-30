// src/app/api/google-drive/connect/route.ts
// Step 1 of Google Drive OAuth — redirect user to Google's consent screen
// After consent, Google redirects to /api/google-drive/callback

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const REDIRECT_URI = `${APP_URL}/api/google-drive/callback`

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',  // only files ClipFinder creates
].join(' ')

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
      ?? req.nextUrl.searchParams.get('token')

    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!GOOGLE_CLIENT_ID) {
      return NextResponse.json({ error: 'Google Drive not configured on this server.' }, { status: 503 })
    }

    // State param: encode userId so callback can identify who's connecting
    const state = Buffer.from(JSON.stringify({ userId: user.id, token })).toString('base64url')

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',   // get refresh token
      prompt: 'consent',        // always show consent so we get refresh_token
      state,
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
    return NextResponse.redirect(authUrl)

  } catch (err) {
    console.error('[google-drive/connect] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
