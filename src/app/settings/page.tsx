'use client'
// src/app/settings/page.tsx

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<{ tier: string; clips_today: number; is_admin: boolean } | null>(null)
  const [cookies, setCookies] = useState('')
  const [savingCookies, setSavingCookies] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace('/login'); return }
      setUser(user)
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      fetch('/api/user', { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json()).then(({ profile }) => setProfile(profile))
    })
  }, [])

  async function saveCookies() {
    setSavingCookies(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await fetch('/api/user/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ cookies }),
    })
    setSavingCookies(false)
    showToast('YouTube cookies saved!')
  }

  async function signOut() { await supabase.auth.signOut(); router.replace('/') }

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <Link href="/dashboard" className="flex items-center gap-1">
          <span className="text-[#FF6B00] font-bold text-lg">CLIP</span>
          <span className="font-bold text-lg">FINDER</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-xs text-white/40 hover:text-white">← Dashboard</Link>
          <button onClick={signOut} className="text-xs text-white/30 hover:text-white">Sign out</button>
        </div>
      </nav>

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#FF6B00] text-white text-sm px-4 py-2 rounded-xl">{toast}</div>
      )}

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">
        <h1 className="text-xl font-semibold mb-8">Settings</h1>

        {/* Account info */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-medium mb-4 text-white/60">Account</h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Email</span>
              <span>{user?.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Plan</span>
              <span className="capitalize">{profile?.tier ?? 'free'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Clips today</span>
              <span>{profile?.clips_today ?? 0}</span>
            </div>
          </div>
          {profile?.tier === 'free' && (
            <Link href="/pricing" className="mt-4 block text-center text-xs bg-[#FF6B00] text-white py-2 rounded-xl hover:bg-[#e55f00]">
              Upgrade to Pro — $12/mo
            </Link>
          )}
        </div>

        {/* YouTube cookies */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-medium mb-1 text-white/60">YouTube cookies (bypass age restrictions)</h2>
          <p className="text-xs text-white/30 mb-4">
            If YouTube videos fail to download, paste your cookies here. Export them using the <a href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc" target="_blank" rel="noopener" className="text-[#FF6B00] underline">Get cookies.txt</a> Chrome extension. Your cookies are encrypted and stored securely.
          </p>
          <textarea
            value={cookies}
            onChange={e => setCookies(e.target.value)}
            placeholder="# Netscape HTTP Cookie File&#10;.youtube.com TRUE / FALSE ..."
            rows={6}
            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-xs font-mono text-white/70 placeholder-white/20 focus:outline-none focus:border-[#FF6B00] resize-none"
          />
          <button onClick={saveCookies} disabled={savingCookies || !cookies.trim()}
            className="mt-3 text-sm bg-[#FF6B00] text-white px-4 py-2 rounded-xl disabled:opacity-50 hover:bg-[#e55f00]">
            {savingCookies ? 'Saving...' : 'Save cookies'}
          </button>
        </div>

        {/* Danger zone */}
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5">
          <h2 className="text-sm font-medium mb-3 text-red-400/80">Danger zone</h2>
          <button onClick={signOut} className="text-xs text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500/10">
            Sign out of all devices
          </button>
        </div>
      </div>
    </main>
  )
}
