'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

type Job = {
  id: string; status: string; mode: string; source_url: string
  video_title?: string; clips_found?: number; progress: number
  error_msg?: string; created_at: string
}
type Clip = {
  id: string; title?: string; summary?: string; score?: number
  start_ts?: string; end_ts?: string; duration_sec?: number
  file_url?: string; storage_path?: string; file_expires_at?: string
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'text-gray-400', downloading: 'text-blue-400', transcribing: 'text-purple-400',
  analyzing: 'text-yellow-400', cutting: 'text-orange-400',
  done: 'text-green-400', error: 'text-red-400', cancelled: 'text-gray-500',
}
const MODE_ICON: Record<string, string> = { auto: '🎯', interview: '🎤', auto_edit: '✂️' }

const JOBS_PER_PAGE = 5

function hoursLeft(dateStr: string) {
  const h = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 3600000)
  return h < 24 ? `${h}h left` : `${Math.ceil(h/24)}d left`
}

export default function HistoryPage() {
  const router = useRouter()
  const supabase = createClient()
  const [token, setToken] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [jobClips, setJobClips] = useState<Record<string, Clip[]>>({})
  const [loadingClips, setLoadingClips] = useState<string | null>(null)
  const [previewClip, setPreviewClip] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      setToken(session.access_token)
    })
  }, [])

  const loadJobs = useCallback(async (pg: number) => {
    if (!token) return
    setLoading(true)
    const from = (pg - 1) * JOBS_PER_PAGE
    const to = from + JOBS_PER_PAGE - 1

    const { data, count } = await supabase
      .from('jobs')
      .select('id, status, mode, source_url, video_title, clips_found, progress, error_msg, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    setJobs(data ?? [])
    setTotalJobs(count ?? 0)
    setLoading(false)
  }, [token])

  useEffect(() => { if (token) loadJobs(page) }, [token, page])

  const totalPages = Math.ceil(totalJobs / JOBS_PER_PAGE)

  async function loadClips(jobId: string) {
    if (expandedJob === jobId) { setExpandedJob(null); return }
    setExpandedJob(jobId)
    if (jobClips[jobId]) return

    setLoadingClips(jobId)
    const res = await fetch(`/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const d = await res.json()
      // Regenerate signed URLs for clips with storage_path but no file_url
      const clips = await Promise.all((d.clips ?? []).map(async (clip: Clip) => {
        if (!clip.file_url && clip.storage_path) {
          const { data: signed } = await supabase.storage.from('clips').createSignedUrl(clip.storage_path, 3600)
          return { ...clip, file_url: signed?.signedUrl }
        }
        return clip
      }))
      setJobClips(prev => ({ ...prev, [jobId]: clips }))
    }
    setLoadingClips(null)
  }

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />
      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">History</h1>
          <p className="text-xs text-white/30">{totalJobs} total jobs</p>
        </div>

        {loading && <p className="text-white/30 text-sm text-center py-12">Loading...</p>}

        {!loading && jobs.length === 0 && (
          <div className="text-center py-16 text-white/20">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">No jobs yet</p>
          </div>
        )}

        <div className="space-y-3">
          {jobs.map(job => (
            <div key={job.id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              {/* Job header */}
              <button onClick={() => job.status === 'done' ? loadClips(job.id) : null}
                className={`w-full text-left p-4 ${job.status === 'done' ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span>{MODE_ICON[job.mode] ?? '🎬'}</span>
                      <span className={`text-xs font-medium capitalize ${STATUS_COLOR[job.status] ?? 'text-white/50'}`}>{job.status}</span>
                      <span className="text-xs text-white/30">
                        {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm font-medium truncate">{job.video_title || job.source_url}</p>
                    {job.error_msg && <p className="text-xs text-red-400/70 mt-0.5 truncate">{job.error_msg}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {job.status === 'done' && job.clips_found ? (
                      <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">{job.clips_found} clips</span>
                    ) : null}
                    {job.status === 'done' && <span className="text-white/30 text-xs">{expandedJob === job.id ? '▲' : '▼'}</span>}
                  </div>
                </div>
                {!['done', 'error', 'queued', 'cancelled'].includes(job.status) && (
                  <div className="mt-2 h-0.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-[#FF6B00] rounded-full" style={{ width: `${job.progress}%` }} />
                  </div>
                )}
              </button>

              {/* Clips — split layout: video left, description right */}
              {expandedJob === job.id && (
                <div className="border-t border-white/10">
                  {loadingClips === job.id && <p className="text-white/30 text-xs text-center py-4">Loading clips...</p>}
                  {(jobClips[job.id] ?? []).length === 0 && loadingClips !== job.id && (
                    <p className="text-white/30 text-xs text-center py-4">No clips</p>
                  )}
                  {(jobClips[job.id] ?? []).map(clip => {
                    const expired = clip.file_expires_at ? new Date(clip.file_expires_at) < new Date() : false
                    return (
                      <div key={clip.id} className="border-b border-white/5 last:border-0">
                        <div className="flex flex-col md:flex-row">
                          {/* Left — video */}
                          <div className="md:w-[280px] md:flex-shrink-0 bg-black flex items-center justify-center" style={{ minHeight: '160px' }}>
                            {clip.file_url && !expired ? (
                              <video src={clip.file_url} controls className="w-full h-full object-contain" style={{ maxHeight: '200px' }}
                                onError={async () => {
                                  if (clip.storage_path) {
                                    const { data: s } = await supabase.storage.from('clips').createSignedUrl(clip.storage_path, 3600)
                                    if (s?.signedUrl) setJobClips(prev => ({
                                      ...prev,
                                      [job.id]: (prev[job.id] ?? []).map(c => c.id === clip.id ? { ...c, file_url: s.signedUrl } : c)
                                    }))
                                  }
                                }} />
                            ) : (
                              <div className="text-center text-white/20 p-4">
                                <p className="text-2xl mb-1">🎬</p>
                                <p className="text-xs">{expired ? 'Expired' : 'No video'}</p>
                              </div>
                            )}
                          </div>
                          {/* Right — info + actions */}
                          <div className="flex-1 p-4">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <Link href={`/clips/${clip.id}`} className="text-sm font-medium hover:text-[#FF6B00] transition-colors">
                                {clip.title ?? 'Untitled'}
                              </Link>
                              {clip.score && <span className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-0.5 rounded-full flex-shrink-0">Score {clip.score}/10</span>}
                            </div>
                            {clip.summary && <p className="text-xs text-white/40 mb-2 leading-relaxed">{clip.summary}</p>}
                            <div className="flex items-center gap-3 text-xs text-white/30 mb-3">
                              {clip.start_ts && <span>⏱ {clip.start_ts} → {clip.end_ts}</span>}
                              {clip.duration_sec && <span>📏 {Math.round(clip.duration_sec)}s</span>}
                              {clip.file_expires_at && !expired && <span className="text-green-400/70">{hoursLeft(clip.file_expires_at)}</span>}
                              {expired && <span className="text-red-400/70">Expired</span>}
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <Link href={`/clips/${clip.id}`} className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30 px-3 py-1.5 rounded-lg hover:bg-[#FF6B00]/30">
                                ✨ View & Post
                              </Link>
                              {clip.file_url && !expired && (
                                <a href={clip.file_url} download className="text-xs bg-white/10 text-white/60 hover:bg-white/20 px-3 py-1.5 rounded-lg">
                                  ⬇️ Download
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-30">
              ← Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`text-xs w-8 h-8 rounded-lg ${p === page ? 'bg-[#FF6B00] text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>
                {p}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-30">
              Next →
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
