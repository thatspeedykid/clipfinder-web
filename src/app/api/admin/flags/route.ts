// src/app/api/admin/flags/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { clearFlagCache } from '@/lib/flags'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { data, error: dbError } = await supabase
    .from('feature_flags')
    .select('*')
    .order('group_name')
    .order('key')

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ flags: data })
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { key, enabled } = await req.json()

  if (!key || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'key and enabled required' }, { status: 400 })
  }

  const { error: dbError } = await supabase
    .from('feature_flags')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('key', key)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  // Clear the flag cache so changes take effect immediately
  clearFlagCache()

  return NextResponse.json({ success: true })
}
