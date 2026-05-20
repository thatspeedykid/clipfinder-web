'use client'
// src/app/history/page.tsx

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

type Job = {
  id: string
  status: string
  mode: string
  source_url: string
  video_title?: string
  clips_found?: number
  progress: number
  error_msg?: string
  created_at: string
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'text-gray-400', downloading: 'text-blue-400',
  transcribing: 'text-purple-400', analyzing: 'text-yellow-400',
  cutting: 'text-orange-400', done: 'text-green-400', error: 'text-red-400',
}

const MODE_ICON: Record<string, string> = {
  auto: '🎯', interview: '🎤', auto_edit: '✂️',
}

export default function HistoryPage() {
  const router = useRouter()
  const supabase = createClient()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      const { data } = await supabase
        .from('jobs')
        .select('id, status, mode, source_url, video_title, clips_found, progress, error_msg, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      setJobs(data ?? [])
      setLoading(false)
    })
  }, [])

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        <h1 className="text-xl font-semibold mb-6">Job history</h1>

        {loading && <p className="text-white/30 text-sm text-center py-8">Loading...</p>}

        {!loading && jobs.length === 0 && (
          <div className="text-center py-16 text-white/20">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">No jobs yet</p>
            <Link href="/dashboard" className="mt-4 inline-block text-xs text-[#FF6B00] hover:underline">Find your first clips →</Link>
          </div>
        )}

        <div className="space-y-3">
          {jobs.map(job => (
            <Link key={job.id} href={`/dashboard?job=${job.id}`}
              className="block bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm">{MODE_ICON[job.mode] ?? '🎬'}</span>
                    <span className={`text-xs font-medium capitalize ${STATUS_COLOR[job.status] ?? 'text-white/50'}`}>
                      {job.status}
                    </span>
                    <span className="text-xs text-white/30">
                      {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm font-medium truncate">
                    {job.video_title || job.source_url}
                  </p>
                  {job.error_msg && <p className="text-xs text-red-400/70 mt-0.5 truncate">{job.error_msg}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  {job.status === 'done' && job.clips_found ? (
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">
                      {job.clips_found} clips
                    </span>
                  ) : job.status !== 'done' && job.status !== 'error' ? (
                    <span className="text-xs text-white/30">{job.progress}%</span>
                  ) : null}
                </div>
              </div>
              {job.status !== 'done' && job.status !== 'error' && job.status !== 'queued' && (
                <div className="mt-2 h-0.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[#FF6B00] rounded-full" style={{ width: `${job.progress}%` }} />
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
