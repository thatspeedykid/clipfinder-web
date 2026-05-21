'use client'
// src/app/dashboard/page.tsx — with Post Studio + cookie reminder

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

type Job = { id: string; status: string; progress: number; progress_msg: string; error_msg?: string; video_title?: string; clips_found?: number }
type Clip = { id: string; title: string; summary: string; start_ts: string; end_ts: string; duration_sec: number; score: number; file_url?: string; speaker?: string }
type UserProfile = { tier: string; clips_today: number; is_admin: boolean; yt_cookie_saved_at?: string }
type Quota = { used: number; limit: number; allowed: boolean }

type PostStudioState = {
  platform: 'twitter' | 'instagram' | 'tiktok' | 'youtube'
  tone: 'drama' | 'tea' | 'breaking' | 'hype' | 'exaggerate'
  options: string[]
  hook: string
  generating: boolean
  copied: number | null  // index of which option was copied
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

// Days since a date
function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  const tokenRef = useRef<string>('')

  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [sourceFlags, setSourceFlags] = useState({ youtube: true, kick: true, twitch: true, twitter: true })
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'auto' | 'interview' | 'auto_edit'>('auto')
  const [job, setJob] = useState<Job | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showCookieReminder, setShowCookieReminder] = useState(false)
  const [openStudio, setOpenStudio] = useState<string | null>(null)
  const [openPreview, setOpenPreview] = useState<string | null>(null) // clip id
  const [studios, setStudios] = useState<Record<string, PostStudioState>>({})
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

  // Load profile + check cookie reminder + source flags
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

  // Job polling
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`, { headers: { Authorization: `Bearer ${tokenRef.current}` } })
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

    const jobRes = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ source_url: url, mode }),
    })
    const jobData = await jobRes.json()
    if (!jobRes.ok) { setError(jobData.error ?? 'Failed to create job'); setSubmitting(false); return }

    const workerUrl = process.env.NEXT_PUBLIC_MODAL_WORKER_URL
    if (!workerUrl) { setError('Worker not configured'); setSubmitting(false); return }

    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: jobData.jobId, url, mode, userId: user?.id, authToken: process.env.NEXT_PUBLIC_WORKER_SECRET ?? '' }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Failed to start'); return }
    setJob({ id: jobData.jobId, status: 'queued', progress: 0, progress_msg: 'Starting...' })
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
      setStudios(prev => ({
        ...prev,
        [clipId]: { ...prev[clipId], generating: false, options: data.options ?? [], hook: data.hook_line ?? '' }
      }))
    } catch {
      setStudios(prev => ({ ...prev, [clipId]: { ...prev[clipId], generating: false } }))
    }
  }

  function updateStudio(clipId: string, updates: Partial<PostStudioState>) {
    setStudios(prev => ({
      ...prev,
      [clipId]: {
        ...(prev[clipId] ?? { platform: 'twitter', tone: 'drama', options: [], hook: '', generating: false, copied: null }),
        ...updates
      }
    }))
  }

  async function copyToClipboard(clipId: string, text: string, index: number) {
    await navigator.clipboard.writeText(text)
    updateStudio(clipId, { copied: index })
    setTimeout(() => updateStudio(clipId, { copied: null }), 2000)
  }

  async function signOut() { await supabase.auth.signOut(); router.replace('/') }

  const tierColor = { free: 'bg-white/10 text-white/50', pro: 'bg-[#FF6B00]/20 text-[#FF6B00]', agency: 'bg-purple-500/20 text-purple-400' }[profile?.tier ?? 'free']

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />

      {/* Cookie reminder banner */}
      {showCookieReminder && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-xs text-yellow-400">
            ⚠️ Your YouTube cookies are 20+ days old and may have expired. Update them in Settings to avoid download failures.
          </p>
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
            {/* Enabled sources pills */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {[
                { key: 'youtube', label: 'YouTube',   icon: '▶' },
                { key: 'kick',    label: 'Kick',      icon: '🎮' },
                { key: 'twitch',  label: 'Twitch',    icon: '🟣' },
                { key: 'twitter', label: 'Twitter/X', icon: '𝕏' },
              ].map(s => sourceFlags[s.key as keyof typeof sourceFlags] ? (
                <span key={s.key} className={`text-xs px-2.5 py-1 rounded-full border ${
                  source === s.key
                    ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30'
                    : 'bg-white/5 text-white/40 border-white/10'
                }`}>
                  {s.icon} {s.label}
                </span>
              ) : null)}
            </div>

            <div className="flex gap-3">
              <input type="url" placeholder="Paste a URL..." value={url} onChange={e => setUrl(e.target.value)} required
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00] transition-colors" />
              <button type="submit" disabled={submitting || !url || (!!source && !sourceFlags[source as keyof typeof sourceFlags])}
                className="bg-[#FF6B00] text-white font-medium px-5 py-2.5 rounded-xl hover:bg-[#e55f00] disabled:opacity-50 whitespace-nowrap">
                {submitting ? 'Starting...' : 'Find clips'}
              </button>
            </div>

            {/* Source disabled warning */}
            {source && !sourceFlags[source as keyof typeof sourceFlags] && (
              <p className="text-yellow-400 text-xs mt-2">⚠️ {source.charAt(0).toUpperCase() + source.slice(1)} is currently disabled.</p>
            )}

            <div className="flex gap-2 mt-4 flex-wrap">
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

        {/* Job progress */}
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

                return (
                  <div key={clip.id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                    {/* Clip header */}
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h3 className="font-medium text-sm leading-snug">{clip.title ?? 'Untitled clip'}</h3>
                        <span className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">Score {clip.score ?? '?'}/10</span>
                      </div>
                      <p className="text-white/50 text-xs mb-3">{clip.summary}</p>
                      <div className="flex items-center gap-4 text-xs text-white/40 mb-3">
                        <span>⏱ {clip.start_ts} → {clip.end_ts}</span>
                        <span>📏 {Math.round(clip.duration_sec ?? 0)}s</span>
                        {clip.speaker && <span>🎤 {clip.speaker}</span>}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {clip.file_url && (
                          <>
                            <button
                              onClick={() => setOpenPreview(isPreviewOpen ? null : clip.id)}
                              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isPreviewOpen ? 'bg-white/20 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}>
                              {isPreviewOpen ? '▼ Hide' : '▶ Preview'}
                            </button>
                            <a href={clip.file_url} className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors" download>⬇️ Download</a>
                          </>
                        )}
                        <button
                          onClick={() => setOpenStudio(isOpen ? null : clip.id)}
                          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isOpen ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}>
                          ✨ Post Bridge {isOpen ? '▲' : '▼'}
                        </button>
                      </div>
                    </div>

                    {/* Video preview */}
                    {isPreviewOpen && clip.file_url && (
                      <div className="border-t border-white/10 bg-black p-4">
                        <video src={clip.file_url} controls className="w-full rounded-xl" style={{ maxHeight: '320px' }} />
                      </div>
                    )}

                    {/* Post Bridge — inline expand */}
                    {isOpen && (
                      <div className="border-t border-white/10 bg-black/30 p-5">
                        {/* Hook line */}
                        {studio.hook && (
                          <div className="bg-[#FF6B00]/5 border border-[#FF6B00]/20 rounded-xl px-4 py-3 mb-4">
                            <p className="text-xs text-[#FF6B00]/70 mb-1">Hook line</p>
                            <p className="text-sm text-white/80 italic">"{studio.hook}"</p>
                          </div>
                        )}

                        {/* Platform selector */}
                        <div className="flex gap-2 mb-3 flex-wrap">
                          {PLATFORMS.map(p => (
                            <button key={p.key}
                              onClick={() => updateStudio(clip.id, { platform: p.key as PostStudioState['platform'], options: [], hook: '' })}
                              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${studio.platform === p.key ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'}`}>
                              {p.icon} {p.label}
                            </button>
                          ))}
                        </div>

                        {/* Tone selector */}
                        <div className="flex gap-2 mb-4 flex-wrap">
                          {TONES.map(t => (
                            <button key={t.key}
                              onClick={() => updateStudio(clip.id, { tone: t.key as PostStudioState['tone'], options: [], hook: '' })}
                              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${studio.tone === t.key ? 'bg-white/20 text-white border border-white/20' : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'}`}>
                              {t.label}
                            </button>
                          ))}
                        </div>

                        {/* Generate button */}
                        {studio.options.length === 0 && (
                          <button
                            onClick={() => generatePost(clip.id)}
                            disabled={studio.generating}
                            className="w-full py-2.5 bg-[#FF6B00] text-white text-sm font-medium rounded-xl hover:bg-[#e55f00] disabled:opacity-50 mb-3">
                            {studio.generating ? '✨ Generating 3 options...' : '✨ Generate posts'}
                          </button>
                        )}

                        {/* 3 generated options */}
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
                                <button
                                  onClick={() => copyToClipboard(clip.id, option, i)}
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
              {[
                sourceFlags.youtube && 'YouTube',
                sourceFlags.kick && 'Kick',
                sourceFlags.twitch && 'Twitch',
                sourceFlags.twitter && 'Twitter/X',
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
