// src/app/api/admin/users/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()

  const { data, error: dbError } = await supabase
    .from('profiles')
    .select('id, email, tier, is_admin, clips_today, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ users: data })
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { userId, tier, is_admin } = await req.json()

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (tier) updates.tier = tier
  if (typeof is_admin === 'boolean') updates.is_admin = is_admin

  const { error: dbError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// Admin password reset for any user
export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { userId, newPassword, remove2fa } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  if (newPassword) {
    const { error: e } = await supabase.auth.admin.updateUserById(userId, { password: newPassword })
    if (e) return NextResponse.json({ error: e.message }, { status: 500 })
  }

  if (remove2fa) {
    // Get all MFA factors for user and unenroll them
    const { data: factors } = await supabase.auth.admin.mfa.listFactors({ userId })
    for (const factor of factors?.totp ?? []) {
      await supabase.auth.admin.mfa.deleteFactor({ userId, id: factor.id })
    }
  }

  return NextResponse.json({ success: true })
}
