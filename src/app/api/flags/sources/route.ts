// src/app/api/flags/sources/route.ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('feature_flags')
      .select('key, enabled')
      .in('key', ['source_youtube', 'source_kick', 'source_twitch', 'source_twitter'])

    const flags = Object.fromEntries((data ?? []).map(f => [f.key, f.enabled]))
    return NextResponse.json({
      youtube: flags.source_youtube ?? true,
      kick:    flags.source_kick    ?? true,
      twitch:  flags.source_twitch  ?? true,
      twitter: flags.source_twitter ?? true,
    })
  } catch {
    return NextResponse.json({ youtube: true, kick: true, twitch: true, twitter: true })
  }
}
