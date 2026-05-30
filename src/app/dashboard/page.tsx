'use client'
// src/app/dashboard/page.tsx

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

type Job = { id: string; status: string; progress: number; progress_msg: string; error_msg?: string; video_title?: string; clips_found?: number; source_url?: string }
type Clip = { id: string; title?: string; summary?: string; start_ts?: string; end_ts?: string; duration_sec?: number; score?: number; file_url?: string; storage_path?: string; speaker?: string }
type UserProfile = { tier: string; clips_today: number; is_admin: boolean; yt_cookie_saved_at?: string }
type Quota = { used: number; limit: number; allowed: boolean; activeJobs?: number; maxConcurrent?: number }

type PostStudioState = {
  platform: 'twitter' | 'instagram' | 'tiktok' | 'youtube'
  tone: 'drama' | 'tea' | 'breaking' | 'hype' | 'exaggerate'
  options: string[]
  hook: string
  generating: boolean
  copied: number | null
}

const PLATFORMS = [
  { key: 'twitter', label: 'Twitter/X', icon: '𝕏', limit: 280 },
  { key: 'instagram', label: 'Instagram', icon: '📸', limit: 2200 },
  { key: 'tiktok', label: 'TikTok', icon: '🎵', limit: 2200 },
  { key: 'youtube', label: 'YT Shorts', icon: '▶', limit: 5000 },
] as const

const TONES = [
  { key: 'drama', label: '🔥 Drama' },
  { key: 'tea', label: '☕ Tea' },
  { key: 'breaking', label: '📰 Breaking' },
  { key: 'hype', label: '💥 Hype' },
  { key: 'exaggerate', label: '🤯 Exaggerate' },
] as const

function detectSource(url: string): string {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('kick.com')) return 'kick'
  if (url.includes('twitch.tv')) return 'twitch'
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter'
  return ''
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

// VOD chunk options: for videos >= 1 hour, offer segmented processing
function getChunkOptions(durationSec: number): { label: string; hoursPerChunk: number; chunks: number }[] {
  const hours = durationSec / 3600
  if (hours < 1) return []
  
  const opts: { label: string; hoursPerChunk: number; chunks: number }[] = []
  const totalHours = Math.ceil(hours)
  
  // Option 1: 1 chunk per hour
  opts.push({ label: `${totalHours} segments (1 hr each) — most clips`, hoursPerChunk: 1, chunks: totalHours })
  
  // Option 2: 2 hr chunks if > 2 hrs
  if (hours > 2) {
    const chunks2 = Math.ceil(hours / 2)
    opts.push({ label: `${chunks2} segments (2 hr each) — balanced`, hoursPerChunk: 2, chunks: chunks2 })
  }
  
  // Option 3: full video as one job
  opts.push({ label: `1 segment (full ${Math.round(hours * 10) / 10}h) — fastest`, hoursPerChunk: totalHours, chunks: 1 })
  
  return opts
}

const ACTIVE_STATUSES = ['queued', 'downloading', 'transcribing', 'analyzing', 'cutting']

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  const tokenRef = useRef<string>('')

  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [sourceFlags, setSourceFlags] = useState({ youtube: false, kick: true, twitch: true, twitter: true, mode_auto: true, mode_interview: true, mode_auto_edit: true, post_bridge: true })
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'auto' | 'interview' | 'auto_edit'>('auto')
  const [job, setJob] = useState<Job | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')
  const [showCookieReminder, setShowCookieReminder] = useState(false)
  const [openStudio, setOpenStudio] = useState<string | null>(null)
  const [openPreview, setOpenPreview] = useState<string | null>(null)
  const [studios, setStudios] = useState<Record<string, PostStudioState>>({})
  const [vodDuration, setVodDuration] = useState<number | null>(null)
  const [showChunkOptions, setShowChunkOptions] = useState(false)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const source = detectSource(url)

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      tokenRef.current = session.access_token
      supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUser(user) })
    })
  }, [])

  // Load profile + source flags
  useEffect(() => {
    if (!user) return
    fetch('/api/user', { headers: { Authorization: `Bearer ${tokenRef.current}` } })
      .then(r => r.json())
      .then(({ profile, quota }) => {
        setProfile(profile)
        setQuota(quota)
        if (profile?.yt_cookie_saved_at && daysSince(profile.yt_cookie_saved_at) >= 20) {
          setShowCookieReminder(true)
        }
      })
    fetch('/api/flags/sources').then(r => r.json()).then(setSourceFlags).catch(() => {})
  }, [user])

  // On mount: restore active job from localStorage
  useEffect(() => {
    if (!user) return
    const saved = localStorage.getItem(`cf_active_job_${user.id}`)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // Only restore if not too old (12h)
        if (Date.now() - parsed.savedAt < 12 * 60 * 60 * 1000) {
          setJob(parsed.job)
          if (parsed.url) setUrl(parsed.url)
        } else {
          localStorage.removeItem(`cf_active_job_${user.id}`)
        }
      } catch {}
    }
  }, [user])

  // Save active job to localStorage for persistence
  useEffect(() => {
    if (!user) return
    if (job && ACTIVE_STATUSES.includes(job.status)) {
      localStorage.setItem(`cf_active_job_${user.id}`, JSON.stringify({ job, url, savedAt: Date.now() }))
    } else if (job && (job.status === 'done' || job.status === 'error' || job.status === 'cancelled')) {
      localStorage.removeItem(`cf_active_job_${user.id}`)
    }
  }, [job, user])

  // Job polling
  const pollJob = useCallback(async (jobId: string) => {
    if (!tokenRef.current) return
    const res = await fetch(`/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${tokenRef.current}` } })
    const data = await res.json()
    if (data.job) setJob(data.job)
    if (data.clips) setClips(data.clips)
    if (data.job?.status === 'done' || data.job?.status === 'error' || data.job?.status === 'cancelled') {
      if (pollRef.current) clearInterval(pollRef.current)
      // One more fetch 3s later for fresh signed URLs
      if (data.job?.status === 'done') {
        setTimeout(async () => {
          const res2 = await fetch(`/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${tokenRef.current}` } })
          const data2 = await res2.json()
          if (data2.clips) setClips(data2.clips)
        }, 3000)
      }
    }
  }, [])

  useEffect(() => {
    if (!job) return
    if (!ACTIVE_STATUSES.includes(job.status)) return
    pollJob(job.id)
    pollRef.current = setInterval(() => pollJob(job.id), 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [job?.id, job?.status === 'queued']) // only restart polling when job id changes or becomes active

  async function startJob(targetUrl: string) {
    setSubmitting(true); setError(''); setClips([]); setJob(null); setShowChunkOptions(false)

    const jobRes = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ source_url: targetUrl, mode }),
    })
    const jobData = await jobRes.json()
    if (!jobRes.ok) { setError(jobData.error ?? 'Failed to create job'); setSubmitting(false); return }

    const workerUrl = process.env.NEXT_PUBLIC_MODAL_WORKER_URL
    if (!workerUrl) { setError('Worker not configured'); setSubmitting(false); return }

    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: jobData.jobId, url: targetUrl, mode, userId: user?.id, authToken: process.env.NEXT_PUBLIC_WORKER_SECRET ?? '' }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Failed to start'); return }
    const newJob: Job = { id: jobData.jobId, status: 'queued', progress: 0, progress_msg: 'Starting...', source_url: targetUrl }
    setJob(newJob)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setVodDuration(null)
    await startJob(url)
  }

  async function cancelJob() {
    if (!job) return
    setCancelling(true)
    try {
      await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
      })
      setJob(prev => prev ? { ...prev, status: 'cancelled', progress_msg: 'Cancelled by user' } : null)
      localStorage.removeItem(`cf_active_job_${user?.id}`)
    } finally {
      setCancelling(false)
    }
  }

  async function generatePost(clipId: string) {
    const studio = studios[clipId] ?? { platform: 'twitter', tone: 'drama', options: [], hook: '', generating: false, copied: null }
    setStudios(prev => ({ ...prev, [clipId]: { ...studio, generating: true, options: [], hook: '' } }))
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ clipId, platform: studio.platform, tone: studio.tone }),
      })
      const data = await res.json()
      setStudios(prev => ({ ...prev, [clipId]: { ...prev[clipId], generating: false, options: data.options ?? [], hook: data.hook_line ?? '' } }))
    } catch {
      setStudios(prev => ({ ...prev, [clipId]: { ...prev[clipId], generating: false } }))
    }
  }

  function updateStudio(clipId: string, updates: Partial<PostStudioState>) {
    setStudios(prev => ({
      ...prev,
      [clipId]: { ...(prev[clipId] ?? { platform: 'twitter', tone: 'drama', options: [], hook: '', generating: false, copied: null }), ...updates }
    }))
  }

  async function copyToClipboard(clipId: string, text: string, index: number) {
    await navigator.clipboard.writeText(text)
    updateStudio(clipId, { copied: index })
    setTimeout(() => updateStudio(clipId, { copied: null }), 2000)
  }

  const isJobActive = job && ACTIVE_STATUSES.includes(job.status)
  const chunkOptions = vodDuration ? getChunkOptions(vodDuration) : []

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />

      {showCookieReminder && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-xs text-yellow-400">⚠️ Your YouTube cookies are 20+ days old and may have expired. Update them in Settings.</p>
          <div className="flex gap-2 flex-shrink-0">
            <Link href="/settings" className="text-xs bg-yellow-500/20 text-yellow-400 px-3 py-1.5 rounded-lg hover:bg-yellow-500/30">Update cookies</Link>
            <button onClick={() => setShowCookieReminder(false)} className="text-xs text-white/30 hover:text-white">Dismiss</button>
          </div>
        </div>
      )}

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">

        {/* URL Input */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex gap-2 mb-4 flex-wrap">
              {[
                { key: 'youtube', label: 'YouTube', icon: '▶' },
                { key: 'kick', label: 'Kick', icon: '🎮' },
                { key: 'twitch', label: 'Twitch', icon: '🟣' },
                { key: 'twitter', label: 'Twitter/X', icon: '𝕏' },
              ].map(s => sourceFlags[s.key as keyof typeof sourceFlags] ? (
                <span key={s.key} className={`text-xs px-2.5 py-1 rounded-full border ${
                  source === s.key ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30' : 'bg-white/5 text-white/40 border-white/10'
                }`}>
                  {s.icon} {s.label}
                </span>
              ) : null)}
            </div>

            <div className="flex gap-3">
              <input type="url" placeholder="Paste a URL..." value={url} onChange={e => setUrl(e.target.value)} required
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00] transition-colors" />
              <button type="submit" disabled={submitting || !url || (!!source && !sourceFlags[source as keyof typeof sourceFlags]) || !!isJobActive}
                className="bg-[#FF6B00] text-white font-medium px-5 py-2.5 rounded-xl hover:bg-[#e55f00] disabled:opacity-50 whitespace-nowrap">
                {submitting ? 'Starting...' : 'Find clips'}
              </button>
            </div>

            {source && !sourceFlags[source as keyof typeof sourceFlags] && (
              <p className="text-yellow-400 text-xs mt-2">⚠️ {source.charAt(0).toUpperCase() + source.slice(1)} is currently disabled.</p>
            )}

            {/* Concurrent job notice */}
            {isJobActive && (
              <p className="text-yellow-400/70 text-xs mt-2">⏳ A job is already running. Cancel it or wait for it to finish before starting a new one.</p>
            )}

            <div className="flex gap-2 mt-4 flex-wrap">
              {sourceFlags.mode_auto !== false && (
                <button type="button" onClick={() => setMode('auto')}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${mode === 'auto' ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'}`}>
                  🎯 Auto clip
                </button>
              )}
              {sourceFlags.mode_interview !== false && (
                <button type="button" onClick={() => setMode('interview')}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${mode === 'interview' ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'}`}>
                  🎤 Interview{profile?.tier === 'free' && !profile?.is_admin ? ' 🔒' : ''}
                </button>
              )}
              {sourceFlags.mode_auto_edit !== false && (
                <button type="button" onClick={() => setMode('auto_edit')}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${mode === 'auto_edit' ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'}`}>
                  ✂️ Auto-edit{profile?.tier === 'free' && !profile?.is_admin ? ' 🔒' : ''}
                </button>
              )}
            </div>
          </div>
          {error && <p className="text-red-400 text-sm mt-2 pl-1">{error}</p>}
        </form>

        {/* VOD chunk options */}
        {showChunkOptions && chunkOptions.length > 0 && (
          <div className="bg-white/5 border border-[#FF6B00]/20 rounded-2xl p-5 mb-8">
            <p className="text-sm font-medium mb-1">📹 Long video detected</p>
            <p className="text-xs text-white/50 mb-4">
              This is a {Math.round(vodDuration! / 3600 * 10) / 10}h video. Choose how to process it for the best results:
            </p>
            <div className="space-y-2">
              {chunkOptions.map(opt => (
                <button key={opt.hoursPerChunk} onClick={() => startJob(url)}
                  className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-xl hover:border-[#FF6B00]/40 hover:bg-[#FF6B00]/5 transition-colors">
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-white/40 mt-0.5">Processes {opt.chunks} job{opt.chunks > 1 ? 's' : ''} in sequence</p>
                </button>
              ))}
            </div>
            <button onClick={() => setShowChunkOptions(false)} className="mt-3 text-xs text-white/30 hover:text-white">Cancel</button>
          </div>
        )}

        {/* Job progress */}
        {job && ACTIVE_STATUSES.includes(job.status) && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-8">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium capitalize">{job.status.replace('_', ' ')}...</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-white/40">{job.progress}%</span>
                <button
                  onClick={cancelJob}
                  disabled={cancelling}
                  className="text-xs text-red-400/70 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50">
                  {cancelling ? 'Cancelling...' : '✕ Cancel'}
                </button>
              </div>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-[#FF6B00] rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
            </div>
            {job.video_title && <p className="text-xs text-white/50 mt-2 truncate">{job.video_title}</p>}
            {job.progress_msg && <p className="text-xs text-white/40 mt-1">{job.progress_msg}</p>}
            <p className="text-xs text-white/20 mt-2">You can navigate away — this will keep running and be ready when you return.</p>
          </div>
        )}

        {/* Cancelled */}
        {job?.status === 'cancelled' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-8">
            <p className="text-white/60 text-sm">Job cancelled.</p>
          </div>
        )}

        {/* Error */}
        {job?.status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 mb-8">
            <p className="text-red-400 text-sm font-medium mb-1">Processing failed</p>
            <p className="text-red-400/70 text-xs">{job.error_msg ?? 'Something went wrong'}</p>
            {job.error_msg?.includes('cookies') && (
              <Link href="/settings" className="mt-2 inline-block text-xs text-yellow-400 underline">Update YouTube cookies →</Link>
            )}
          </div>
        )}

        {/* Clips */}
        {clips.length > 0 && (
          <div>
            <h2 className="font-semibold mb-4 text-white/80">{clips.length} clips found</h2>
            <div className="space-y-4">
              {clips.map(clip => {
                const studio = studios[clip.id] ?? { platform: 'twitter', tone: 'drama', options: [], hook: '', generating: false, copied: null }
                const isOpen = openStudio === clip.id
                const isPreviewOpen = openPreview === clip.id
                const hasVideo = !!clip.file_url || !!clip.storage_path

                return (
                  <div key={clip.id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <Link href={`/clips/${clip.id}`} className="font-medium text-sm leading-snug hover:text-[#FF6B00] transition-colors">
                          {clip.title ?? 'Untitled clip'}
                        </Link>
                        <span className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">Score {clip.score ?? '?'}/10</span>
                      </div>
                      <p className="text-white/50 text-xs mb-3">{clip.summary}</p>
                      <div className="flex items-center gap-4 text-xs text-white/40 mb-3">
                        <span>⏱ {clip.start_ts} → {clip.end_ts}</span>
                        <span>📏 {Math.round(clip.duration_sec ?? 0)}s</span>
                        {clip.speaker && <span>🎤 {clip.speaker}</span>}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {hasVideo ? (
                          <>
                            <button
                              onClick={() => setOpenPreview(isPreviewOpen ? null : clip.id)}
                              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isPreviewOpen ? 'bg-white/20 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}>
                              {isPreviewOpen ? '▼ Hide' : '▶ Preview'}
                            </button>
                            {clip.file_url && (
                              <a href={clip.file_url} className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors" download>⬇️ Download</a>
                            )}
                          </>
                        ) : (
                          <Link href={`/clips/${clip.id}`} className="text-xs bg-white/5 text-white/30 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/10">
                            🎬 Open clip
                          </Link>
                        )}
                        <button
                          onClick={() => setOpenStudio(isOpen ? null : clip.id)}
                          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isOpen ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}>
                          ✨ Post Bridge {isOpen ? '▲' : '▼'}
                        </button>
                      </div>
                    </div>

                    {/* Video preview */}
                    {isPreviewOpen && (
                      <div className="border-t border-white/10 bg-black p-4">
                        {clip.file_url ? (
                          <video
                            src={clip.file_url}
                            controls
                            className="w-full rounded-xl"
                            style={{ maxHeight: '320px' }}
                            onError={async () => {
                              // Signed URL expired — refresh via clip detail page
                              console.log('[preview] video load error, URL may have expired')
                            }}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center py-8 text-white/30">
                            <p className="text-3xl mb-2">🎬</p>
                            <p className="text-sm">Video is being processed...</p>
                            <Link href={`/clips/${clip.id}`} className="mt-3 text-xs text-[#FF6B00] hover:underline">Open clip page →</Link>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Post Bridge */}
                    {isOpen && (
                      <div className="border-t border-white/10 bg-black/30 p-5">
                        {studio.hook && (
                          <div className="bg-[#FF6B00]/5 border border-[#FF6B00]/20 rounded-xl px-4 py-3 mb-4">
                            <p className="text-xs text-[#FF6B00]/70 mb-1">Hook line</p>
                            <p className="text-sm text-white/80 italic">"{studio.hook}"</p>
                          </div>
                        )}
                        <div className="flex gap-2 mb-3 flex-wrap">
                          {PLATFORMS.map(p => (
                            <button key={p.key}
                              onClick={() => updateStudio(clip.id, { platform: p.key as PostStudioState['platform'], options: [], hook: '' })}
                              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${studio.platform === p.key ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'}`}>
                              {p.icon} {p.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2 mb-4 flex-wrap">
                          {TONES.map(t => (
                            <button key={t.key}
                              onClick={() => updateStudio(clip.id, { tone: t.key as PostStudioState['tone'], options: [], hook: '' })}
                              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${studio.tone === t.key ? 'bg-white/20 text-white border border-white/20' : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'}`}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                        {studio.options.length === 0 && (
                          <button onClick={() => generatePost(clip.id)} disabled={studio.generating}
                            className="w-full py-2.5 bg-[#FF6B00] text-white text-sm font-medium rounded-xl hover:bg-[#e55f00] disabled:opacity-50 mb-3">
                            {studio.generating ? '✨ Generating 3 options...' : '✨ Generate posts'}
                          </button>
                        )}
                        {studio.options.length > 0 && (
                          <div className="space-y-3">
                            {studio.options.map((option, i) => (
                              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs text-white/40 font-medium">
                                    {i === 0 ? '🔥 Hot Take' : i === 1 ? '💬 Pull Quote' : '📣 Announcement'}
                                  </span>
                                  <span className="text-xs text-white/20">{option.length}/{PLATFORMS.find(p => p.key === studio.platform)?.limit ?? 280}</span>
                                </div>
                                <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{option}</p>
                                <button onClick={() => copyToClipboard(clip.id, option, i)}
                                  className={`mt-3 w-full text-xs py-2 rounded-lg transition-colors ${studio.copied === i ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}>
                                  {studio.copied === i ? '✓ Copied!' : '📋 Copy'}
                                </button>
                              </div>
                            ))}
                            <button onClick={() => generatePost(clip.id)} disabled={studio.generating}
                              className="w-full text-xs py-2 rounded-xl bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 disabled:opacity-50">
                              {studio.generating ? 'Regenerating...' : '↺ Regenerate all 3'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!job && clips.length === 0 && (
          <div className="text-center py-16 text-white/20">
            <p className="text-4xl mb-3">🎬</p>
            <p className="text-sm">Paste a URL above to find clips</p>
            <p className="text-xs mt-2 text-white/15">
              {[sourceFlags.youtube && 'YouTube', sourceFlags.kick && 'Kick', sourceFlags.twitch && 'Twitch', sourceFlags.twitter && 'Twitter/X'].filter(Boolean).join(' · ')}
            </p>
            {profile && (
              <p className="text-xs mt-3 text-white/10">
                {profile.tier === 'free' ? 'Free: 1 job at a time · 1hr max · 3 clips/day' :
                 profile.tier === 'pro' ? 'Pro: 2 concurrent jobs · up to 8hr · 50 clips/day' :
                 'Agency: unlimited concurrent · any length'}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
