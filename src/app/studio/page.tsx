'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

type InputType = 'url' | 'transcript' | 'prompt'
type Platform = 'twitter' | 'instagram' | 'tiktok' | 'youtube'
type Tone = 'drama' | 'tea' | 'breaking' | 'hype' | 'exaggerate'

const PLATFORMS: { key: Platform; label: string; icon: string; limit: number }[] = [
  { key: 'twitter',   label: 'Twitter/X',  icon: '𝕏',  limit: 280 },
  { key: 'instagram', label: 'Instagram',  icon: '📸', limit: 2200 },
  { key: 'tiktok',    label: 'TikTok',     icon: '🎵', limit: 150 },
  { key: 'youtube',   label: 'YT Shorts',  icon: '▶',  limit: 500 },
]

const TONES: { key: Tone; label: string; desc: string }[] = [
  { key: 'drama',      label: '🔥 Drama',      desc: 'Tea spiller energy' },
  { key: 'tea',        label: '☕ Tea',         desc: 'Calm but devastating' },
  { key: 'breaking',   label: '📰 Breaking',   desc: 'Journalistic urgency' },
  { key: 'hype',       label: '💥 Hype',       desc: 'Unmissable energy' },
  { key: 'exaggerate', label: '🤯 Exaggerate', desc: 'Multi-line story' },
]

const INPUT_TYPES: { key: InputType; label: string; desc: string }[] = [
  { key: 'url',        label: '🔗 URL',        desc: 'YouTube, Kick, Twitch, Twitter' },
  { key: 'transcript', label: '📝 Transcript', desc: 'Paste text or subtitles' },
  { key: 'prompt',     label: '💭 Prompt',     desc: 'Describe what happened' },
]

const EXAMPLE_OUTPUTS = [
  {
    platform: '𝕏 Twitter/X',
    tone: '🔥 Drama',
    hook: '"I took the job to get Sam Pepper out."',
    options: [
      { label: '🔥 Hot Take', text: 'Mizkif just admitted his #1 reason for taking the Kick job was to BAN SAM PEPPER. 🐸 "Let\'s just say there were some people I wanted gone" #Mizkif #Kick #Drama' },
      { label: '💬 Pull Quote', text: '"I took the job specifically to remove certain people from the platform" — Mizkif drops the most honest thing he\'s ever said on stream 👀 #Exposed' },
      { label: '📣 Announcement', text: 'BREAKING: Mizkif reveals the REAL reason he joined Kick — and it has everything to do with Sam Pepper. Full clip you need to see 🧵 #Mizkif #Kick' },
    ]
  },
  {
    platform: '🤯 Exaggerate',
    tone: '🤯 Exaggerate',
    hook: 'He planned this for months.',
    options: [
      { label: '🤯 Exaggerate', text: '🚨 MIZKIF ADMITTED HE INFILTRATED KICK TO BAN SAM PEPPER 😳\nHe applied for the job with one specific mission in mind 👀\nMonths of planning just to remove one person from the platform 💔\nKick had no idea they hired their own saboteur 💸🔥\nThe whole thing just collapsed live on stream ⚡\n#Mizkif #Kick #SamPepper' },
    ]
  }
]

type Result = { options: string[]; hook_line: string; extracted_title?: string }

export default function StudioPage() {
  const router = useRouter()
  const supabase = createClient()
  const tokenRef = useRef<string>('')

  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [profile, setProfile] = useState<{ tier: string; is_admin: boolean } | null>(null)
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)
  const [inputType, setInputType] = useState<InputType>('url')
  const [input, setInput] = useState('')
  const [title, setTitle] = useState('')
  const [platforms, setPlatforms] = useState<Platform[]>(['twitter'])
  const [tone, setTone] = useState<Tone>('drama')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Record<Platform, Result>>({} as Record<Platform, Result>)
  const [activePlatform, setActivePlatform] = useState<Platform>('twitter')
  const [copied, setCopied] = useState<number | null>(null)
  const [hasGenerated, setHasGenerated] = useState(false)
  const [activeExample, setActiveExample] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setIsLoggedIn(!!session)
      if (!session) return
      tokenRef.current = session.access_token
      const [userRes, quotaRes] = await Promise.all([
        fetch('/api/user', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch('/api/studio', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ])
      if (userRes.ok) { const d = await userRes.json(); setProfile(d.profile) }
      if (quotaRes.ok) { const d = await quotaRes.json(); setQuota(d.quota) }
    })
  }, [])

  function togglePlatform(p: Platform) {
    setPlatforms(prev => prev.includes(p) ? (prev.length === 1 ? prev : prev.filter(x => x !== p)) : [...prev, p])
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || platforms.length === 0) return
    setGenerating(true); setError(''); setResults({} as Record<Platform, Result>); setHasGenerated(false)

    const calls = platforms.map(platform =>
      fetch('/api/studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ inputType, input, title, platform, tone }),
      }).then(r => r.json()).then(d => ({ platform, data: d }))
    )

    try {
      const allResults = await Promise.allSettled(calls)
      const newResults: Record<string, Result> = {}
      allResults.forEach(r => {
        if (r.status === 'fulfilled' && r.value.data.options) {
          newResults[r.value.platform] = r.value.data
          if (r.value.data.extracted_title && !title) setTitle(r.value.data.extracted_title)
        }
      })
      setResults(newResults as Record<Platform, Result>)
      setActivePlatform(platforms[0])
      setHasGenerated(true)
      const quotaRes = await fetch('/api/studio', { headers: { Authorization: `Bearer ${tokenRef.current}` } })
      if (quotaRes.ok) { const d = await quotaRes.json(); setQuota(d.quota) }
    } catch { setError('Generation failed') }
    setGenerating(false)
  }

  async function copy(text: string, index: number) {
    await navigator.clipboard.writeText(text)
    setCopied(index); setTimeout(() => setCopied(null), 2000)
  }

  const atLimit = quota && quota.used >= quota.limit && !profile?.is_admin

  // ── LANDING PAGE (logged out) ──────────────────────────────────────────────
  if (isLoggedIn === false) {
    return (
      <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
        {/* Nav */}
        <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-0.5">
              <span className="text-[#FF6B00] font-bold text-xl tracking-tight">CLIP</span>
              <span className="font-bold text-xl tracking-tight">FINDER</span>
            </Link>
            <Link href="/dashboard" className="text-white/50 hover:text-white text-sm">🎬 ClipFinder</Link>
            <Link href="/studio" className="text-white text-sm font-medium">✨ Studio</Link>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-sm text-white/60 hover:text-white">Pricing</Link>
            <Link href="/login" className="text-sm text-white/60 hover:text-white">Sign in</Link>
            <Link href="/login" className="bg-[#FF6B00] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#e55f00]">Try free</Link>
          </div>
        </nav>

        {/* Hero */}
        <section className="flex flex-col items-center text-center px-4 py-20">
          <div className="inline-flex items-center gap-2 bg-[#FF6B00]/10 border border-[#FF6B00]/20 rounded-full px-3 py-1 text-xs text-[#FF6B00] mb-6">
            ✨ Post Studio — Free to start
          </div>
          <h1 className="text-5xl font-bold mb-5 max-w-2xl">
            Turn any clip into a<br /><span className="text-[#FF6B00]">viral post</span> in seconds
          </h1>
          <p className="text-white/50 text-lg max-w-xl mb-8">
            Paste a URL, transcript, or just describe what happened. Get 3 platform-ready posts in 5 tones — optimized for Twitter, Instagram, TikTok, and YouTube Shorts.
          </p>
          <div className="flex gap-3">
            <Link href="/login" className="bg-[#FF6B00] text-white font-semibold px-8 py-3.5 rounded-xl hover:bg-[#e55f00]">
              Start generating free →
            </Link>
            <Link href="/pricing" className="bg-white/10 border border-white/10 text-white px-6 py-3.5 rounded-xl hover:bg-white/15">
              See pricing
            </Link>
          </div>
          <p className="text-white/30 text-xs mt-3">3 free generations/day · No credit card</p>
        </section>

        {/* How it works */}
        <section className="border-t border-white/10 px-6 py-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-center mb-10">Three ways to use Post Studio</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { icon: '🔗', title: 'Paste a URL', desc: 'YouTube, Kick, Twitch, or Twitter link. We extract the transcript automatically — no download required.', badge: 'No storage' },
                { icon: '📝', title: 'Paste a transcript', desc: 'Already have subtitles or a transcript? Paste it directly and skip the extraction step entirely.', badge: 'Instant' },
                { icon: '💭', title: 'Describe it', desc: 'No clip at all? Just describe what happened — who said what, the drama, the moment. AI fills in the rest.', badge: 'Any content' },
              ].map(item => (
                <div key={item.title} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <div className="text-3xl mb-3">{item.icon}</div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold">{item.title}</h3>
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">{item.badge}</span>
                  </div>
                  <p className="text-white/50 text-sm">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5 tones */}
        <section className="border-t border-white/10 px-6 py-16 bg-white/[0.02]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-center mb-3">5 tones built for drama content</h2>
            <p className="text-white/50 text-center mb-10">Each tone is specifically written for streaming/drama clip channels — not generic AI captions.</p>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              {[
                { icon: '🔥', tone: 'Drama', desc: 'Tea spiller energy. Shocking, pointed, pull receipts.' },
                { icon: '☕', tone: 'Tea', desc: 'Calm but devastating. "So apparently..." energy.' },
                { icon: '📰', tone: 'Breaking', desc: 'Urgent, journalistic. Treat it like real news.' },
                { icon: '💥', tone: 'Hype', desc: 'Positive energy. Make it feel unmissable.' },
                { icon: '🤯', tone: 'Exaggerate', desc: 'Wild multi-line story format. Each line builds tension.' },
              ].map(t => (
                <div key={t.tone} className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                  <div className="text-2xl mb-2">{t.icon}</div>
                  <p className="font-medium text-sm mb-1">{t.tone}</p>
                  <p className="text-white/40 text-xs leading-tight">{t.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Live examples */}
        <section className="border-t border-white/10 px-6 py-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-center mb-3">Real output examples</h2>
            <p className="text-white/50 text-center mb-8">Generated from real Mizkif/Kick drama content</p>

            <div className="flex gap-2 justify-center mb-6">
              {EXAMPLE_OUTPUTS.map((ex, i) => (
                <button key={i} onClick={() => setActiveExample(i)}
                  className={`text-xs px-4 py-2 rounded-lg border transition-colors ${activeExample === i ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
                  {ex.platform} · {ex.tone}
                </button>
              ))}
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="bg-[#FF6B00]/5 border border-[#FF6B00]/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-xs text-[#FF6B00]/70 mb-1">Hook line</p>
                <p className="text-sm text-white/80 italic">{EXAMPLE_OUTPUTS[activeExample].hook}</p>
              </div>
              <div className="space-y-3">
                {EXAMPLE_OUTPUTS[activeExample].options.map((opt, i) => (
                  <div key={i} className="bg-black/30 rounded-xl p-4">
                    <p className="text-xs text-white/40 mb-2">{opt.label}</p>
                    <p className="text-sm text-white/80 whitespace-pre-wrap">{opt.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 3 options explained */}
        <section className="border-t border-white/10 px-6 py-16 bg-white/[0.02]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-center mb-3">Always 3 options, every time</h2>
            <p className="text-white/50 text-center mb-10">Same event, three different angles. Pick the one that hits hardest.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { icon: '🔥', title: 'Hot Take', desc: 'Your punchy opinion or reaction. Lead with the most shocking element. Strong opener, spicy take.' },
                { icon: '💬', title: 'Pull Quote', desc: 'Lead with an actual quote from the transcript, then react. The most credible format.' },
                { icon: '📣', title: 'Announcement', desc: 'Frame it like breaking news. Create urgency. Make people feel they need to watch right now.' },
              ].map(o => (
                <div key={o.title} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <div className="text-2xl mb-3">{o.icon}</div>
                  <h3 className="font-semibold mb-2">{o.title}</h3>
                  <p className="text-white/50 text-sm">{o.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-white/10 px-6 py-20 text-center">
          <h2 className="text-3xl font-bold mb-4">Start generating viral posts</h2>
          <p className="text-white/50 mb-8">3 free generations per day. No credit card. Takes 10 seconds.</p>
          <Link href="/login" className="bg-[#FF6B00] text-white font-semibold px-10 py-4 rounded-xl text-lg hover:bg-[#e55f00] inline-block">
            Try Post Studio free →
          </Link>
          <p className="text-white/30 text-xs mt-4">Already have an account? <Link href="/login" className="underline hover:text-white">Sign in</Link></p>
        </section>

        <footer className="border-t border-white/10 px-6 py-6 flex items-center justify-between text-xs text-white/30">
          <span>ClipFinder · AGPL-3.0</span>
          <div className="flex gap-4">
            <a href="https://github.com/thatspeedykid/clipfinder-web" className="hover:text-white">GitHub</a>
            <Link href="/pricing" className="hover:text-white">Pricing</Link>
          </div>
        </footer>
      </main>
    )
  }

  // ── LOADING ────────────────────────────────────────────────────────────────
  if (isLoggedIn === null) {
    return <main className="min-h-screen bg-[#0f0f0f] flex items-center justify-center"><p className="text-white/30 text-sm">Loading...</p></main>
  }

  // ── APP (logged in) ────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left panel */}
        <div className="lg:w-[420px] lg:flex-shrink-0 lg:border-r border-white/10 px-6 py-8 lg:overflow-y-auto lg:h-[calc(100vh-49px)] lg:sticky lg:top-[49px]">
          <div className="mb-6">
            <h1 className="text-xl font-semibold mb-1">✨ Post Studio</h1>
            <p className="text-white/40 text-sm">Generate viral posts from any clip.</p>
            {quota && <p className={`text-xs mt-1 ${atLimit ? 'text-red-400' : 'text-white/30'}`}>{quota.used}/{quota.limit} today</p>}
          </div>

          {atLimit && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4 flex items-center justify-between">
              <p className="text-red-400 text-xs">{profile?.tier === 'free' ? 'Upgrade for 25/day.' : 'Resets in 24h.'}</p>
              {profile?.tier === 'free' && <Link href="/pricing" className="text-xs bg-[#FF6B00] text-white px-2.5 py-1 rounded-lg">Upgrade</Link>}
            </div>
          )}

          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Input</p>
              <div className="grid grid-cols-3 gap-1.5">
                {INPUT_TYPES.map(t => (
                  <button key={t.key} type="button" onClick={() => { setInputType(t.key); setInput('') }}
                    className={`text-left p-2.5 rounded-xl border transition-colors ${inputType === t.key ? 'bg-[#FF6B00]/10 border-[#FF6B00]/40 text-white' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'}`}>
                    <p className="text-xs font-medium">{t.label}</p>
                    <p className="text-xs opacity-50 mt-0.5 leading-tight">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              {inputType === 'url' ? (
                <input type="url" value={input} onChange={e => setInput(e.target.value)} required
                  placeholder="https://youtube.com/watch?v=..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
              ) : (
                <textarea value={input} onChange={e => setInput(e.target.value)} required
                  placeholder={inputType === 'transcript' ? 'Paste transcript...' : 'Describe what happened...'}
                  rows={5} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00] resize-none" />
              )}
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Title / context (optional)"
                className="mt-2 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
            </div>

            <div>
              <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Platforms</p>
              <div className="flex gap-2 flex-wrap">
                {PLATFORMS.map(p => (
                  <button key={p.key} type="button" onClick={() => togglePlatform(p.key)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${platforms.includes(p.key) ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
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
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${tone === t.key ? 'bg-white/20 text-white border-white/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <button type="submit" disabled={generating || !input.trim() || platforms.length === 0 || !!atLimit}
              className="w-full py-2.5 bg-[#FF6B00] text-white font-medium rounded-xl hover:bg-[#e55f00] disabled:opacity-50 text-sm">
              {generating ? `✨ Generating...` : `✨ Generate${platforms.length > 1 ? ` for ${platforms.length} platforms` : ''}`}
            </button>
          </form>
          {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
        </div>

        {/* Right panel */}
        <div className="flex-1 px-6 py-8 lg:overflow-y-auto">
          {!hasGenerated ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-white/20">
              <p className="text-5xl mb-4">✨</p>
              <p className="text-sm">Results will appear here</p>
              <p className="text-xs mt-1">Pick platforms, add your input, and generate</p>
            </div>
          ) : (
            <div>
              {platforms.length > 1 && (
                <div className="flex gap-2 mb-6 flex-wrap">
                  {platforms.map(p => {
                    const pInfo = PLATFORMS.find(x => x.key === p)
                    return (
                      <button key={p} onClick={() => setActivePlatform(p)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors ${activePlatform === p ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
                        {pInfo?.icon} {pInfo?.label}
                        {results[p] && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                      </button>
                    )
                  })}
                </div>
              )}

              {results[activePlatform] ? (
                <div className="space-y-4">
                  {results[activePlatform].hook_line && (
                    <div className="bg-[#FF6B00]/5 border border-[#FF6B00]/20 rounded-2xl px-5 py-4">
                      <p className="text-xs text-[#FF6B00]/70 mb-1 font-medium">Hook line</p>
                      <p className="text-sm text-white/80 italic">"{results[activePlatform].hook_line}"</p>
                    </div>
                  )}
                  {results[activePlatform].extracted_title && <p className="text-xs text-white/30">Detected: {results[activePlatform].extracted_title}</p>}
                  {results[activePlatform].options.map((option, i) => (
                    <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-white/50 font-medium">{i === 0 ? '🔥 Hot Take' : i === 1 ? '💬 Pull Quote' : '📣 Announcement'}</span>
                        <span className={`text-xs ${option.length > (PLATFORMS.find(p => p.key === activePlatform)?.limit ?? 9999) ? 'text-red-400' : 'text-white/20'}`}>{option.length} chars</span>
                      </div>
                      <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{option}</p>
                      <button onClick={() => copy(option, i)}
                        className={`mt-4 w-full text-xs py-2.5 rounded-xl transition-colors ${copied === i ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}>
                        {copied === i ? '✓ Copied!' : '📋 Copy'}
                      </button>
                    </div>
                  ))}
                  <button onClick={() => { setHasGenerated(false); setResults({} as Record<Platform, Result>) }}
                    className="w-full text-xs py-2.5 rounded-2xl bg-white/5 text-white/30 border border-white/10 hover:bg-white/10">↺ Clear</button>
                </div>
              ) : (
                <div className="text-center text-white/20 py-8"><p className="text-sm">No results for this platform yet</p></div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
