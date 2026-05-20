// src/app/api/admin/config/route.ts
// Read and write API keys + config from the DB
// This lets you manage keys from the admin dashboard instead of Vercel

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()

  const { data, error: dbError } = await supabase
    .from('config')
    .select('key, value, label, group_name, is_secret, updated_at')
    .order('group_name')

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  // Mask secret values — show last 6 chars only
  const masked = data?.map(row => ({
    ...row,
    value: row.is_secret && row.value
      ? '•'.repeat(Math.max(0, row.value.length - 6)) + row.value.slice(-6)
      : row.value,
    hasValue: !!row.value,
  }))

  return NextResponse.json({ config: masked })
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { key, value } = await req.json()

  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  const { error: dbError } = await supabase
    .from('config')
    .upsert({ key, value, updated_at: new Date().toISOString() })
    .eq('key', key)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { key } = await req.json()

  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  // Clear value but keep the row
  const { error: dbError } = await supabase
    .from('config')
    .update({ value: '', updated_at: new Date().toISOString() })
    .eq('key', key)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
