import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error
  const supabase = createAdminClient()
  // Delete ALL clips unconditionally
  const { error: delErr, count } = await supabase
    .from('clips')
    .delete({ count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  return NextResponse.json({ success: true, deleted: count })
}
