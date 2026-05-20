'use client'
// src/app/reset-password/page.tsx

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    // Supabase handles the token from the URL hash automatically
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User is now in password recovery mode — show the form
      }
    })
  }, [])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError('')

    const { error } = await supabase.auth.updateUser({ password })
    if (error) setError(error.message)
    else {
      setDone(true)
      setTimeout(() => router.replace('/dashboard'), 2000)
    }
    setLoading(false)
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-[#0f0f0f]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-0.5 mb-5">
            <span className="text-[#FF6B00] font-bold text-2xl">CLIP</span>
            <span className="font-bold text-2xl text-white">FINDER</span>
          </Link>
          <h1 className="text-xl font-semibold text-white">Set new password</h1>
        </div>

        {done ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
            <p className="text-3xl mb-3">✅</p>
            <p className="text-green-400 font-medium">Password updated!</p>
            <p className="text-white/40 text-sm mt-1">Redirecting to dashboard...</p>
          </div>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <form onSubmit={handleReset} className="space-y-3">
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} placeholder="New password (min 8 chars)" value={password}
                  onChange={e => setPassword(e.target.value)} required minLength={8}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white text-xs">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input type="password" placeholder="Confirm new password" value={confirm}
                onChange={e => setConfirm(e.target.value)} required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />

              {/* Password strength indicator */}
              {password.length > 0 && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1,2,3,4].map(i => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
                        password.length >= i * 3
                          ? i <= 1 ? 'bg-red-500' : i <= 2 ? 'bg-yellow-500' : i <= 3 ? 'bg-blue-500' : 'bg-green-500'
                          : 'bg-white/10'
                      }`} />
                    ))}
                  </div>
                  <p className="text-xs text-white/30">
                    {password.length < 8 ? 'Too short' : password.length < 12 ? 'Okay' : password.length < 16 ? 'Good' : 'Strong'}
                  </p>
                </div>
              )}

              <button type="submit" disabled={loading || !password || !confirm}
                className="w-full bg-[#FF6B00] text-white font-medium py-2.5 rounded-xl hover:bg-[#e55f00] disabled:opacity-50">
                {loading ? 'Updating...' : 'Set new password'}
              </button>
            </form>
            {error && <p className="text-red-400 text-xs text-center mt-3">{error}</p>}
          </div>
        )}
      </div>
    </main>
  )
}
