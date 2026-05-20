'use client'
// src/app/studio/page.tsx
// Standalone Post Studio — generate posts from URL, transcript, or prompt

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type InputType = 'url' | 'transcript' | 'prompt'
type Platform = 'twitter' | 'instagram' | 'tiktok' | 'youtube'
type Tone = 'drama' | 'tea' | 'breaking' | 'hype' | 'exaggerate'

const PLATFORMS = [
  { key: 'twitter' as Platform,   label: 'Twitter/X',  icon: '𝕏',  limit: 280 },
  { key: 'instagram' as Platform, label: 'Instagram',  icon: '📸', limit: 2200 },
  { key: 'tiktok' as Platform,    label: 'TikTok',     icon: '🎵', limit: 150 },
  { key: 'youtube' as Platform,   label: 'YT Shorts',  icon: '▶',  limit: 500 },
]

const TONES = [
  { key: 'drama' as Tone,      label: '🔥 Drama',      desc: 'Tea spiller energy' },
  { key: 'tea' as Tone,        label: '☕ Tea',         desc: 'Calm but devastating' },
  { key: 'breaking' as Tone,   label: '📰 Breaking',   desc: 'Journalistic urgency' },
  { key: 'hype' as Tone,       label: '💥 Hype',       desc: 'Unmissable energy' },
  { key: 'exaggerate' as Tone, label: '🤯 Exaggerate', desc: 'Multi-line story format' },
]

const INPUT_TYPES = [
  { key: 'url' as InputType,        label: '🔗 URL',        desc: 'YouTube, Kick, Twitch, Twitter link' },
  { key: 'transcript' as InputType, label: '📝 Transcript', desc: 'Paste transcript or subtitles' },
  { key: 'prompt' as InputType,     label: '💭 Prompt',     desc: 'Describe what happened' },
]

export default function StudioPage() {
  const router = useRouter()
  const supabase = createClient()
  const tokenRef = useRef<string>('')

  const [profile, setProfile] = useState<{ tier: string; is_admin: boolean } | null>(null)
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)
  const [inputType, setInputType] = useState<InputType>('url')
  const [input, setInput] = useState('')
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState<Platform>('twitter')
  const [tone, setTone] = useState<Tone>('drama')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ options: string[]; hook_line: string; extracted_title?: string } | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      tokenRef.current = session.access_token

      // Load profile + quota
      const [userRes, quotaRes] = await Promise.all([
        fetch('/api/user', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch('/api/studio', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ])
      if (userRes.ok) {
        const d = await userRes.json()
        setProfile(d.profile)
      }
      if (quotaRes.ok) {
        const d = await quotaRes.json()
        setQuota(d.quota)
      }
    })
  }, [])

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    setGenerating(true)
    setError('')
    setResult(null)

    const res = await fetch('/api/studio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ inputType, input, title, platform, tone }),
    })

    const data = await res.json()
    setGenerating(false)

    if (!res.ok) {
      setError(data.error ?? 'Generation failed')
      return
    }

    setResult(data)
    if (data.quota) setQuota(data.quota)
    if (data.extracted_title && !title) setTitle(data.extracted_title)
  }

  async function copy(text: string, index: number) {
    await navigator.clipboard.writeText(text)
    setCopied(index)
    setTimeout(() => setCopied(null), 2000)
  }

  const inputPlaceholders: Record<InputType, string> = {
    url:        'https://youtube.com/watch?v=... or kick.com/clip/...',
    transcript: 'Paste the transcript or subtitles here...',
    prompt:     'Describe what happened in the clip. Names, what was said, the drama...',
  }

  const tierColor = { free: 'bg-white/10 text-white/50', pro: 'bg-[#FF6B00]/20 text-[#FF6B00]', agency: 'bg-purple-500/20 text-purple-400' }[profile?.tier ?? 'free']
  const atLimit = quota && quota.used >= quota.limit && !profile?.is_admin

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <Link href="/dashboard" className="flex items-center gap-1">
          <span className="text-[#FF6B00] font-bold text-lg">CLIP</span>
          <span className="font-bold text-lg">FINDER</span>
        </Link>
        <div className="flex items-center gap-3">
          {profile && <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${tierColor}`}>{profile.tier.toUpperCase()}</span>}
          {quota && (
            <span className={`text-xs ${atLimit ? 'text-red-400' : 'text-white/40'}`}>
              {quota.used}/{quota.limit} posts today
            </span>
          )}
          {profile?.is_admin && <Link href="/admin" className="text-xs bg-white/10 text-white/70 border border-white/10 px-3 py-1.5 rounded-lg hover:bg-white/20">⚙ Admin</Link>}
          <Link href="/dashboard" className="text-xs text-white/30 hover:text-white">← Dashboard</Link>
        </div>
      </nav>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold mb-1">✨ Post Studio</h1>
          <p className="text-white/40 text-sm">Generate viral posts from any clip — URL, transcript, or just describe what happened.</p>
        </div>

        {atLimit && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-6 flex items-center justify-between gap-4">
            <p className="text-red-400 text-sm">Daily limit reached ({quota?.used}/{quota?.limit}). {profile?.tier === 'free' ? 'Upgrade for 25 posts/day.' : 'Resets in 24 hours.'}</p>
            {profile?.tier === 'free' && <Link href="/pricing" className="text-xs bg-[#FF6B00] text-white px-3 py-1.5 rounded-lg whitespace-nowrap">Upgrade</Link>}
          </div>
        )}

        <form onSubmit={handleGenerate} className="space-y-4">

          {/* Input type selector */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <p className="text-xs text-white/40 mb-3 font-medium uppercase tracking-wide">Input type</p>
            <div className="grid grid-cols-3 gap-2">
              {INPUT_TYPES.map(t => (
                <button key={t.key} type="button" onClick={() => { setInputType(t.key); setInput('') }}
                  className={`text-left p-3 rounded-xl border transition-colors ${inputType === t.key ? 'bg-[#FF6B00]/10 border-[#FF6B00]/40 text-white' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'}`}>
                  <p className="text-sm font-medium mb-0.5">{t.label}</p>
                  <p className="text-xs opacity-60 leading-tight">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Input field */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">
              {inputType === 'url' ? 'Video URL' : inputType === 'transcript' ? 'Transcript' : 'What happened'}
            </p>
            {inputType === 'url' ? (
              <input type="url" value={input} onChange={e => setInput(e.target.value)} required
                placeholder={inputPlaceholders[inputType]}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
            ) : (
              <textarea value={input} onChange={e => setInput(e.target.value)} required
                placeholder={inputPlaceholders[inputType]} rows={inputType === 'transcript' ? 8 : 4}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00] resize-none" />
            )}

            {/* Optional title/context */}
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Title or context (optional — helps AI use real names)"
              className="mt-3 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
          </div>

          {/* Platform + Tone */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <div>
              <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Platform</p>
              <div className="flex gap-2 flex-wrap">
                {PLATFORMS.map(p => (
                  <button key={p.key} type="button" onClick={() => setPlatform(p.key)}
                    className={`text-xs px-3 py-2 rounded-lg border transition-colors ${platform === p.key ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
                    {p.icon} {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Tone</p>
              <div className="flex gap-2 flex-wrap">
                {TONES.map(t => (
                  <button key={t.key} type="button" onClick={() => setTone(t.key)}
                    className={`text-xs px-3 py-2 rounded-lg border transition-colors ${tone === t.key ? 'bg-white/20 text-white border-white/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button type="submit" disabled={generating || !input.trim() || !!atLimit}
            className="w-full py-3 bg-[#FF6B00] text-white font-medium rounded-2xl hover:bg-[#e55f00] disabled:opacity-50 transition-colors text-sm">
            {generating
              ? inputType === 'url' ? '🔍 Extracting transcript...' : '✨ Generating 3 posts...'
              : '✨ Generate posts'}
          </button>
        </form>

        {error && (
          <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="mt-8 space-y-4">
            {result.hook_line && (
              <div className="bg-[#FF6B00]/5 border border-[#FF6B00]/20 rounded-2xl px-5 py-4">
                <p className="text-xs text-[#FF6B00]/70 mb-1 font-medium">Hook line</p>
                <p className="text-sm text-white/80 italic">"{result.hook_line}"</p>
              </div>
            )}

            {result.extracted_title && (
              <p className="text-xs text-white/30 px-1">Detected: {result.extracted_title}</p>
            )}

            <div className="space-y-3">
              {result.options.map((option, i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-white/50 font-medium">
                      {i === 0 ? '🔥 Option 1 — Hot Take' : i === 1 ? '💬 Option 2 — Pull Quote' : '📣 Option 3 — Announcement'}
                    </span>
                    <span className="text-xs text-white/20">{option.length} chars</span>
                  </div>
                  <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{option}</p>
                  <button onClick={() => copy(option, i)}
                    className={`mt-4 w-full text-xs py-2.5 rounded-xl transition-colors ${copied === i ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}>
                    {copied === i ? '✓ Copied to clipboard!' : '📋 Copy'}
                  </button>
                </div>
              ))}
            </div>

            <button onClick={() => setResult(null)} className="w-full text-xs py-2.5 rounded-2xl bg-white/5 text-white/30 border border-white/10 hover:bg-white/10">
              ↺ Generate new posts
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
