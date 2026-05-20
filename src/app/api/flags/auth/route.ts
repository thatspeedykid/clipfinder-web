// src/app/api/flags/auth/route.ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('feature_flags')
      .select('key, enabled')
      .in('key', ['auth_google_oauth', 'auth_magic_link', 'auth_email_password', 'auth_forgot_password', 'auth_2fa_totp', 'auth_email_verification'])

    const flags = Object.fromEntries((data ?? []).map(f => [f.key, f.enabled]))
    return NextResponse.json({
      google_oauth:       flags.auth_google_oauth       ?? false,
      magic_link:         flags.auth_magic_link         ?? true,
      email_password:     flags.auth_email_password     ?? true,
      forgot_password:    flags.auth_forgot_password    ?? true,
      totp_2fa:           flags.auth_2fa_totp           ?? true,
      email_verification: flags.auth_email_verification ?? false,
    })
  } catch {
    return NextResponse.json({ google_oauth: false, magic_link: true, email_password: true, forgot_password: true, totp_2fa: true })
  }
}
