'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

type Job = {
  id: string; status: string; mode: string; source_url: string
  video_title?: string; clips_found?: number; progress: number
  error_msg?: string; created_at: string; streamer_name?: string
}
type Clip = {
  id: string; title?: string; summary?: string; score?: number
  start_ts?: string; end_ts?: string; duration_sec?: number
  file_url?: string; storage_path?: string; file_expires_at?: string
}

const JOBS_PER_PAGE = 5

function hoursLeft(dateStr: string) {
  const h = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 3600000)
  return h < 24 ? `${h}h left` : `${Math.ceil(h/24)}d left`
}

function getSessionType(job: Job): string {
  const url = job.source_url ?? ''
  if (url.includes('stream.kick.com') || url.includes('live-video.net') || url.includes('.m3u8')) return 'Extension'
  if (url.includes('kick.com/clips') || url.includes('clip_0')) return 'Clip'
  return 'Direct'
}

function getSessionTitle(job: Job, clips: Clip[]): string {
  const type = getSessionType(job)
  const streamer = job.streamer_name || extractStreamer(job.source_url)
  const firstClip = clips[0]?.title
  const parts = [
    streamer ? streamer.charAt(0).toUpperCase() + streamer.slice(1) : null,
    firstClip || job.video_title || null,
    type,
  ].filter(Boolean)
  return parts.join(' — ')
}

function extractStreamer(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname.includes('kick.com')) {
      const parts = u.pathname.split('/').filter(Boolean)
      return parts[0] && parts[0] !== 'clips' ? parts[0] : ''
    }
    if (u.hostname.includes('twitch.tv')) return u.pathname.split('/').filter(Boolean)[0] ?? ''
    if (u.hostname.includes('twitter.com') || u.hostname.includes('x.com'))
      return u.pathname.split('/').filter(Boolean)[0]?.replace('@','') ?? ''
  } catch {}
  return ''
}

// ClipVideoLoader removed — clips use R2 public URLs via file_url directly

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
  const [openStudio, setOpenStudio] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [videoErrors, setVideoErrors] = useState<Set<string>>(new Set())

  async function downloadClip(fileUrl: string, clipId: string) {
    const downloadUrl = `/api/clips/${clipId}/stream?download=1`
    try {
      const res = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error('fetch failed')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `clip-${clipId.slice(0,8)}.mp4`
      document.body.appendChild(a); a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    } catch { window.open(downloadUrl, '_blank') }
  }

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
      .select('id, status, mode, source_url, video_title, clips_found, progress, error_msg, created_at, streamer_name', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)
    setJobs(data ?? [])
    setTotalJobs(count ?? 0)
    setLoading(false)
    if (pg === 1) {
      const firstDone = (data ?? []).find(j => j.status === 'done')
      if (firstDone) setExpandedJob(firstDone.id)
    }
  }, [token])

  useEffect(() => { if (token) loadJobs(page) }, [token, page])

  useEffect(() => {
    if (expandedJob && token && !jobClips[expandedJob]) loadClips(expandedJob)
  }, [expandedJob, token])

  async function loadClips(jobId: string) {
    // Toggle: if already expanded and clips loaded, collapse
    if (expandedJob === jobId && jobClips[jobId]) { setExpandedJob(null); return }
    setExpandedJob(jobId)
    // Already loaded — just expand
    if (jobClips[jobId]) return
    setLoadingClips(jobId)
    const res = await fetch(`/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const d = await res.json()
      // Clips are on R2 — file_url is already a public URL, no signed URL needed
      setJobClips(prev => ({ ...prev, [jobId]: d.clips ?? [] }))
    }
    setLoadingClips(null)
  }

  async function clearJob(jobId: string) {
    if (!confirm('Delete this job and all its clips from storage?')) return
    await fetch('/api/user/history', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ jobId }),
    })
    setJobs(prev => prev.filter(j => j.id !== jobId))
    setJobClips(prev => { const n = {...prev}; delete n[jobId]; return n })
    if (expandedJob === jobId) setExpandedJob(null)
  }

  async function clearAllHistory() {
    if (!confirm('Delete ALL your history and clips from storage permanently?')) return
    setClearing(true)
    await fetch('/api/user/history', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    setJobs([]); setJobClips({}); setTotalJobs(0); setClearing(false)
  }

  const totalPages = Math.ceil(totalJobs / JOBS_PER_PAGE)

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />
      <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">History</h1>
          <div className="flex items-center gap-3">
            <p className="text-xs text-white/30">{totalJobs} sessions</p>
            {jobs.length > 0 && (
              <button onClick={clearAllHistory} disabled={clearing}
                className="text-xs text-red-400/70 hover:text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-50">
                {clearing ? 'Clearing...' : '🗑 Clear all'}
              </button>
            )}
          </div>
        </div>

        {loading && <p className="text-white/30 text-sm text-center py-12">Loading...</p>}

        {!loading && jobs.length === 0 && (
          <div className="text-center py-16 text-white/20">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">No history yet</p>
          </div>
        )}

        <div className="space-y-4">
          {jobs.map(job => {
            const clips = jobClips[job.id] ?? []
            const isExpanded = expandedJob === job.id
            const sessionTitle = getSessionTitle(job, clips)
            const type = getSessionType(job)

            return (
              <div key={job.id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                {/* Session header */}
                <button onClick={() => loadClips(job.id)}
                  className="w-full text-left px-5 py-4 hover:bg-white/3 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          type === 'Extension' ? 'bg-purple-500/20 text-purple-400' :
                          type === 'Clip' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-white/10 text-white/50'
                        }`}>{type}</span>
                        {job.status === 'done' && job.clips_found && (
                          <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">{job.clips_found} clips</span>
                        )}
                        <span className="text-xs text-white/30">
                          {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm font-medium truncate">
                        {clips.length > 0 ? sessionTitle : (job.video_title || extractStreamer(job.source_url) || job.source_url.slice(0, 60))}
                      </p>
                      {job.error_msg && <p className="text-xs text-red-400/70 mt-0.5">{job.error_msg}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {job.status === 'done' && <span className="text-white/30 text-xs">{isExpanded ? '▲' : '▼'}</span>}
                      <button onClick={e => { e.stopPropagation(); clearJob(job.id) }}
                        className="text-xs text-red-400/40 hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10">🗑</button>
                    </div>
                  </div>
                </button>

                {/* Clips — same layout as dashboard */}
                {isExpanded && job.status === 'done' && (
                  <div className="border-t border-white/10">
                    {loadingClips === job.id && (
                      <p className="text-white/30 text-xs text-center py-4">Loading clips...</p>
                    )}
                    {clips.length === 0 && loadingClips !== job.id && (
                      <p className="text-white/20 text-xs text-center py-4">No clips found</p>
                    )}
                    {clips.map(clip => {
                      const expired = clip.file_expires_at ? new Date(clip.file_expires_at) < new Date() : false
                      const isOpen = openStudio === clip.id
                      return (
                        <div key={clip.id} className="border-b border-white/5 last:border-0">
                          <div className="flex flex-col lg:flex-row">
                            {/* LEFT — video */}
                            <div className="lg:w-[45%] bg-black flex items-center justify-center" style={{ minHeight: '220px' }}>
                              {clip.file_url && !expired && !videoErrors.has(clip.id) ? (
                                <video src={clip.file_url} controls className="w-full h-full object-contain" style={{ maxHeight: '280px' }}
                                  onError={() => setVideoErrors(prev => new Set([...prev, clip.id]))} />
                              ) : (
                                <div className="text-center text-white/20 p-6">
                                  <p className="text-2xl mb-1">{expired ? '⏰' : videoErrors.has(clip.id) ? '⚠️' : '🎬'}</p>
                                  <p className="text-xs">{expired ? 'Expired' : videoErrors.has(clip.id) ? 'Unavailable' : 'No video'}</p>
                                </div>
                              )}
                            </div>
                            {/* RIGHT — info */}
                            <div className="flex-1 p-5 flex flex-col justify-between">
                              <div>
                                <div className="flex items-start justify-between gap-3 mb-2">
                                  <Link href={`/clips/${clip.id}`} className="font-semibold text-base hover:text-[#FF6B00] transition-colors">
                                    {clip.title ?? 'Untitled'}
                                  </Link>
                                  {clip.score && <span className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-1 rounded-full flex-shrink-0">Score {clip.score}/10</span>}
                                </div>
                                {clip.summary && <p className="text-white/50 text-sm mb-3 leading-relaxed">{clip.summary}</p>}
                                <div className="flex items-center gap-3 text-xs text-white/40 mb-4">
                                  {clip.start_ts && <span>⏱ {clip.start_ts} → {clip.end_ts}</span>}
                                  {clip.duration_sec && <span>📏 {Math.round(clip.duration_sec)}s</span>}
                                  {clip.file_expires_at && !expired && <span className="text-green-400/70">{hoursLeft(clip.file_expires_at)}</span>}
                                  {expired && <span className="text-red-400/60">Expired</span>}
                                </div>
                              </div>
                              <div className="flex gap-2 flex-wrap">
                                <Link href={`/clips/${clip.id}`} className="text-xs bg-white/10 text-white/60 hover:bg-white/20 px-3 py-2 rounded-lg">
                                  🎬 Open clip
                                </Link>
                                {clip.file_url && !expired && (
                                  <button onClick={() => downloadClip(clip.file_url!, clip.id)} className="text-xs bg-white/10 text-white/60 hover:bg-white/20 px-3 py-2 rounded-lg">⬇️ Download</button>
                                )}
                                <button onClick={() => setOpenStudio(isOpen ? null : clip.id)}
                                  className={`text-xs px-3 py-2 rounded-lg font-medium transition-colors ${isOpen ? 'bg-[#FF6B00] text-white' : 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30 hover:bg-[#FF6B00]/30'}`}>
                                  ✨ Post Bridge {isOpen ? '▲' : '▼'}
                                </button>
                              </div>
                            </div>
                          </div>
                          {/* Post Bridge panel */}
                          {isOpen && (
                            <div className="border-t border-white/10 p-5 bg-white/3">
                              <p className="text-xs text-white/40 mb-3">Open in clip page for full Post Bridge features</p>
                              <Link href={`/clips/${clip.id}`} className="text-xs bg-[#FF6B00] text-white px-4 py-2 rounded-lg hover:bg-[#e55f00]">
                                Open Post Bridge →
                              </Link>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8 flex-wrap">
            <button onClick={() => setPage(1)} disabled={page === 1}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-30">
              « First
            </button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-30">
              ← Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .reduce((acc: (number|string)[], p, i, arr) => {
                if (i > 0 && (p as number) - (arr[i-1] as number) > 1) acc.push('...')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) => p === '...' ? (
                <span key={`dot-${i}`} className="text-xs text-white/20 px-1">...</span>
              ) : (
                <button key={p} onClick={() => setPage(p as number)}
                  className={`text-xs w-8 h-8 rounded-lg ${p === page ? 'bg-[#FF6B00] text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>
                  {p}
                </button>
              ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-30">
              Next →
            </button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-30">
              Last »
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
