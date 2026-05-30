'use client'
// src/app/settings/page.tsx — account, password change, 2FA, cookies

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

type Profile = { tier: string; is_admin: boolean; yt_cookie_saved_at?: string; totp_enabled?: boolean; email?: string }

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tokenRef = useRef<string>('')

  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [cookieStatus, setCookieStatus] = useState<{ has_cookies: boolean; saved_at: string | null } | null>(null)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  // Password change
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  // 2FA
  const [totpQR, setTotpQR] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [enablingTotp, setEnablingTotp] = useState(false)
  const [setupTotp, setSetupTotp] = useState(false)

  // Cookies
  const [selectedFileName, setSelectedFileName] = useState('')
  const [cookiePreview, setCookiePreview] = useState('')
  const [savingCookies, setSavingCookies] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      tokenRef.current = session.access_token
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setUser(user)

      const [userRes, cookieRes] = await Promise.all([
        fetch('/api/user', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch('/api/user/cookies', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ])
      if (userRes.ok) { const d = await userRes.json(); setProfile(d.profile) }
      if (cookieRes.ok) { setCookieStatus(await cookieRes.json()) }
    })
  }, [])

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) { showToast('Passwords do not match', 'error'); return }
    if (newPassword.length < 8) { showToast('Password must be at least 8 characters', 'error'); return }
    setChangingPassword(true)

    // Verify current password first
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user?.email ?? '', password: currentPassword
    })
    if (signInError) { showToast('Current password is incorrect', 'error'); setChangingPassword(false); return }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) showToast(error.message, 'error')
    else {
      showToast('Password updated!')
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    }
    setChangingPassword(false)
  }

  async function startTotpSetup() {
    setSetupTotp(true)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ClipFinder' })
    if (error) { showToast(error.message, 'error'); setSetupTotp(false); return }
    setTotpQR(data.totp.qr_code)
    setTotpSecret(data.totp.secret)
  }

  async function verifyAndEnableTotp(e: React.FormEvent) {
    e.preventDefault()
    setEnablingTotp(true)

    // Get the factor ID
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const totpFactor = factors?.totp?.[0]
    if (!totpFactor) { showToast('Setup error — try again', 'error'); setEnablingTotp(false); return }

    const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id })
    if (!challenge) { showToast('Challenge failed', 'error'); setEnablingTotp(false); return }

    const { error } = await supabase.auth.mfa.verify({
      factorId: totpFactor.id,
      challengeId: challenge.id,
      code: totpCode,
    })

    if (error) showToast('Invalid code — try again', 'error')
    else {
      showToast('2FA enabled! ✓')
      setSetupTotp(false); setTotpQR(''); setTotpSecret(''); setTotpCode('')
      setProfile(p => p ? { ...p, totp_enabled: true } : p)
    }
    setEnablingTotp(false)
  }

  async function disableTotp() {
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const totpFactor = factors?.totp?.[0]
    if (!totpFactor) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId: totpFactor.id })
    if (error) showToast(error.message, 'error')
    else { showToast('2FA disabled'); setProfile(p => p ? { ...p, totp_enabled: false } : p) }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => setCookiePreview(ev.target?.result as string)
    reader.readAsText(file)
  }

  async function saveCookies() {
    if (!cookiePreview.trim()) return
    setSavingCookies(true)
    const res = await fetch('/api/user/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ cookies: cookiePreview }),
    })
    setSavingCookies(false)
    if (res.ok) {
      showToast('✓ YouTube cookies saved!')
      setCookieStatus({ has_cookies: true, saved_at: new Date().toISOString() })
      setCookiePreview(''); setSelectedFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } else {
      const d = await res.json().catch(() => ({}))
      showToast(d.error ?? 'Failed to save cookies', 'error')
    }
  }

  async function clearCookies() {
    await fetch('/api/user/cookies', { method: 'DELETE', headers: { 'Authorization': `Bearer ${tokenRef.current}` } })
    showToast('Cookies cleared')
    setCookieStatus({ has_cookies: false, saved_at: null })
  }

  function daysSince(d: string) { return Math.floor((Date.now() - new Date(d).getTime()) / 86400000) }

  return (
    <main className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      <Nav />

      {toast && (
        <div className={`fixed top-4 right-4 z-50 text-white text-sm px-4 py-2 rounded-xl shadow-lg ${toastType === 'error' ? 'bg-red-500' : 'bg-[#FF6B00]'}`}>{toast}</div>
      )}

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <h1 className="text-xl font-semibold mb-8">Settings</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Account */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <h2 className="text-sm font-medium mb-4 text-white/60">Account</h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Email</span>
              <span className="text-white/80 truncate ml-4">{user?.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Plan</span>
              <span className="capitalize text-white/80">{profile?.tier ?? 'free'}</span>
            </div>
          </div>
          {profile?.tier === 'free' && (
            <Link href="/pricing" className="mt-4 block text-center text-xs bg-[#FF6B00] text-white py-2.5 rounded-xl hover:bg-[#e55f00]">
              Upgrade to Pro — $12/mo
            </Link>
          )}
        </div>

        {/* Change password */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <h2 className="text-sm font-medium mb-4 text-white/60">Change password</h2>
          <form onSubmit={changePassword} className="space-y-3">
            <input type="password" placeholder="Current password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
            <input type="password" placeholder="New password (min 8 chars)" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
            <input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
            <button type="submit" disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="w-full text-sm bg-white/10 text-white py-2.5 rounded-xl hover:bg-white/15 disabled:opacity-50">
              {changingPassword ? 'Updating...' : 'Update password'}
            </button>
          </form>
        </div>

        {/* 2FA */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-medium text-white/60">Two-factor authentication</h2>
              <p className="text-xs text-white/30 mt-0.5">Add extra security with an authenticator app</p>
            </div>
            {profile?.totp_enabled && <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">Enabled</span>}
          </div>

          {!setupTotp && !profile?.totp_enabled && (
            <button onClick={startTotpSetup} className="w-full text-sm bg-white/10 text-white py-2.5 rounded-xl hover:bg-white/15">
              🔐 Set up authenticator app
            </button>
          )}

          {!setupTotp && profile?.totp_enabled && (
            <button onClick={disableTotp} className="w-full text-sm bg-red-500/10 text-red-400 py-2.5 rounded-xl hover:bg-red-500/20">
              Disable 2FA
            </button>
          )}

          {setupTotp && (
            <div className="space-y-4">
              <div className="bg-black/30 rounded-xl p-4 text-center">
                <p className="text-xs text-white/40 mb-3">Scan with Google Authenticator or Authy</p>
                {totpQR && <img src={totpQR} alt="2FA QR Code" className="mx-auto w-36 h-36 rounded-lg" />}
                {totpSecret && (
                  <div className="mt-3">
                    <p className="text-xs text-white/30 mb-1">Or enter manually:</p>
                    <p className="text-xs font-mono text-white/60 bg-white/5 rounded px-3 py-1.5 inline-block tracking-wider">{totpSecret}</p>
                  </div>
                )}
              </div>
              <form onSubmit={verifyAndEnableTotp} className="space-y-3">
                <input type="text" placeholder="6-digit code from app" value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6} pattern="\d{6}" required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00] text-center tracking-widest text-lg" />
                <div className="flex gap-2">
                  <button type="submit" disabled={enablingTotp || totpCode.length !== 6}
                    className="flex-1 text-sm bg-[#FF6B00] text-white py-2.5 rounded-xl disabled:opacity-50">
                    {enablingTotp ? 'Verifying...' : 'Enable 2FA'}
                  </button>
                  <button type="button" onClick={() => { setSetupTotp(false); setTotpQR(''); setTotpSecret(''); setTotpCode('') }}
                    className="flex-1 text-sm bg-white/10 text-white/50 py-2.5 rounded-xl">Cancel</button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* YouTube cookies */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <h2 className="text-sm font-medium mb-1 text-white/60">YouTube cookies</h2>
          <p className="text-xs text-white/30 mb-4 leading-relaxed">
            Bypass age restrictions. Export using{' '}
            <a href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
              target="_blank" rel="noopener" className="text-[#FF6B00] underline">Get cookies.txt</a>.
            File is read locally — never stored on our servers.
          </p>

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

          <div onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-white/10 hover:border-white/20 rounded-xl p-5 text-center cursor-pointer transition-colors mb-3">
            <input ref={fileInputRef} type="file" accept=".txt" onChange={handleFileSelect} className="hidden" />
            {selectedFileName ? (
              <div><p className="text-sm text-green-400 font-medium">✓ {selectedFileName}</p><p className="text-xs text-white/30 mt-1">Click to change</p></div>
            ) : (
              <div><p className="text-2xl mb-2">📄</p><p className="text-sm text-white/60">Click to upload cookies.txt</p><p className="text-xs text-white/30 mt-1">.txt files only</p></div>
            )}
          </div>

          {cookiePreview && (
            <div className="bg-black/30 rounded-xl px-4 py-3 mb-3">
              <p className="text-xs text-white/40 mb-1">Preview</p>
              <p className="text-xs font-mono text-white/50 leading-relaxed">{cookiePreview.split('\n').slice(0, 3).join('\n')}</p>
            </div>
          )}

          <button onClick={saveCookies} disabled={savingCookies || !cookiePreview.trim()}
            className="w-full text-sm bg-[#FF6B00] text-white py-2.5 rounded-xl disabled:opacity-50 hover:bg-[#e55f00]">
            {savingCookies ? 'Saving...' : 'Save cookies'}
          </button>
        </div>

        {/* Danger zone — spans full width */}
        <div className="lg:col-span-2 bg-red-500/5 border border-red-500/20 rounded-2xl p-5">
          <h2 className="text-sm font-medium mb-3 text-red-400/80">Danger zone</h2>
          <button onClick={async () => { await supabase.auth.signOut(); router.replace('/') }}
            className="text-xs text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500/10">
            Sign out of all devices
          </button>
        </div>

        </div>
      </div>
    </main>
  )
}
