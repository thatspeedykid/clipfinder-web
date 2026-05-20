// src/app/api/admin/ban/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

// Ban or unban a user
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { action, userId, reason, ip } = await req.json()

  switch (action) {
    case 'ban_user': {
      if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
      const { error: e } = await supabase
        .from('profiles')
        .update({ is_banned: true, ban_reason: reason ?? 'Banned by admin', banned_at: new Date().toISOString() })
        .eq('id', userId)
      if (e) return NextResponse.json({ error: e.message }, { status: 500 })
      return NextResponse.json({ success: true, action: 'banned' })
    }

    case 'unban_user': {
      if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
      const { error: e } = await supabase
        .from('profiles')
        .update({ is_banned: false, ban_reason: null, banned_at: null })
        .eq('id', userId)
      if (e) return NextResponse.json({ error: e.message }, { status: 500 })
      return NextResponse.json({ success: true, action: 'unbanned' })
    }

    case 'delete_user': {
      if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
      // Delete from auth (cascades to profiles via FK)
      const { error: e } = await supabase.auth.admin.deleteUser(userId)
      if (e) return NextResponse.json({ error: e.message }, { status: 500 })
      return NextResponse.json({ success: true, action: 'deleted' })
    }

    case 'block_ip': {
      if (!ip) return NextResponse.json({ error: 'ip required' }, { status: 400 })
      const { error: e } = await supabase
        .from('blocked_ips')
        .upsert({ ip, reason: reason ?? 'Blocked by admin' })
      if (e) return NextResponse.json({ error: e.message }, { status: 500 })
      return NextResponse.json({ success: true, action: 'ip_blocked' })
    }

    case 'unblock_ip': {
      if (!ip) return NextResponse.json({ error: 'ip required' }, { status: 400 })
      const { error: e } = await supabase
        .from('blocked_ips')
        .delete()
        .eq('ip', ip)
      if (e) return NextResponse.json({ error: e.message }, { status: 500 })
      return NextResponse.json({ success: true, action: 'ip_unblocked' })
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
}

// List blocked IPs
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('blocked_ips')
    .select('*')
    .order('created_at', { ascending: false })

  return NextResponse.json({ blocked_ips: data ?? [] })
}
