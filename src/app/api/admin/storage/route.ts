import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'

const LIMIT_GB = 9.5

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('clips')
    .select('file_size_mb, file_expires_at, created_at')
    .not('storage_path', 'is', null)

  const clips = data ?? []
  const totalMb = clips.reduce((sum: number, c: {file_size_mb?: number}) => sum + (c.file_size_mb ?? 0), 0)
  const totalGb = totalMb / 1024
  const pct = Math.min(100, (totalGb / LIMIT_GB) * 100)
  const now = new Date()
  const expiredCount = clips.filter((c: {file_expires_at?: string}) => c.file_expires_at && new Date(c.file_expires_at) < now).length

  return NextResponse.json({
    totalGb: Math.round(totalGb * 100) / 100,
    totalMb: Math.round(totalMb),
    limitGb: LIMIT_GB,
    pct: Math.round(pct * 10) / 10,
    clipCount: clips.length,
    activeCount: clips.length - expiredCount,
    expiredCount,
    safe: pct < 80,
    warning: pct >= 80 && pct < 95,
    critical: pct >= 95,
  })
}
