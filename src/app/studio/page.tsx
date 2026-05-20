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

type Result = { options: string[]; hook_line: string; extracted_title?: string }

export default function StudioPage() {
  const router = useRouter()
  const supabase = createClient()
  const tokenRef = useRef<string>('')

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

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
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
    setPlatforms(prev => {
      if (prev.includes(p)) {
        // Don't allow deselecting last one
        if (prev.length === 1) return prev
        return prev.filter(x => x !== p)
      }
      return [...prev, p]
    })
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || platforms.length === 0) return
    setGenerating(true); setError(''); setResults({} as Record<Platform, Result>); setHasGenerated(false)

    // Generate for all selected platforms in parallel
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
      // Update quota
      const quotaRes = await fetch('/api/studio', { headers: { Authorization: `Bearer ${tokenRef.current}` } })
      if (quotaRes.ok) { const d = await quotaRes.json(); setQuota(d.quota) }
    } catch (err) {
      setError('Generation failed')
    }
    setGenerating(false)
  }

  async function copy(text: string, index: number) {
    await navigator.clipboard.writeText(text)
    setCopied(index)
    setTimeout(() => setCopied(null), 2000)
  }

  const atLimit = quota && quota.used >= quota.limit && !profile?.is_admin
  const activeResult = results[activePlatform]

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />

      <div className="flex-1 flex flex-col lg:flex-row">

        {/* ── Left panel — input ───────────────────────────────────── */}
        <div className="lg:w-[420px] lg:flex-shrink-0 lg:border-r border-white/10 px-6 py-8 lg:overflow-y-auto lg:h-[calc(100vh-49px)] lg:sticky lg:top-[49px]">
          <div className="mb-6">
            <h1 className="text-xl font-semibold mb-1">✨ Post Studio</h1>
            <p className="text-white/40 text-sm">Generate viral posts from any clip.</p>
            {quota && (
              <p className={`text-xs mt-1 ${atLimit ? 'text-red-400' : 'text-white/30'}`}>
                {quota.used}/{quota.limit} generations today
              </p>
            )}
          </div>

          {atLimit && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
              <p className="text-red-400 text-xs">{profile?.tier === 'free' ? 'Upgrade for 25/day.' : 'Resets in 24h.'}</p>
              {profile?.tier === 'free' && <Link href="/pricing" className="text-xs bg-[#FF6B00] text-white px-2.5 py-1 rounded-lg">Upgrade</Link>}
            </div>
          )}

          <form onSubmit={handleGenerate} className="space-y-4">

            {/* Input type */}
            <div>
              <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Input</p>
              <div className="grid grid-cols-3 gap-1.5">
                {INPUT_TYPES.map(t => (
                  <button key={t.key} type="button" onClick={() => { setInputType(t.key); setInput('') }}
                    className={`text-left p-2.5 rounded-xl border transition-colors ${inputType === t.key ? 'bg-[#FF6B00]/10 border-[#FF6B00]/40 text-white' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'}`}>
                    <p className="text-xs font-medium">{t.label}</p>
                    <p className="text-xs opacity-50 leading-tight mt-0.5">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Input field */}
            <div>
              {inputType === 'url' ? (
                <input type="url" value={input} onChange={e => setInput(e.target.value)} required
                  placeholder="https://youtube.com/watch?v=..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
              ) : (
                <textarea value={input} onChange={e => setInput(e.target.value)} required
                  placeholder={inputType === 'transcript' ? 'Paste transcript or subtitles...' : 'Describe what happened...'}
                  rows={5}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00] resize-none" />
              )}
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Title / context (optional)"
                className="mt-2 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
            </div>

            {/* Platform — multi-select */}
            <div>
              <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Platforms <span className="text-white/20 normal-case">(select all that apply)</span></p>
              <div className="flex gap-2 flex-wrap">
                {PLATFORMS.map(p => {
                  const selected = platforms.includes(p.key)
                  return (
                    <button key={p.key} type="button" onClick={() => togglePlatform(p.key)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${selected ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
                      {p.icon} {p.label}
                    </button>
                  )
                })}
              </div>
              {platforms.length === 0 && <p className="text-xs text-red-400 mt-1">Select at least one platform</p>}
            </div>

            {/* Tone */}
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
              {generating
                ? (inputType === 'url' ? '🔍 Extracting...' : `✨ Generating for ${platforms.length} platform${platforms.length > 1 ? 's' : ''}...`)
                : `✨ Generate${platforms.length > 1 ? ` for ${platforms.length} platforms` : ''}`}
            </button>
          </form>

          {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
        </div>

        {/* ── Right panel — results ────────────────────────────────── */}
        <div className="flex-1 px-6 py-8 lg:overflow-y-auto">
          {!hasGenerated && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-white/20">
              <p className="text-5xl mb-4">✨</p>
              <p className="text-sm">Results will appear here</p>
              <p className="text-xs mt-1">Select platforms, fill in your input, and generate</p>
            </div>
          )}

          {hasGenerated && (
            <div>
              {/* Platform tabs if multiple */}
              {platforms.length > 1 && (
                <div className="flex gap-2 mb-6 flex-wrap">
                  {platforms.map(p => {
                    const pInfo = PLATFORMS.find(x => x.key === p)
                    const hasResult = !!results[p]
                    return (
                      <button key={p} onClick={() => setActivePlatform(p)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors ${activePlatform === p ? 'bg-[#FF6B00]/20 text-[#FF6B00] border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}>
                        {pInfo?.icon} {pInfo?.label}
                        {hasResult && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                      </button>
                    )
                  })}
                </div>
              )}

              {activeResult ? (
                <div className="space-y-4">
                  {/* Hook line */}
                  {activeResult.hook_line && (
                    <div className="bg-[#FF6B00]/5 border border-[#FF6B00]/20 rounded-2xl px-5 py-4">
                      <p className="text-xs text-[#FF6B00]/70 mb-1 font-medium">Hook line</p>
                      <p className="text-sm text-white/80 italic">"{activeResult.hook_line}"</p>
                    </div>
                  )}

                  {activeResult.extracted_title && (
                    <p className="text-xs text-white/30">Detected: {activeResult.extracted_title}</p>
                  )}

                  {activeResult.options.map((option, i) => (
                    <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-white/50 font-medium">
                          {i === 0 ? '🔥 Hot Take' : i === 1 ? '💬 Pull Quote' : '📣 Announcement'}
                        </span>
                        <span className={`text-xs ${option.length > (PLATFORMS.find(p => p.key === activePlatform)?.limit ?? 9999) ? 'text-red-400' : 'text-white/20'}`}>
                          {option.length} chars
                        </span>
                      </div>
                      <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{option}</p>
                      <button onClick={() => copy(option, i)}
                        className={`mt-4 w-full text-xs py-2.5 rounded-xl transition-colors ${copied === i ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}>
                        {copied === i ? '✓ Copied!' : '📋 Copy'}
                      </button>
                    </div>
                  ))}

                  <button onClick={() => { setHasGenerated(false); setResults({} as Record<Platform, Result>) }}
                    className="w-full text-xs py-2.5 rounded-2xl bg-white/5 text-white/30 border border-white/10 hover:bg-white/10">
                    ↺ Clear results
                  </button>
                </div>
              ) : (
                <div className="text-center text-white/20 py-8">
                  <p className="text-sm">No results for this platform yet</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
