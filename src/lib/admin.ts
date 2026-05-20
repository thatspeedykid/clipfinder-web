// src/lib/admin.ts
// Admin auth helper — checks if current user is an admin

import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function requireAdmin(req: NextRequest): Promise<{
  userId: string | null
  error: NextResponse | null
}> {
  const supabase = createAdminClient()

  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return { userId: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return { userId: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  // Check admin flag
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { userId: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { userId: user.id, error: null }
}
