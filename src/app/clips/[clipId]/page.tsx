'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

type Clip = {
  id: string; title?: string; summary?: string; score?: number
  start_ts?: string; end_ts?: string; duration_sec?: number
  file_url?: string; storage_path?: string; file_expires_at?: string
  job_id?: string; speaker?: string
}

type Platform = 'twitter' | 'instagram' | 'tiktok' | 'youtube'
type Tone = 'drama' | 'tea' | 'breaking' | 'hype' | 'exaggerate'

const PLATFORMS: { key: Platform; label: string; icon: string; limit: number; aspect: string }[] = [
  { key: 'twitter',   label: 'Twitter/X',  icon: '𝕏',  limit: 280,  aspect: '16/9' },
  { key: 'instagram', label: 'Instagram',  icon: '📸', limit: 2200, aspect: '1/1' },
  { key: 'tiktok',    label: 'TikTok',     icon: '🎵', limit: 150,  aspect: '9/16' },
  { key: 'youtube',   label: 'YT Shorts',  icon: '▶',  limit: 500,  aspect: '9/16' },
]

const TONES: { key: Tone; label: string }[] = [
  { key: 'drama',      label: '🔥 Drama' },
  { key: 'tea',        label: '☕ Tea' },
  { key: 'breaking',   label: '📰 Breaking' },
  { key: 'hype',       label: '💥 Hype' },
  { key: 'exaggerate', label: '🤯 Exaggerate' },
]

export default function ClipDetailPage() {
  const router = useRouter()
  const params = useParams()
  const clipId = params.clipId as string
  const supabase = createClient()
  const tokenRef = useRef<string>('')
  const videoRef = useRef<HTMLVideoElement>(null)

  const [clip, setClip] = useState<Clip | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState<Platform>('twitter')
  const [tone, setTone] = useState<Tone>('drama')
  const [generating, setGenerating] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [options, setOptions] = useState<string[]>([])
  const [editedOptions, setEditedOptions] = useState<string[]>([])
  const [hookLine, setHookLine] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [streamerName, setStreamerName] = useState('')
  const [customContext, setCustomContext] = useState('')
  const [allPlatformResults, setAllPlatformResults] = useState<Record<string, {options: string[], hook_line: string}>>({})
  const [videoAspect, setVideoAspect] = useState<string>('16/9')
  const [videoLoaded, setVideoLoaded] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      tokenRef.current = session.access_token

      const { data } = await supabase.from('clips').select('*').eq('id', clipId).single()
      if (!data) { router.replace('/dashboard'); return }

      // Get source URL from job
      if (data.job_id) {
        const { data: job } = await supabase.from('jobs').select('source_url').eq('id', data.job_id).single()
        if (job?.source_url) {
          setSourceUrl(job.source_url)
          // Auto-extract streamer name
          const extracted = extractStreamerFromUrl(job.source_url)
          if (extracted) setStreamerName(extracted)
        }
      }

      if (data.storage_path) {
        try {
          const { data: signed } = await supabase.storage.from('clips').createSignedUrl(data.storage_path, 3600)
          setClip({ ...data, file_url: signed?.signedUrl ?? data.file_url })
        } catch { setClip(data) }
      } else {
        setClip(data)
      }
      setLoading(false)
    })
  }, [clipId])

  function extractStreamerFromUrl(url: string): string {
    try {
      const u = new URL(url)
      if (u.hostname.includes('kick.com')) {
        const parts = u.pathname.split('/').filter(Boolean)
        return parts[0] && parts[0] !== 'clips' ? parts[0] : ''
      }
      if (u.hostname.includes('twitter.com') || u.hostname.includes('x.com')) {
        return u.pathname.split('/').filter(Boolean)[0]?.replace('@', '') ?? ''
      }
      if (u.hostname.includes('tiktok.com')) {
        return u.pathname.split('/').filter(Boolean)[0]?.replace('@', '') ?? ''
      }
      if (u.hostname.includes('twitch.tv')) {
        return u.pathname.split('/').filter(Boolean)[0] ?? ''
      }
    } catch {}
    return ''
  }

  function handleVideoLoad() {
    const v = videoRef.current
    if (!v) return
    const w = v.videoWidth
    const h = v.videoHeight
    setVideoLoaded(true)
    if (w && h) {
      if (h > w) setVideoAspect('9/16')        // portrait (TikTok/Shorts)
      else if (Math.abs(w - h) < 50) setVideoAspect('1/1') // square (Instagram)
      else setVideoAspect('16/9')              // landscape
    }
  }

  async function generate(forPlatform?: Platform) {
    const p = forPlatform ?? platform
    setGenerating(true); setError(''); setOptions([]); setEditedOptions([]); setHookLine('')
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ clipId, platform: p, tone, streamerName, customContext, sourceUrl }),
    })
    const data = await res.json()
    setGenerating(false)
    if (!res.ok) { setError(data.error ?? 'Generation failed'); return }
    const opts = data.options ?? []
    setOptions(opts)
    setEditedOptions([...opts])
    setHookLine(data.hook_line ?? '')
  }

  async function generateAll() {
    setGeneratingAll(true); setError(''); setAllPlatformResults({})
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ clipId, tone, streamerName, customContext, sourceUrl, platforms: ['twitter', 'instagram', 'tiktok', 'youtube'] }),
    })
    const data = await res.json()
    setGeneratingAll(false)
    if (!res.ok) { setError(data.error ?? 'Generation failed'); return }
    setAllPlatformResults(data.platforms ?? {})
  }

  async function copy(text: string, i: number) {
    await navigator.clipboard.writeText(text)
    setCopied(i); setTimeout(() => setCopied(null), 2000)
  }

  function daysLeft(dateStr: string) {
    const h = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 3600000)
    return h < 24 ? `${h}h left` : `${Math.ceil(h / 24)}d left`
  }

  const currentPlatformInfo = PLATFORMS.find(p => p.key === platform)!
  const expired = clip?.file_expires_at ? new Date(clip.file_expires_at) < new Date() : false

  if (loading) return (
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
      <Nav />
      <div className="flex-1 flex items-center justify-center"><p className="text-white/30 text-sm">Loading...</p></div>
    </main>
  )

  if (!clip) return null

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />
      <div className="px-6 pt-4 pb-2 flex items-center gap-3">
        <Link href="/dashboard" className="text-xs text-white/40 hover:text-white">← Dashboard</Link>
        {clip.score && <span className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-0.5 rounded-full">Score {clip.score}/10</span>}
      </div>

      {/* Main split layout */}
      <div className="flex-1 flex flex-col xl:flex-row xl:divide-x xl:divide-white/10">

        {/* ── LEFT — Video + info ─────────────────────────────────────────────── */}
        <div className="xl:w-[480px] xl:flex-shrink-0 px-6 py-4 flex flex-col gap-4">
          
          {/* Video player — adapts to aspect ratio, no black bars */}
          {clip.file_url && !expired ? (
            <div className="w-full">
              <div className={`relative bg-black rounded-2xl overflow-hidden w-full mx-auto ${
                videoAspect === '9/16' ? 'max-w-[280px]' :
                videoAspect === '1/1' ? 'max-w-[400px]' : 'w-full'
              }`}
                style={{ aspectRatio: videoLoaded ? videoAspect : '16/9' }}>
                <video
                  ref={videoRef}
                  src={clip.file_url}
                  controls
                  onLoadedMetadata={handleVideoLoad}
                  onError={async () => {
                    // Refresh signed URL on error
                    if (clip.storage_path) {
                      const { data: signed } = await supabase.storage.from('clips').createSignedUrl(clip.storage_path, 3600)
                      if (signed?.signedUrl) setClip(c => c ? { ...c, file_url: signed.signedUrl } : c)
                    }
                  }}
                  className="absolute inset-0 w-full h-full object-contain"
                />
              </div>
              <div className="flex items-center justify-between mt-3">
                <div>
                  <p className="text-sm font-medium">{clip.title}</p>
                  {clip.file_expires_at && !expired && (
                    <p className="text-xs text-white/30 mt-0.5">Expires in {daysLeft(clip.file_expires_at)}</p>
                  )}
                  <div className="flex gap-3 text-xs text-white/30 mt-1">
                    {clip.start_ts && <span>⏱ {clip.start_ts} → {clip.end_ts}</span>}
                    {clip.duration_sec && <span>📏 {Math.round(clip.duration_sec)}s</span>}
                  </div>
                </div>
                <a href={clip.file_url} download={`${clip.title ?? 'clip'}.mp4`}
                  className="flex-shrink-0 bg-[#FF6B00] text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-[#e55f00]">
                  ⬇️ Download
                </a>
              </div>
            </div>
          ) : expired ? (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
              <p className="text-3xl mb-2">⏰</p>
              <p className="text-sm text-white/50">Clip expired</p>
              <Link href="/pricing" className="mt-3 inline-block text-xs bg-[#FF6B00] text-white px-4 py-2 rounded-lg">Upgrade</Link>
            </div>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
              <p className="text-3xl mb-2">🎬</p>
              <p className="text-sm text-white/50">No video file yet</p>
            </div>
          )}

          {/* Clip summary */}
          {clip.summary && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-xs text-white/40 mb-1 font-medium uppercase tracking-wide">Summary</p>
              <p className="text-sm text-white/70 leading-relaxed">{clip.summary}</p>
            </div>
          )}
        </div>

        {/* ── RIGHT — Post Bridge ─────────────────────────────────────────────── */}
        <div className="flex-1 px-6 py-4 xl:overflow-y-auto">
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">✨ Post Bridge</h2>
              <button onClick={generateAll} disabled={generatingAll}
                className="text-xs bg-white/10 text-white/60 hover:bg-white/20 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                {generatingAll ? '⏳ Generating all...' : '⚡ Generate all platforms'}
              </button>
            </div>

            {/* Streamer name + custom context */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-white/40 mb-1 block">Streamer / Creator name</label>
                <input value={streamerName} onChange={e => setStreamerName(e.target.value)}
                  placeholder="Auto-detected from URL"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#FF6B00]" />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Extra context (optional)</label>
                <input value={customContext} onChange={e => setCustomContext(e.target.value)}
                  placeholder="e.g. 'they were arguing about gambling'"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#FF6B00]" />
              </div>
            </div>

            {/* Platform selector */}
            <div className="flex gap-2 flex-wrap mb-3">
              {PLATFORMS.map(p => (
                <button key={p.key} onClick={() => { setPlatform(p.key); setOptions([]); setEditedOptions([]); setHookLine('') }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${platform === p.key ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
                  {p.icon} {p.label}
                </button>
              ))}
            </div>

            {/* Tone selector */}
            <div className="flex gap-2 flex-wrap mb-4">
              {TONES.map(t => (
                <button key={t.key} onClick={() => { setTone(t.key); setOptions([]); setEditedOptions([]); setHookLine('') }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${tone === t.key ? 'bg-white/20 text-white border-white/20' : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Generate buttons */}
            <div className="flex gap-2 mb-4">
              <button onClick={() => generate()} disabled={generating}
                className="flex-1 py-2.5 bg-[#FF6B00] text-white text-sm font-medium rounded-xl hover:bg-[#e55f00] disabled:opacity-50">
                {generating ? '✨ Generating...' : options.length > 0 ? '↺ Regenerate' : `✨ Generate for ${currentPlatformInfo.label}`}
              </button>
            </div>

            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

            {/* Hook line */}
            {hookLine && (
              <div className="bg-[#FF6B00]/5 border border-[#FF6B00]/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-xs text-[#FF6B00]/70 mb-1">Hook line</p>
                <p className="text-sm text-white/80 italic">"{hookLine}"</p>
              </div>
            )}

            {/* Generated options — EDITABLE */}
            {editedOptions.length > 0 && (
              <div className="space-y-4 mb-6">
                <p className="text-xs text-white/40 uppercase tracking-wide">Results — click any text to edit</p>
                {editedOptions.map((option, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/50 font-medium">
                        {i === 0 ? '🔥 Hot Take' : i === 1 ? '💬 Pull Quote' : '📣 Announcement'}
                      </span>
                      <span className={`text-xs ${option.length > currentPlatformInfo.limit ? 'text-red-400' : 'text-white/20'}`}>
                        {option.length}/{currentPlatformInfo.limit}
                      </span>
                    </div>
                    {/* Editable textarea */}
                    <textarea
                      value={option}
                      onChange={e => {
                        const updated = [...editedOptions]
                        updated[i] = e.target.value
                        setEditedOptions(updated)
                      }}
                      rows={platform === 'instagram' || platform === 'youtube' ? 8 : 4}
                      className="w-full bg-transparent text-sm text-white/80 leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-[#FF6B00]/30 rounded-lg px-1"
                    />
                    <button onClick={() => copy(option, i)}
                      className={`mt-2 w-full text-xs py-2 rounded-lg transition-colors ${copied === i ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}>
                      {copied === i ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  </div>
                ))}
                <div className="bg-white/3 border border-white/5 rounded-xl p-3 text-center">
                  <p className="text-xs text-white/20">📅 Post Scheduler coming soon</p>
                </div>
              </div>
            )}

            {/* All platform results */}
            {Object.keys(allPlatformResults).length > 0 && (
              <div className="space-y-4">
                <p className="text-xs text-white/40 uppercase tracking-wide">All platforms</p>
                {PLATFORMS.map(p => {
                  const result = allPlatformResults[p.key]
                  if (!result) return null
                  return (
                    <div key={p.key} className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <p className="text-sm font-medium mb-3">{p.icon} {p.label}</p>
                      {result.hook_line && (
                        <p className="text-xs text-[#FF6B00]/70 italic mb-3">"{result.hook_line}"</p>
                      )}
                      <div className="space-y-3">
                        {result.options.map((opt, i) => (
                          <div key={i} className="bg-black/20 rounded-lg p-3">
                            <p className="text-xs text-white/30 mb-1">{i === 0 ? 'Hot Take' : i === 1 ? 'Pull Quote' : 'Announcement'}</p>
                            <p className="text-xs text-white/70 whitespace-pre-wrap">{opt}</p>
                            <button onClick={() => copy(opt, i * 100 + PLATFORMS.indexOf(p))}
                              className={`mt-2 w-full text-xs py-1.5 rounded-lg ${copied === i * 100 + PLATFORMS.indexOf(p) ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40 hover:bg-white/20'}`}>
                              {copied === i * 100 + PLATFORMS.indexOf(p) ? '✓ Copied!' : 'Copy'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
