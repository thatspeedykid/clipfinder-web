// src/app/page.tsx
// Landing page — shown to logged-out users

import Link from 'next/link'

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-[#FF6B00] font-bold text-xl tracking-tight">CLIP</span>
          <span className="font-bold text-xl tracking-tight">FINDER</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-white/60 hover:text-white transition-colors">
            Pricing
          </Link>
          <Link href="/studio" className="text-sm text-white/60 hover:text-white transition-colors">
            Post Studio
          </Link>
          <Link href="/login" className="text-sm text-white/60 hover:text-white transition-colors">
            Sign in
          </Link>
          <Link
            href="/login"
            className="bg-[#FF6B00] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#e55f00] transition-colors"
          >
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
          Find the best clips in
          <span className="text-[#FF6B00]"> any stream</span>
        </h1>

        <p className="text-white/50 text-lg max-w-xl mb-10">
          Paste a YouTube or Kick URL. ClipFinder transcribes it, finds the viral moments,
          and gives you ready-to-post clips. No watermarks. No guessing.
        </p>

        <Link
          href="/login"
          className="bg-[#FF6B00] text-white font-semibold px-8 py-3.5 rounded-xl text-base hover:bg-[#e55f00] transition-colors"
        >
          Start clipping for free →
        </Link>

        <p className="text-white/30 text-xs mt-4">3 free clips/day · No credit card needed</p>
      </section>

      {/* Features */}
      <section className="border-t border-white/10 px-6 py-16">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8">
          {[
            {
              icon: '⚡',
              title: 'Parallel AI analysis',
              desc: 'Gemini and Groq run simultaneously. Fastest result wins.',
            },
            {
              icon: '🎯',
              title: 'Drama-tuned prompts',
              desc: 'Not generic AI. Trained to find callouts, reveals, and rants.',
            },
            {
              icon: '🎬',
              title: 'Three modes',
              desc: 'Auto clip, interview mode, or auto-edit for long compilations.',
            },
          ].map((f) => (
            <div key={f.title} className="bg-white/5 rounded-xl p-5 border border-white/10">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-white/50 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-6 flex items-center justify-between text-xs text-white/30">
        <span>ClipFinder · AGPL-3.0 · Open source</span>
        <div className="flex gap-4">
          <a href="https://github.com/thatspeedykid/clipfinder" className="hover:text-white transition-colors">GitHub</a>
          <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
        </div>
      </footer>
    </main>
  )
}
