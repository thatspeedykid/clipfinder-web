'use client'
// src/components/Nav.tsx
// Shared nav — used on every page except /admin
// CLIPFINDER  [🎬 ClipFinder] [✨ Studio]          TIER  quota  Admin  | History  Settings  Sign out

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Profile = {
  tier: string
  is_admin: boolean
  clips_today: number
}

type Quota = {
  used: number
  limit: number
}

const MODULES = [
  { href: '/dashboard', label: 'ClipFinder', icon: '🎬' },
  { href: '/studio',    label: 'Studio',     icon: '✨' },
]

export default function Nav() {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const tokenRef = useRef<string>('')

  const [profile, setProfile] = useState<Profile | null>(null)
  const [quota, setQuota] = useState<Quota | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      tokenRef.current = session.access_token
      const res = await fetch('/api/user', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (res.ok) {
        const d = await res.json()
        setProfile(d.profile)
        setQuota(d.quota)
      }
    })
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/')
  }

  const tierColor = {
    free:   'bg-white/10 text-white/50',
    pro:    'bg-[#FF6B00]/20 text-[#FF6B00]',
    agency: 'bg-purple-500/20 text-purple-400',
  }[profile?.tier ?? 'free'] ?? 'bg-white/10 text-white/50'

  return (
    <nav className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-[#0f0f0f] sticky top-0 z-30">

      {/* Left — Logo + module tabs */}
      <div className="flex items-center gap-1">
        <Link href="/" className="flex items-center gap-0.5 mr-4 flex-shrink-0">
          <span className="text-[#FF6B00] font-bold text-xl tracking-tight">CLIP</span>
          <span className="font-bold text-xl tracking-tight text-white">FINDER</span>
        </Link>

        {MODULES.map(m => {
          const active = pathname === m.href || (m.href !== '/dashboard' && pathname.startsWith(m.href))
          return (
            <Link key={m.href} href={m.href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}>
              <span>{m.icon}</span>
              <span>{m.label}</span>
            </Link>
          )
        })}
      </div>

      {/* Right — tier, quota, admin, utilities */}
      <div className="flex items-center gap-3">
        {profile && (
          <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${tierColor}`}>
            {profile.tier.toUpperCase()}
          </span>
        )}
        {quota && (
          <span className="text-xs text-white/40 flex-shrink-0">
            {quota.used}/{quota.limit}
          </span>
        )}
        {profile?.is_admin && (
          <Link href="/admin"
            className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-white/80 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-white/15 transition-colors flex-shrink-0">
            ⚙️ Admin
          </Link>
        )}
        {profile?.tier === 'free' && !profile?.is_admin && (
          <Link href="/pricing"
            className="text-xs bg-[#FF6B00] text-white px-3 py-1.5 rounded-lg hover:bg-[#e55f00] flex-shrink-0">
            Upgrade
          </Link>
        )}
        <div className="flex items-center gap-3 pl-3 border-l border-white/10">
          <Link href="/history" className={`text-xs transition-colors ${pathname === '/history' ? 'text-white' : 'text-white/40 hover:text-white'}`}>History</Link>
          <Link href="/settings" className={`text-xs transition-colors ${pathname === '/settings' ? 'text-white' : 'text-white/40 hover:text-white'}`}>Settings</Link>
          <button onClick={signOut} className="text-xs text-white/30 hover:text-white transition-colors">Sign out</button>
        </div>
      </div>
    </nav>
  )
}
