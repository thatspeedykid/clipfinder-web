'use client'
// src/app/login/page.tsx

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [flags, setFlags] = useState<{ google: boolean; magic: boolean }>({ google: false, magic: true })
  const supabase = createClient()
  const router = useRouter()

  // Check if already logged in
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard')
    })
  }, [])

  // Load auth flags
  useEffect(() => {
    fetch('/api/flags/auth').then(r => r.json()).then(data => {
      setFlags({ google: data.google_oauth ?? false, magic: data.magic_link ?? true })
    }).catch(() => setFlags({ google: false, magic: true }))
  }, [])

  async function signInWithGoogle() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })
    if (error) setError(error.message)
    setLoading(false)
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-[#0f0f0f]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-1 mb-6">
            <span className="text-[#FF6B00] font-bold text-xl">CLIP</span>
            <span className="font-bold text-xl text-white">FINDER</span>
          </Link>
          <h1 className="text-2xl font-semibold text-white">Sign in</h1>
          <p className="text-white/50 text-sm mt-1">3 free clips/day · No credit card</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">

          {/* Google OAuth — only shown when flag is enabled */}
          {flags.google && (
            <>
              <button
                onClick={signInWithGoogle}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 font-medium py-2.5 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              {flags.magic && (
                <div className="flex items-center gap-3 text-white/20">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs">or</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
              )}
            </>
          )}

          {/* Magic link — only shown when flag is enabled */}
          {flags.magic && (
            <>
              {sent ? (
                <div className="text-center py-4">
                  <div className="text-3xl mb-3">📬</div>
                  <p className="text-green-400 font-medium text-sm">Check your email!</p>
                  <p className="text-white/40 text-xs mt-1">We sent a magic link to</p>
                  <p className="text-white/70 text-sm font-medium mt-1">{email}</p>
                  <button
                    onClick={() => { setSent(false); setEmail('') }}
                    className="mt-4 text-xs text-white/30 hover:text-white underline"
                  >
                    Use a different email
                  </button>
                </div>
              ) : (
                <form onSubmit={signInWithEmail} className="space-y-3">
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00] transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={loading || !email}
                    className="w-full bg-[#FF6B00] text-white font-medium py-2.5 rounded-xl hover:bg-[#e55f00] transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Sending...' : 'Send magic link'}
                  </button>
                </form>
              )}
            </>
          )}

          {/* Fallback if both disabled */}
          {!flags.google && !flags.magic && (
            <div className="text-center py-4">
              <p className="text-white/50 text-sm">Login is currently disabled.</p>
              <p className="text-white/30 text-xs mt-1">Check back soon.</p>
            </div>
          )}

          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          By signing in you agree to our terms. ClipFinder is{' '}
          <a href="https://github.com/thatspeedykid/clipfinder-web" className="underline hover:text-white/50">open source</a>.
        </p>
      </div>
    </main>
  )
}
