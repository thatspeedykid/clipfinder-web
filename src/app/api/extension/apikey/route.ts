// src/app/api/extension/apikey/route.ts
// Manage the user's extension API key (generate, revoke, view)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

function generateApiKey(): string {
  // Format: cf_live_<32 random hex chars>
  return `cf_live_${randomBytes(16).toString('hex')}`
}

// GET — return current API key (masked) + usage info
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('extension_api_key, extension_api_key_created_at')
      .eq('id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const key = profile.extension_api_key
    return NextResponse.json({
      has_key: !!key,
      // Show first 12 chars + masked rest so user can identify it
      key_preview: key ? `${key.slice(0, 12)}${'•'.repeat(key.length - 12)}` : null,
      // Return full key only on initial generation (handled in POST)
      created_at: profile.extension_api_key_created_at ?? null,
    })
  } catch (err) {
    console.error('[extension/apikey GET] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — generate a new API key (rotates existing one)
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const newKey = generateApiKey()

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        extension_api_key: newKey,
        extension_api_key_created_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('[extension/apikey POST] update error:', updateError)
      return NextResponse.json({ error: 'Failed to generate API key' }, { status: 500 })
    }

    // Return full key once — user must copy it now
    return NextResponse.json({
      success: true,
      key: newKey,
      message: 'Copy this key now — it will not be shown again in full.',
    })
  } catch (err) {
    console.error('[extension/apikey POST] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — revoke API key
export async function DELETE(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await supabase
      .from('profiles')
      .update({ extension_api_key: null, extension_api_key_created_at: null })
      .eq('id', user.id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[extension/apikey DELETE] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
