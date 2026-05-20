'use client'
// src/app/settings/page.tsx

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<{ tier: string; clips_today: number; is_admin: boolean; yt_cookie_saved_at?: string } | null>(null)
  const [cookieStatus, setCookieStatus] = useState<{ has_cookies: boolean; saved_at: string | null } | null>(null)
  const [savingCookies, setSavingCookies] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [cookiePreview, setCookiePreview] = useState('')
  const tokenRef = useRef<string>('')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      tokenRef.current = session.access_token

      const { data: { user } } = await supabase.auth.getUser()
      if (user) setUser(user)

      // Load profile
      const userRes = await fetch('/api/user', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (userRes.ok) {
        const d = await userRes.json()
        setProfile(d.profile)
      }

      // Load cookie status
      const cookieRes = await fetch('/api/user/cookies', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (cookieRes.ok) {
        setCookieStatus(await cookieRes.json())
      }
    })
  }, [])

  // Handle file selection — read it client-side, never upload the file itself
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFileName(file.name)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setCookiePreview(text)
    }
    reader.readAsText(file)
  }

  async function saveCookies() {
    if (!cookiePreview.trim()) return
    setSavingCookies(true)

    const res = await fetch('/api/user/cookies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenRef.current}`
      },
      body: JSON.stringify({ cookies: cookiePreview }),
    })

    setSavingCookies(false)

    if (res.ok) {
      showToast('✓ YouTube cookies saved!')
      setCookieStatus({ has_cookies: true, saved_at: new Date().toISOString() })
      // Clear the preview and file input for security
      setCookiePreview('')
      setSelectedFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } else {
      const d = await res.json().catch(() => ({}))
      showToast(d.error ?? 'Failed to save cookies', 'error')
    }
  }

  async function clearCookies() {
    const res = await fetch('/api/user/cookies', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenRef.current}` }
    })
    if (res.ok) {
      showToast('Cookies cleared')
      setCookieStatus({ has_cookies: false, saved_at: null })
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/')
  }

  function daysSince(dateStr: string) {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  }

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />

      {toast && (
        <div className={`fixed top-4 right-4 z-50 text-white text-sm px-4 py-2 rounded-xl shadow-lg ${toastType === 'error' ? 'bg-red-500' : 'bg-[#FF6B00]'}`}>
          {toast}
        </div>
      )}

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">
        <h1 className="text-xl font-semibold mb-8">Settings</h1>

        {/* Account info */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-medium mb-4 text-white/60">Account</h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Email</span>
              <span className="text-white/80">{user?.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Plan</span>
              <span className="capitalize text-white/80">{profile?.tier ?? 'free'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Clips today</span>
              <span className="text-white/80">{profile?.clips_today ?? 0}</span>
            </div>
          </div>
          {profile?.tier === 'free' && (
            <Link href="/pricing" className="mt-4 block text-center text-xs bg-[#FF6B00] text-white py-2.5 rounded-xl hover:bg-[#e55f00]">
              Upgrade to Pro — $12/mo
            </Link>
          )}
        </div>

        {/* YouTube cookies */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-medium mb-1 text-white/60">YouTube cookies</h2>
          <p className="text-xs text-white/30 mb-4 leading-relaxed">
            Lets ClipFinder bypass age restrictions and login-required videos.
            Export using the{' '}
            <a href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
              target="_blank" rel="noopener" className="text-[#FF6B00] underline">
              Get cookies.txt
            </a>{' '}
            Chrome extension → export for youtube.com → upload the .txt file below.
            The file is read locally and immediately discarded — only the cookie text is sent.
          </p>

          {/* Current status */}
          {cookieStatus?.has_cookies && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-green-400 font-medium">✓ Cookies active</p>
                {cookieStatus.saved_at && (
                  <p className="text-xs text-white/30 mt-0.5">
                    Saved {daysSince(cookieStatus.saved_at)} days ago
                    {daysSince(cookieStatus.saved_at) >= 20 && ' — consider refreshing'}
                  </p>
                )}
              </div>
              <button onClick={clearCookies} className="text-xs text-red-400/70 hover:text-red-400">Clear</button>
            </div>
          )}

          {/* File upload */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-white/10 hover:border-white/20 rounded-xl p-6 text-center cursor-pointer transition-colors mb-3"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              onChange={handleFileSelect}
              className="hidden"
            />
            {selectedFileName ? (
              <div>
                <p className="text-sm text-green-400 font-medium">✓ {selectedFileName}</p>
                <p className="text-xs text-white/30 mt-1">Click to choose a different file</p>
              </div>
            ) : (
              <div>
                <p className="text-2xl mb-2">📄</p>
                <p className="text-sm text-white/60">Click to upload cookies.txt</p>
                <p className="text-xs text-white/30 mt-1">Only .txt files · File is never stored on our servers</p>
              </div>
            )}
          </div>

          {cookiePreview && (
            <div className="bg-black/30 rounded-xl px-4 py-3 mb-3">
              <p className="text-xs text-white/40 mb-1">Preview (first 3 lines)</p>
              <p className="text-xs font-mono text-white/50 leading-relaxed">
                {cookiePreview.split('\n').slice(0, 3).join('\n')}
              </p>
            </div>
          )}

          <button
            onClick={saveCookies}
            disabled={savingCookies || !cookiePreview.trim()}
            className="w-full text-sm bg-[#FF6B00] text-white py-2.5 rounded-xl disabled:opacity-50 hover:bg-[#e55f00] transition-colors"
          >
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
