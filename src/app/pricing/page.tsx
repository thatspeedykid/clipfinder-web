import Link from 'next/link'

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    desc: 'Try it out, no card needed',
    cta: 'Start free',
    ctaHref: '/login',
    featured: false,
    features: [
      '3 clips per day',
      '3 Post Studio generations/day',
      'YouTube + Kick + Twitch + Twitter',
      'Auto clip mode',
      'AI clip detection',
      'Download clips',
    ],
    missing: ['Interview mode', 'Auto-edit mode', 'Parallel processing', 'Tweet generator', 'Priority transcription'],
  },
  {
    name: 'Pro',
    price: '$12',
    period: 'per month',
    desc: 'For creators and editors',
    cta: 'Get Pro',
    ctaHref: '/login',
    featured: true,
    features: [
      '50 clips per day',
      '25 Post Studio generations/day',
      'All AI modes (auto, interview, auto-edit)',
      'All platforms',
      'Parallel processing (3×)',
      'Priority transcription',
      'Tweet + post generator',
      'Cloud clip storage (30 days)',
      'Email support',
    ],
    missing: [],
  },
  {
    name: 'Agency',
    price: '$39',
    period: 'per month',
    desc: 'For teams and power users',
    cta: 'Get Agency',
    ctaHref: '/login',
    featured: false,
    features: [
      'Unlimited clips',
      '100 Post Studio generations/day',
      'Parallel processing (10×)',
      '5 team seats',
      'API access',
      'Custom AI prompts',
      '90-day cloud storage',
      'Priority support',
      'Webhook callbacks',
    ],
    missing: [],
  },
]

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-0.5">
            <span className="text-[#FF6B00] font-bold text-xl tracking-tight">CLIP</span>
            <span className="font-bold text-xl tracking-tight">FINDER</span>
          </Link>
          <Link href="/dashboard" className="text-white/50 hover:text-white text-sm">🎬 ClipFinder</Link>
          <Link href="/studio" className="text-white/50 hover:text-white text-sm">✨ Studio</Link>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-white/60 hover:text-white">Sign in</Link>
          <Link href="/login" className="bg-[#FF6B00] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#e55f00]">Get started free</Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold mt-6 mb-3">Simple, honest pricing</h1>
          <p className="text-white/50">Pay for what you use. Cancel anytime. Self-host for free.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map(plan => (
            <div key={plan.name} className={`rounded-2xl border p-6 flex flex-col ${plan.featured ? 'border-[#FF6B00] bg-[#FF6B00]/5' : 'border-white/10 bg-white/5'}`}>
              {plan.featured && (
                <div className="text-xs font-semibold text-[#FF6B00] bg-[#FF6B00]/10 rounded-full px-3 py-1 w-fit mb-4">Most popular</div>
              )}
              <div className="mb-6">
                <h2 className="font-semibold text-lg">{plan.name}</h2>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-white/40 text-sm">/{plan.period}</span>
                </div>
                <p className="text-white/50 text-sm mt-1">{plan.desc}</p>
              </div>
              <ul className="flex-1 space-y-2 mb-8">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-white/80">
                    <span className="text-green-400 mt-0.5">✓</span>{f}
                  </li>
                ))}
                {plan.missing.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-white/30">
                    <span className="mt-0.5">✗</span>{f}
                  </li>
                ))}
              </ul>
              <Link href={plan.ctaHref}
                className={`text-center py-2.5 rounded-xl font-medium text-sm transition-colors ${plan.featured ? 'bg-[#FF6B00] text-white hover:bg-[#e55f00]' : 'border border-white/20 text-white hover:bg-white/10'}`}>
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="text-center text-white/30 text-sm mt-10">
          Want to self-host?{' '}
          <a href="https://github.com/thatspeedykid/clipfinder-web" className="text-white/50 hover:text-white underline">
            ClipFinder is open source (AGPL-3.0)
          </a>
        </p>
      </div>
    </main>
  )
}
