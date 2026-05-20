// src/app/api/user/route.ts
// Returns current user's profile, tier, and quota status

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkQuota } from '@/lib/quota'

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()

    const authHeader = req.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    const quota = await checkQuota(user.id)

    return NextResponse.json({ profile, quota, user })

  } catch (err) {
    console.error('[user] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
