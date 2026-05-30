// src/app/api/google-drive/callback/route.ts
// Step 2 of Google Drive OAuth — Google redirects here with auth code
// Exchanges code for access + refresh tokens, saves to user_secrets table

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const REDIRECT_URI = `${APP_URL}/api/google-drive/callback`

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const errorParam = req.nextUrl.searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(`${APP_URL}/settings?drive_error=${encodeURIComponent(errorParam)}`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/settings?drive_error=missing_params`)
  }

  try {
    // Decode state to get userId
    const { userId } = JSON.parse(Buffer.from(state, 'base64url').toString())
    if (!userId) throw new Error('No userId in state')

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('[google-drive/callback] token exchange failed:', err)
      return NextResponse.redirect(`${APP_URL}/settings?drive_error=token_exchange_failed`)
    }

    const tokens = await tokenRes.json()
    const { access_token, refresh_token, expires_in } = tokens

    // Get user's Drive info (email, folder name)
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const driveProfile = profileRes.ok ? await profileRes.json() : {}

    // Save tokens to user_secrets
    const supabase = createAdminClient()
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString()

    await supabase
      .from('user_secrets')
      .upsert({
        user_id: userId,
        gdrive_access_token: access_token,
        gdrive_refresh_token: refresh_token ?? null,
        gdrive_token_expires_at: expiresAt,
        gdrive_email: driveProfile.email ?? null,
        gdrive_connected_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    // Update profiles to mark Drive as connected
    await supabase
      .from('profiles')
      .update({ gdrive_connected: true, gdrive_email: driveProfile.email ?? null })
      .eq('id', userId)

    return NextResponse.redirect(`${APP_URL}/settings?drive_connected=1`)

  } catch (err) {
    console.error('[google-drive/callback] error:', err)
    return NextResponse.redirect(`${APP_URL}/settings?drive_error=internal_error`)
  }
}
