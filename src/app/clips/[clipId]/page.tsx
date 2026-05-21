'use client'
// src/app/clips/[clipId]/page.tsx
// Split layout: left = Post Bridge results, right = video preview + download

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

const PLATFORMS = [
  { key: 'twitter' as Platform,   label: 'Twitter/X',  icon: '𝕏',  limit: 280 },
  { key: 'instagram' as Platform, label: 'Instagram',  icon: '📸', limit: 2200 },
  { key: 'tiktok' as Platform,    label: 'TikTok',     icon: '🎵', limit: 150 },
  { key: 'youtube' as Platform,   label: 'YT Shorts',  icon: '▶',  limit: 500 },
]

const TONES = [
  { key: 'drama' as Tone,      label: '🔥 Drama' },
  { key: 'tea' as Tone,        label: '☕ Tea' },
  { key: 'breaking' as Tone,   label: '📰 Breaking' },
  { key: 'hype' as Tone,       label: '💥 Hype' },
  { key: 'exaggerate' as Tone, label: '🤯 Exaggerate' },
]

export default function ClipDetailPage() {
  const router = useRouter()
  const params = useParams()
  const clipId = params.clipId as string
  const supabase = createClient()
  const tokenRef = useRef<string>('')

  const [clip, setClip] = useState<Clip | null>(null)
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState<Platform>('twitter')
  const [tone, setTone] = useState<Tone>('drama')
  const [generating, setGenerating] = useState(false)
  const [options, setOptions] = useState<string[]>([])
  const [hookLine, setHookLine] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      tokenRef.current = session.access_token

      // Fetch clip directly from Supabase
      const { data } = await supabase
        .from('clips')
        .select('*')
        .eq('id', clipId)
        .single()

      if (!data) { router.replace('/dashboard'); return }

      // Get fresh signed URL if storage_path exists
      if (data.storage_path) {
        try {
          const { data: signed } = await supabase.storage
            .from('clips')
            .createSignedUrl(data.storage_path, 3600)
          setClip({ ...data, file_url: signed?.signedUrl ?? data.file_url })
        } catch {
          setClip(data)
        }
      } else {
        setClip(data)
      }
      setLoading(false)
    })
  }, [clipId])

  async function generate() {
    setGenerating(true); setError(''); setOptions([]); setHookLine('')
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ clipId, platform, tone }),
    })
    const data = await res.json()
    setGenerating(false)
    if (!res.ok) { setError(data.error ?? 'Generation failed'); return }
    setOptions(data.options ?? [])
    setHookLine(data.hook_line ?? '')
  }

  async function copy(text: string, i: number) {
    await navigator.clipboard.writeText(text)
    setCopied(i); setTimeout(() => setCopied(null), 2000)
  }

  function daysLeft(dateStr: string) {
    const h = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 3600000)
    return h < 24 ? `${h}h left` : `${Math.ceil(h/24)}d left`
  }

  if (loading) return (
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
      <Nav />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-white/30 text-sm">Loading clip...</p>
      </div>
    </main>
  )

  if (!clip) return null

  const expired = clip.file_expires_at ? new Date(clip.file_expires_at) < new Date() : false

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />

      {/* Back link */}
      <div className="px-6 pt-4">
        <Link href="/dashboard" className="text-xs text-white/40 hover:text-white">← Back to dashboard</Link>
      </div>

      {/* Split layout */}
      <div className="flex-1 flex flex-col lg:flex-row gap-0 lg:divide-x lg:divide-white/10 px-0">

        {/* ── LEFT — Post Bridge ───────────────────────────────────────── */}
        <div className="lg:w-[420px] lg:flex-shrink-0 px-6 py-6 lg:overflow-y-auto">
          <div className="mb-5">
            <h1 className="text-lg font-semibold leading-snug mb-1">{clip.title ?? 'Untitled clip'}</h1>
            <p className="text-white/50 text-xs mb-2">{clip.summary}</p>
            <div className="flex items-center gap-3 text-xs text-white/40">
              <span>⏱ {clip.start_ts} → {clip.end_ts}</span>
              <span>📏 {Math.round(clip.duration_sec ?? 0)}s</span>
              {clip.score && <span className="bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-0.5 rounded-full">Score {clip.score}/10</span>}
            </div>
          </div>

          <div className="border-t border-white/10 pt-5">
            <p className="text-xs font-medium text-white/60 mb-3 uppercase tracking-wide">✨ Post Bridge</p>

            {/* Platform */}
            <p className="text-xs text-white/40 mb-2">Platform</p>
            <div className="flex gap-2 flex-wrap mb-4">
              {PLATFORMS.map(p => (
                <button key={p.key} onClick={() => { setPlatform(p.key); setOptions([]); setHookLine('') }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${platform === p.key ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
                  {p.icon} {p.label}
                </button>
              ))}
            </div>

            {/* Tone */}
            <p className="text-xs text-white/40 mb-2">Tone</p>
            <div className="flex gap-2 flex-wrap mb-5">
              {TONES.map(t => (
                <button key={t.key} onClick={() => { setTone(t.key); setOptions([]); setHookLine('') }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${tone === t.key ? 'bg-white/20 text-white border-white/20' : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            <button onClick={generate} disabled={generating}
              className="w-full py-2.5 bg-[#FF6B00] text-white text-sm font-medium rounded-xl hover:bg-[#e55f00] disabled:opacity-50 mb-4">
              {generating ? '✨ Generating...' : options.length > 0 ? '↺ Regenerate' : '✨ Generate posts'}
            </button>

            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

            {/* Hook line */}
            {hookLine && (
              <div className="bg-[#FF6B00]/5 border border-[#FF6B00]/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-xs text-[#FF6B00]/70 mb-1">Hook line</p>
                <p className="text-sm text-white/80 italic">"{hookLine}"</p>
              </div>
            )}

            {/* 3 options */}
            {options.length > 0 && (
              <div className="space-y-3">
                {options.map((option, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/50 font-medium">
                        {i === 0 ? '🔥 Hot Take' : i === 1 ? '💬 Pull Quote' : '📣 Announcement'}
                      </span>
                      <span className={`text-xs ${option.length > (PLATFORMS.find(p => p.key === platform)?.limit ?? 9999) ? 'text-red-400' : 'text-white/20'}`}>
                        {option.length} chars
                      </span>
                    </div>
                    <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{option}</p>
                    <button onClick={() => copy(option, i)}
                      className={`mt-3 w-full text-xs py-2 rounded-lg transition-colors ${copied === i ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}>
                      {copied === i ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  </div>
                ))}

                {/* TODO: Add "Schedule post" button here — links to Post Scheduler */}
                <div className="bg-white/3 border border-white/5 rounded-xl p-3 text-center">
                  <p className="text-xs text-white/20">📅 Post Scheduler coming soon</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT — Video preview + download ────────────────────────── */}
        <div className="flex-1 px-6 py-6 flex flex-col">
          <p className="text-xs font-medium text-white/60 mb-4 uppercase tracking-wide">Preview</p>

          {clip.file_url && !expired ? (
            <div className="flex-1 flex flex-col">
              <div className="bg-black rounded-2xl overflow-hidden flex-1 flex items-center justify-center" style={{ minHeight: '320px' }}>
                <video
                  src={clip.file_url}
                  controls
                  autoPlay={false}
                  className="w-full h-full"
                  style={{ maxHeight: '60vh', objectFit: 'contain' }}
                />
              </div>

              {/* Download + expiry */}
              <div className="mt-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium truncate">{clip.title}</p>
                  {clip.file_expires_at && !expired && (
                    <p className="text-xs text-white/40 mt-0.5">
                      Expires in {daysLeft(clip.file_expires_at)}
                    </p>
                  )}
                </div>
                <a
                  href={clip.file_url}
                  download={`${clip.title ?? 'clip'}.mp4`}
                  className="flex items-center gap-2 bg-[#FF6B00] text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-[#e55f00] transition-colors flex-shrink-0"
                >
                  ⬇️ Download
                </a>
              </div>
            </div>
          ) : expired ? (
            <div className="flex-1 flex flex-col items-center justify-center text-white/20">
              <p className="text-4xl mb-3">⏰</p>
              <p className="text-sm">This clip has expired</p>
              <p className="text-xs mt-1">Free clips expire after 12 hours. Upgrade for 15-day storage.</p>
              <Link href="/pricing" className="mt-4 text-xs bg-[#FF6B00] text-white px-4 py-2 rounded-lg hover:bg-[#e55f00]">
                Upgrade
              </Link>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-white/20">
              <p className="text-4xl mb-3">🎬</p>
              <p className="text-sm">No video file available</p>
              <p className="text-xs mt-1">The clip was found but the file wasn't stored.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
