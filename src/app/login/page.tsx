'use client'
// src/app/login/page.tsx — email+password, magic link, Google OAuth, forgot password

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type AuthFlags = {
  google_oauth: boolean
  magic_link: boolean
  email_password: boolean
  forgot_password: boolean
  email_verification: boolean
}

type View = 'login' | 'signup' | 'magic_sent' | 'forgot' | 'forgot_sent'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [view, setView] = useState<View>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [flags, setFlags] = useState<AuthFlags>({ google_oauth: false, magic_link: true, email_password: true, forgot_password: true, email_verification: false })
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard')
    })
    fetch('/api/flags/auth').then(r => r.json()).then(d => {
      setFlags({
        google_oauth:        d.google_oauth        ?? false,
        magic_link:          d.magic_link          ?? true,
        email_password:      d.email_password      ?? true,
        forgot_password:     d.forgot_password     ?? true,
        email_verification:  d.email_verification  ?? false,
      })
    }).catch(() => {})
  }, [])

  async function handleEmailPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')

    if (view === 'signup') {
      if (password !== confirmPassword) { setError('Passwords do not match'); setLoading(false); return }
      if (password.length < 8) { setError('Password must be at least 8 characters'); setLoading(false); return }
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` }
      })
      if (error) { setError(error.message); setLoading(false); return }

      if (!flags.email_verification) {
        // Verification disabled — sign in immediately
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) setError(signInError.message)
        else router.replace('/dashboard')
      } else {
        // Verification enabled — tell them to check email
        setError('Account created! Check your email to verify before signing in.')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        if (error.message.includes('Invalid login')) setError('Incorrect email or password.')
        else if (error.message.includes('Email not confirmed')) setError('Please verify your email first. Check your inbox.')
        else setError(error.message)
      } else {
        router.replace('/dashboard')
      }
    }
    setLoading(false)
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` }
    })
    if (error) setError(error.message)
    else setView('magic_sent')
    setLoading(false)
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (error) setError(error.message)
    else setView('forgot_sent')
    setLoading(false)
  }

  async function signInWithGoogle() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` }
    })
    if (error) setError(error.message)
    setLoading(false)
  }

  const isSignup = view === 'signup'

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-[#0f0f0f]">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-0.5 mb-5">
            <span className="text-[#FF6B00] font-bold text-2xl">CLIP</span>
            <span className="font-bold text-2xl text-white">FINDER</span>
          </Link>
          <h1 className="text-xl font-semibold text-white">
            {view === 'forgot' || view === 'forgot_sent' ? 'Reset password'
              : isSignup ? 'Create account'
              : 'Sign in'}
          </h1>
          {!isSignup && view === 'login' && <p className="text-white/40 text-sm mt-1">3 free clips/day · No credit card</p>}
        </div>

        {/* Magic link sent */}
        {view === 'magic_sent' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
            <p className="text-3xl mb-3">📬</p>
            <p className="text-green-400 font-medium mb-1">Check your email!</p>
            <p className="text-white/40 text-sm">Magic link sent to <span className="text-white/70">{email}</span></p>
            <button onClick={() => { setView('login'); setError('') }} className="mt-4 text-xs text-white/30 hover:text-white underline">Back to sign in</button>
          </div>
        )}

        {/* Forgot sent */}
        {view === 'forgot_sent' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
            <p className="text-3xl mb-3">📩</p>
            <p className="text-green-400 font-medium mb-1">Reset link sent!</p>
            <p className="text-white/40 text-sm">Check your email at <span className="text-white/70">{email}</span></p>
            <button onClick={() => { setView('login'); setError('') }} className="mt-4 text-xs text-white/30 hover:text-white underline">Back to sign in</button>
          </div>
        )}

        {/* Forgot password form */}
        {view === 'forgot' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <form onSubmit={handleForgotPassword} className="space-y-3">
              <input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
              <button type="submit" disabled={loading || !email}
                className="w-full bg-[#FF6B00] text-white font-medium py-2.5 rounded-xl hover:bg-[#e55f00] disabled:opacity-50">
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
            {error && <p className="text-red-400 text-xs text-center mt-3">{error}</p>}
            <button onClick={() => { setView('login'); setError('') }} className="mt-3 w-full text-xs text-white/30 hover:text-white text-center">← Back to sign in</button>
          </div>
        )}

        {/* Main login/signup form */}
        {(view === 'login' || view === 'signup') && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">

            {/* Google OAuth */}
            {flags.google_oauth && (
              <>
                <button onClick={signInWithGoogle} disabled={loading}
                  className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 font-medium py-2.5 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>
                <div className="flex items-center gap-3"><div className="flex-1 h-px bg-white/10"/><span className="text-xs text-white/20">or</span><div className="flex-1 h-px bg-white/10"/></div>
              </>
            )}

            {/* Email + Password */}
            {flags.email_password && (
              <form onSubmit={handleEmailPassword} className="space-y-3">
                <input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white text-xs">
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {isSignup && (
                  <input type="password" placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                )}
                <button type="submit" disabled={loading || !email || !password}
                  className="w-full bg-[#FF6B00] text-white font-medium py-2.5 rounded-xl hover:bg-[#e55f00] disabled:opacity-50">
                  {loading ? (isSignup ? 'Creating account...' : 'Signing in...') : (isSignup ? 'Create account' : 'Sign in')}
                </button>
              </form>
            )}

            {/* Magic link */}
            {flags.magic_link && flags.email_password && (
              <div className="flex items-center gap-3"><div className="flex-1 h-px bg-white/10"/><span className="text-xs text-white/20">or</span><div className="flex-1 h-px bg-white/10"/></div>
            )}
            {flags.magic_link && (
              <form onSubmit={handleMagicLink} className="space-y-3">
                {!flags.email_password && (
                  <input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                )}
                <button type="submit" disabled={loading || !email}
                  className="w-full bg-white/10 border border-white/10 text-white/70 py-2.5 rounded-xl hover:bg-white/15 disabled:opacity-50 text-sm">
                  {loading ? 'Sending...' : '✉️ Send magic link instead'}
                </button>
              </form>
            )}

            {/* Forgot password + toggle signup */}
            <div className="flex items-center justify-between pt-1">
              {flags.forgot_password && view === 'login' && (
                <button onClick={() => { setView('forgot'); setError('') }} className="text-xs text-white/30 hover:text-white">Forgot password?</button>
              )}
              <button onClick={() => { setView(isSignup ? 'login' : 'signup'); setError(''); setPassword(''); setConfirmPassword('') }}
                className="text-xs text-white/40 hover:text-white ml-auto">
                {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </button>
            </div>

            {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          </div>
        )}

        <p className="text-center text-white/20 text-xs mt-6">
          ClipFinder is <a href="https://github.com/thatspeedykid/clipfinder-web" className="underline hover:text-white/50">open source</a>
        </p>
      </div>
    </main>
  )
}
