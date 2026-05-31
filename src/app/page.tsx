'use client'
import Link from 'next/link'
import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LandingPage() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard')
    })
  }, [])

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-0.5">
            <span className="text-[#FF6B00] font-bold text-xl tracking-tight">CLIP</span>
            <span className="font-bold text-xl tracking-tight">FINDER</span>
          </Link>
          <Link href="/dashboard" className="flex items-center gap-1.5 text-white/50 hover:text-white text-sm transition-colors">
            🎬 ClipFinder
          </Link>
          <Link href="/studio" className="flex items-center gap-1.5 text-white/50 hover:text-white text-sm transition-colors">
            ✨ Studio
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-white/60 hover:text-white">Pricing</Link>
          <Link href="/login" className="text-sm text-white/60 hover:text-white">Sign in</Link>
          <Link href="/login" className="bg-[#FF6B00] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#e55f00]">
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-24">
        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1 text-xs text-white/60 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Open source · Powered by Gemini + Groq
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold leading-tight max-w-3xl mb-6">
          Find the best clips in<br />
          <span className="text-[#FF6B00]">any stream</span>
        </h1>
        <p className="text-white/50 text-lg max-w-xl mb-10">
          Paste a YouTube or Kick URL. ClipFinder transcribes it, finds the viral moments,
          and gives you ready-to-post clips. No watermarks. No guessing.
        </p>
        <Link href="/login" className="bg-[#FF6B00] text-white font-semibold px-8 py-3.5 rounded-xl text-base hover:bg-[#e55f00]">
          Start clipping for free →
        </Link>
        <p className="text-white/30 text-xs mt-4">3 free clips/day · No credit card needed</p>
      </section>

      {/* Features */}
      <section className="border-t border-white/10 px-6 py-16">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { icon: '⚡', title: 'Parallel AI analysis', desc: 'Gemini and Groq run simultaneously. Fastest result wins.' },
            { icon: '🎯', title: 'Drama-tuned prompts', desc: 'Not generic AI. Trained to find callouts, reveals, and rants.' },
            { icon: '🎬', title: 'Three modes', desc: 'Auto clip, interview mode, or auto-edit for long compilations.' },
          ].map(f => (
            <div key={f.title} className="bg-white/5 rounded-xl p-5 border border-white/10">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-white/50 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Post Studio promo */}
      <section className="border-t border-white/10 px-6 py-16 bg-white/[0.02]">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1">
            <div className="text-xs text-[#FF6B00] font-medium uppercase tracking-wider mb-3">✨ Post Studio</div>
            <h2 className="text-3xl font-bold mb-4">Turn clips into viral posts</h2>
            <p className="text-white/50 mb-6">Generate Twitter, Instagram, TikTok, and YouTube Shorts captions from any clip. 5 tones, 3 options per generation, real hook lines pulled from the transcript.</p>
            <Link href="/studio" className="inline-flex items-center gap-2 bg-white/10 border border-white/10 text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-white/15">
              Try Post Studio →
            </Link>
          </div>
          <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-6 space-y-3">
            <div className="flex gap-2">
              {['🔥 Drama', '☕ Tea', '📰 Breaking', '💥 Hype', '🤯 Exaggerate'].map(t => (
                <span key={t} className="text-xs bg-white/10 px-2 py-1 rounded-lg text-white/60">{t}</span>
              ))}
            </div>
            <div className="bg-black/30 rounded-xl p-4">
              <p className="text-xs text-[#FF6B00]/70 mb-1">Hook line</p>
              <p className="text-sm text-white/70 italic">"He actually said that on stream 💀"</p>
            </div>
            <div className="space-y-2">
              {['🔥 Hot Take', '💬 Pull Quote', '📣 Announcement'].map(o => (
                <div key={o} className="bg-white/5 rounded-lg px-3 py-2 text-xs text-white/50">{o}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-t border-white/10 px-6 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-3">Simple pricing</h2>
          <p className="text-white/50 mb-10">Start free. Upgrade when you need more.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { name: 'Free', price: '$0', desc: '3 clips/day', cta: 'Get started', href: '/login', featured: false },
              { name: 'Pro', price: '$12', desc: '50 clips/day + all features', cta: 'Start Pro', href: '/pricing', featured: true },
              { name: 'Agency', price: '$39', desc: 'Unlimited + API + team', cta: 'Go Agency', href: '/pricing', featured: false },
            ].map(p => (
              <div key={p.name} className={`rounded-2xl p-5 border ${p.featured ? 'border-[#FF6B00] bg-[#FF6B00]/5' : 'border-white/10 bg-white/5'}`}>
                <h3 className="font-semibold text-lg">{p.name}</h3>
                <div className="text-3xl font-bold my-2">{p.price}<span className="text-sm font-normal text-white/40">/mo</span></div>
                <p className="text-white/50 text-sm mb-4">{p.desc}</p>
                <Link href={p.href} className={`block text-center text-sm py-2 rounded-xl ${p.featured ? 'bg-[#FF6B00] text-white hover:bg-[#e55f00]' : 'bg-white/10 text-white hover:bg-white/15'}`}>
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-6 flex items-center justify-between text-xs text-white/30">
        <span>ClipFinder · AGPL-3.0 · Open source</span>
        <div className="flex gap-4">
          <a href="https://github.com/thatspeedykid/clipfinder-web" className="hover:text-white">GitHub</a>
          <Link href="/pricing" className="hover:text-white">Pricing</Link>
        </div>
      </footer>
    </main>
  )
}
