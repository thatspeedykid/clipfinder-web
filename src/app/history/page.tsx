'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
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
  queued: 'text-gray-400', downloading: 'text-blue-400',
  transcribing: 'text-purple-400', analyzing: 'text-yellow-400',
  cutting: 'text-orange-400', done: 'text-green-400', error: 'text-red-400',
}

const MODE_ICON: Record<string, string> = { auto: '🎯', interview: '🎤', auto_edit: '✂️' }

function hoursLeft(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60)))
}

function daysLeft(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
}

export default function HistoryPage() {
  const router = useRouter()
  const supabase = createClient()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [jobClips, setJobClips] = useState<Record<string, Clip[]>>({})
  const [loadingClips, setLoadingClips] = useState<string | null>(null)
  const [previewClip, setPreviewClip] = useState<string | null>(null)
  const [token, setToken] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      setToken(session.access_token)
      const { data } = await supabase
        .from('jobs')
        .select('id, status, mode, source_url, video_title, clips_found, progress, error_msg, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      setJobs(data ?? [])
      setLoading(false)
    })
  }, [])

  async function loadClips(jobId: string) {
    if (jobClips[jobId]) {
      setExpandedJob(expandedJob === jobId ? null : jobId)
      return
    }
    setLoadingClips(jobId)
    const res = await fetch(`/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const d = await res.json()
      setJobClips(prev => ({ ...prev, [jobId]: d.clips ?? [] }))
    }
    setLoadingClips(null)
    setExpandedJob(jobId)
  }

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        <h1 className="text-xl font-semibold mb-6">History</h1>

        {loading && <p className="text-white/30 text-sm text-center py-8">Loading...</p>}

        {!loading && jobs.length === 0 && (
          <div className="text-center py-16 text-white/20">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">No jobs yet</p>
          </div>
        )}

        <div className="space-y-3">
          {jobs.map(job => (
            <div key={job.id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              {/* Job row */}
              <button
                onClick={() => job.status === 'done' ? loadClips(job.id) : null}
                className={`w-full text-left p-4 ${job.status === 'done' ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}
              >
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
                    <p className="text-sm font-medium truncate">{job.video_title || job.source_url}</p>
                    {job.error_msg && <p className="text-xs text-red-400/70 mt-0.5 truncate">{job.error_msg}</p>}
                  </div>
                  <div className="text-right flex-shrink-0 flex items-center gap-2">
                    {job.status === 'done' && job.clips_found ? (
                      <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">
                        {job.clips_found} clips
                      </span>
                    ) : null}
                    {job.status === 'done' && (
                      <span className="text-white/30 text-xs">
                        {expandedJob === job.id ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                </div>
                {job.status !== 'done' && job.status !== 'error' && job.status !== 'queued' && (
                  <div className="mt-2 h-0.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-[#FF6B00] rounded-full" style={{ width: `${job.progress}%` }} />
                  </div>
                )}
              </button>

              {/* Clips expand */}
              {expandedJob === job.id && (
                <div className="border-t border-white/10 p-4 space-y-3">
                  {loadingClips === job.id && <p className="text-white/30 text-xs text-center py-2">Loading clips...</p>}
                  {(jobClips[job.id] ?? []).length === 0 && loadingClips !== job.id && (
                    <p className="text-white/30 text-xs text-center py-2">No clips found</p>
                  )}
                  {(jobClips[job.id] ?? []).map(clip => {
                    const expired = clip.file_expires_at ? new Date(clip.file_expires_at) < new Date() : false
                    const left = clip.file_expires_at && !expired
                      ? (daysLeft(clip.file_expires_at) > 1 ? `${daysLeft(clip.file_expires_at)}d left` : `${hoursLeft(clip.file_expires_at)}h left`)
                      : null

                    return (
                      <div key={clip.id} className="bg-white/5 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1 min-w-0">
                            <a href={`/clips/${clip.id}`} className="text-sm font-medium hover:text-[#FF6B00] transition-colors">{clip.title ?? 'Untitled'}</a>
                            <p className="text-xs text-white/40 mt-0.5">{clip.summary}</p>
                          </div>
                          {clip.score && <span className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-0.5 rounded-full flex-shrink-0">Score {clip.score}/10</span>}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-white/40 mb-3">
                          <span>⏱ {clip.start_ts} → {clip.end_ts}</span>
                          <span>📏 {Math.round(clip.duration_sec ?? 0)}s</span>
                          {left && <span className="text-green-400/70">{left}</span>}
                          {expired && <span className="text-red-400/70">Expired</span>}
                        </div>

                        {/* Video preview */}
                        {previewClip === clip.id && clip.file_url && (
                          <div className="mb-3 bg-black rounded-xl overflow-hidden">
                            <video src={clip.file_url} controls className="w-full" style={{ maxHeight: '280px' }} />
                          </div>
                        )}

                        <div className="flex gap-2 flex-wrap">
                          {clip.file_url && !expired && (
                            <>
                              <a href={`/clips/${clip.id}`}
                                className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30 hover:bg-[#FF6B00]/30 px-3 py-1.5 rounded-lg transition-colors">
                                ✨ View & Post
                              </a>
                              <button
                                onClick={() => setPreviewClip(previewClip === clip.id ? null : clip.id)}
                                className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${previewClip === clip.id ? 'bg-white/20 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}>
                                {previewClip === clip.id ? '▼ Hide' : '▶ Preview'}
                              </button>
                              <a href={clip.file_url} download
                                className="text-xs bg-white/10 text-white/60 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors">
                                ⬇️ Download
                              </a>
                            </>
                          )}
                          {expired && <span className="text-xs text-red-400/60">File expired</span>}
                          {!clip.file_url && !expired && <span className="text-xs text-white/30">Processing...</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
