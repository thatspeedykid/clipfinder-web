// src/app/api/flags/auth/route.ts
// Public route — returns auth flags for the login page (no auth required)
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('feature_flags')
      .select('key, enabled')
      .in('key', ['auth_google_oauth', 'auth_magic_link'])

    const flags = Object.fromEntries((data ?? []).map(f => [f.key, f.enabled]))
    return NextResponse.json({
      google_oauth: flags.auth_google_oauth ?? false,
      magic_link: flags.auth_magic_link ?? true,
    })
  } catch {
    return NextResponse.json({ google_oauth: false, magic_link: true })
  }
}
