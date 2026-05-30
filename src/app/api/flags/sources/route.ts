// src/app/api/flags/sources/route.ts
// Returns ALL feature flags relevant to the dashboard UI
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('feature_flags')
      .select('key, enabled')

    const flags = Object.fromEntries((data ?? []).map((f: {key: string, enabled: boolean}) => [f.key, f.enabled]))

    const get = (key: string, def = true) => flags[key] !== undefined ? flags[key] : def

    return NextResponse.json({
      // Sources
      youtube:  get('source_youtube', false),
      kick:     get('source_kick', true),
      twitch:   get('source_twitch', true),
      twitter:  get('source_twitter', true),
      // Clip modes
      mode_auto:      get('mode_auto', true),
      mode_interview: get('mode_interview', true),
      mode_auto_edit: get('mode_auto_edit', true),
      // Features
      post_bridge:    get('feature_post_studio', true),
      post_scheduler: get('feature_post_scheduler', false),
      google_drive:   get('feature_google_drive', false),
      extension:      get('feature_extension', false),
    })
  } catch {
    return NextResponse.json({
      youtube: false, kick: true, twitch: true, twitter: true,
      mode_auto: true, mode_interview: true, mode_auto_edit: true,
      post_bridge: true, post_scheduler: false, google_drive: false, extension: false,
    })
  }
}
