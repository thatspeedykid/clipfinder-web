'use client'
// src/app/dashboard/page.tsx

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Job = { id: string; status: string; progress: number; progress_msg: string; error_msg?: string; video_title?: string; clips_found?: number }
type Clip = { id: string; title: string; summary: string; start_ts: string; end_ts: string; duration_sec: number; score: number; file_url?: string; tweet?: string }
type UserProfile = { tier: string; clips_today: number; is_admin: boolean }
type Quota = { used: number; limit: number; allowed: boolean }

function detectSource(url: string): string {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('kick.com')) return 'kick'
  if (url.includes('twitch.tv')) return 'twitch'
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter'
  return ''
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'auto' | 'interview' | 'auto_edit'>('auto')
  const [job, setJob] = useState<Job | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace('/login')
      else setUser(user)
    })
  }, [])

  useEffect(() => {
    if (!user) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      fetch('/api/user', { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json()).then(({ profile, quota }) => { setProfile(profile); setQuota(quota) })
    })
  }, [user])

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch(`/api/jobs/${job.id}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      const data = await res.json()
      if (data.job) setJob(data.job)
      if (data.clips) setClips(data.clips)
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [job])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true); setError(''); setClips([]); setJob(null)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.replace('/login'); return }
    const jobRes = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ source_url: url, mode }),
    })
    const jobData = await jobRes.json()
    if (!jobRes.ok) { setError(jobData.error ?? 'Failed to create job'); setSubmitting(false); return }
    const jobId = jobData.jobId
    const workerUrl = process.env.NEXT_PUBLIC_MODAL_WORKER_URL
    if (!workerUrl) { setError('Worker not configured'); setSubmitting(false); return }
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, url, mode, userId: user?.id, authToken: process.env.NEXT_PUBLIC_WORKER_SECRET ?? '' }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Failed to start'); return }
    setJob({ id: jobId, status: 'queued', progress: 0, progress_msg: 'Starting...' })
  }

  async function signOut() { await supabase.auth.signOut(); router.replace('/') }

  const tierColor = { free: 'bg-white/10 text-white/50', pro: 'bg-[#FF6B00]/20 text-[#FF6B00]', agency: 'bg-purple-500/20 text-purple-400' }[profile?.tier ?? 'free']
  const source = detectSource(url)

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <Link href="/" className="flex items-center gap-1">
          <span className="text-[#FF6B00] font-bold text-lg">CLIP</span>
          <span className="font-bold text-lg">FINDER</span>
        </Link>
        <div className="flex items-center gap-3">
          {profile && <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${tierColor}`}>{profile.tier.toUpperCase()}</span>}
          {quota && <span className="text-xs text-white/40">{quota.used}/{quota.limit} clips</span>}
          {profile?.is_admin && (
            <Link href="/admin" className="text-xs bg-white/10 text-white/70 border border-white/10 px-3 py-1.5 rounded-lg hover:bg-white/20 transition-colors">⚙ Admin</Link>
          )}
          {profile?.tier === 'free' && !profile?.is_admin && (
            <Link href="/pricing" className="text-xs bg-[#FF6B00] text-white px-3 py-1.5 rounded-lg hover:bg-[#e55f00]">Upgrade</Link>
          )}
          <Link href="/settings" className="text-xs text-white/30 hover:text-white">Settings</Link>
          <button onClick={signOut} className="text-xs text-white/30 hover:text-white">Sign out</button>
        </div>
      </nav>

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <label className="block text-sm font-medium mb-3">Paste a YouTube, Kick, Twitch, or Twitter URL</label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                {source && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-white/40 uppercase font-medium">{source}</span>}
                <input type="url" placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} required
                  className={`w-full bg-white/5 border border-white/10 rounded-xl py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00] transition-colors ${source ? 'pl-16 pr-4' : 'px-4'}`} />
              </div>
              <button type="submit" disabled={submitting || !url}
                className="bg-[#FF6B00] text-white font-medium px-5 py-2.5 rounded-xl hover:bg-[#e55f00] transition-colors disabled:opacity-50 whitespace-nowrap">
                {submitting ? 'Starting...' : 'Find clips'}
              </button>
            </div>
            <div className="flex gap-2 mt-4">
              {(['auto', 'interview', 'auto_edit'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${mode === m ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'}`}>
                  {m === 'auto' && '🎯 Auto clip'}{m === 'interview' && '🎤 Interview'}{m === 'auto_edit' && '✂️ Auto-edit'}
                  {m !== 'auto' && profile?.tier === 'free' && !profile?.is_admin && ' 🔒'}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-red-400 text-sm mt-2 pl-1">{error}</p>}
        </form>

        {job && job.status !== 'done' && job.status !== 'error' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-8">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium capitalize">{job.status.replace('_', ' ')}...</span>
              <span className="text-sm text-white/40">{job.progress}%</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-[#FF6B00] rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
            </div>
            {job.video_title && <p className="text-xs text-white/50 mt-2 truncate">{job.video_title}</p>}
            {job.progress_msg && <p className="text-xs text-white/40 mt-1">{job.progress_msg}</p>}
          </div>
        )}

        {job?.status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 mb-8">
            <p className="text-red-400 text-sm font-medium mb-1">Processing failed</p>
            <p className="text-red-400/70 text-xs">{job.error_msg ?? 'Something went wrong'}</p>
          </div>
        )}

        {clips.length > 0 && (
          <div>
            <h2 className="font-semibold mb-4 text-white/80">{clips.length} clips found</h2>
            <div className="space-y-4">
              {clips.map(clip => (
                <div key={clip.id} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <h3 className="font-medium text-sm leading-snug">{clip.title}</h3>
                    <span className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-0.5 rounded-full whitespace-nowrap">Score {clip.score}/10</span>
                  </div>
                  <p className="text-white/50 text-xs mb-3">{clip.summary}</p>
                  <div className="flex items-center gap-4 text-xs text-white/40">
                    <span>⏱ {clip.start_ts} → {clip.end_ts}</span>
                    <span>📏 {Math.round(clip.duration_sec)}s</span>
                  </div>
                  {clip.file_url && (
                    <a href={clip.file_url} className="mt-3 inline-flex items-center gap-2 text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors" download>⬇️ Download clip</a>
                  )}
                  {clip.tweet && (
                    <div className="mt-3 bg-black/30 rounded-lg p-3">
                      <p className="text-xs text-white/60 mb-1">Tweet</p>
                      <p className="text-sm">{clip.tweet}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!job && clips.length === 0 && (
          <div className="text-center py-16 text-white/20">
            <p className="text-4xl mb-3">🎬</p>
            <p className="text-sm">Paste a URL above to find clips</p>
            <p className="text-xs mt-2 text-white/15">YouTube · Kick · Twitch · Twitter/X</p>
          </div>
        )}
      </div>
    </main>
  )
}
