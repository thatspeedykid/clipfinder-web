'use client'
// src/app/admin/page.tsx — Full admin dashboard

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Stats = { totalUsers: number; totalJobs: number; jobsToday: number; activeJobs: number; tiers: { free: number; pro: number; agency: number } }
type Job = { id: string; status: string; mode: string; source_url: string; video_title?: string; progress: number; progress_msg?: string; error_msg?: string; clips_found?: number; created_at: string; profiles?: { email: string; tier: string } }
type User = { id: string; email: string; tier: string; is_admin: boolean; is_banned: boolean; ban_reason?: string; clips_today: number; created_at: string }
type ConfigRow = { key: string; value: string; label: string; group_name: string; is_secret: boolean; hasValue: boolean }
type Flag = { key: string; enabled: boolean; label: string; description: string; group_name: string }
type BlockedIp = { ip: string; reason: string; created_at: string }
type AdminClip = {
  id: string; title: string; file_url?: string; file_size_mb?: number
  file_expires_at?: string; storage_path?: string; created_at: string
  profiles?: { email: string; tier: string }
  jobs?: { video_title: string; source_url: string }
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-gray-500/20 text-gray-400', downloading: 'bg-blue-500/20 text-blue-400',
  transcribing: 'bg-purple-500/20 text-purple-400', analyzing: 'bg-yellow-500/20 text-yellow-400',
  cutting: 'bg-orange-500/20 text-orange-400', done: 'bg-green-500/20 text-green-400',
  error: 'bg-red-500/20 text-red-400', cancelled: 'bg-white/10 text-white/30',
}

const TABS = ['jobs', 'users', 'keys', 'flags', 'security', 'clips'] as const
type Tab = typeof TABS[number]

export default function AdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const tokenRef = useRef<string>('')

  const [tab, setTab] = useState<Tab>('jobs')
  const [stats, setStats] = useState<Stats | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [config, setConfig] = useState<ConfigRow[]>([])
  const [flags, setFlags] = useState<Flag[]>([])
  const [blockedIps, setBlockedIps] = useState<BlockedIp[]>([])
  const [adminClips, setAdminClips] = useState<AdminClip[]>([])
  const [clipsLoading, setClipsLoading] = useState(false)
  const [keysHealth, setKeysHealth] = useState<Record<string, unknown> | null>(null)
  const [keysHealthLoading, setKeysHealthLoading] = useState(false)
  const [testingKey, setTestingKey] = useState<string | null>(null)
  const [keyTestResults, setKeyTestResults] = useState<Record<string, {ok: boolean, error?: string}>>({})
  const [addingKey, setAddingKey] = useState<string | null>(null)
  const [newKeyValue, setNewKeyValue] = useState('')
  const [adminErrorLog, setAdminErrorLog] = useState<string[]>([])
  const [storage, setStorage] = useState<{totalGb:number,limitGb:number,pct:number,clipCount:number,safe:boolean,warning:boolean,critical:boolean} | null>(null)
  const [previewAdminClip, setPreviewAdminClip] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('active')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [passwordModal, setPasswordModal] = useState<{ userId: string; email: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [banModal, setBanModal] = useState<{ user: User } | null>(null)
  const [banReason, setBanReason] = useState('')
  const [newIp, setNewIp] = useState('')
  const [newIpReason, setNewIpReason] = useState('')
  const [toastMsg, setToastMsg] = useState('')

  const toast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 3000) }

  const authFetch = useCallback(async (url: string, opts: RequestInit = {}) =>
    fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenRef.current}`, ...(opts.headers ?? {}) } })
  , [])

  const loadStats = useCallback(async () => {
    const r = await authFetch('/api/admin/stats')
    if (r.ok) setStats(await r.json())
  }, [authFetch])

  const loadJobs = useCallback(async () => {
    const active = ['queued', 'downloading', 'transcribing', 'analyzing', 'cutting']
    const url = statusFilter === 'active'
      ? `/api/admin/jobs?limit=50`
      : `/api/admin/jobs?status=${statusFilter}&limit=50`
    const r = await authFetch(url)
    if (r.ok) {
      const d = await r.json()
      let j = d.jobs ?? []
      if (statusFilter === 'active') j = j.filter((x: Job) => active.includes(x.status))
      setJobs(j)
    }
  }, [authFetch, statusFilter])

  const loadUsers = useCallback(async () => {
    const r = await authFetch('/api/admin/users')
    if (r.ok) { const d = await r.json(); setUsers(d.users ?? []) }
  }, [authFetch])

  const loadConfig = useCallback(async () => {
    const r = await authFetch('/api/admin/config')
    if (r.ok) { const d = await r.json(); setConfig(d.config ?? []) }
  }, [authFetch])

  const loadFlags = useCallback(async () => {
    const r = await authFetch('/api/admin/flags')
    if (r.ok) { const d = await r.json(); setFlags(d.flags ?? []) }
  }, [authFetch])

  const loadBlockedIps = useCallback(async () => {
    const r = await authFetch('/api/admin/ban')
    if (r.ok) { const d = await r.json(); setBlockedIps(d.blocked_ips ?? []) }
  }, [authFetch])

  const loadClips = useCallback(async () => {
    setClipsLoading(true)
    const r = await authFetch('/api/admin/clips')
    if (r.ok) { const d = await r.json(); setAdminClips(d.clips ?? []) }
    setClipsLoading(false)
  }, [authFetch])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      tokenRef.current = session.access_token
      const r = await fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (r.status === 403) { router.replace('/dashboard'); return }
      if (r.ok) setStats(await r.json())
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (loading) return
    loadStats()
    if (tab === 'jobs') loadJobs()
    else if (tab === 'users') loadUsers()
    else if (tab === 'keys') loadConfig()
    else if (tab === 'flags') loadFlags()
    else if (tab === 'security') { loadBlockedIps(); loadUsers() }
    else if (tab === 'clips') loadClips()
  }, [tab, loading, statusFilter])

  useEffect(() => {
    if (tab !== 'jobs') return
    const i = setInterval(() => { loadJobs(); loadStats() }, 5000)
    return () => clearInterval(i)
  }, [tab, loadJobs, loadStats])

  async function toggleFlag(key: string, enabled: boolean) {
    await authFetch('/api/admin/flags', { method: 'PATCH', body: JSON.stringify({ key, enabled }) })
    setFlags(prev => prev.map(f => f.key === key ? { ...f, enabled } : f))
    toast(`${key} ${enabled ? 'enabled' : 'disabled'}`)
  }

  async function saveKey(key: string) {
    setSaving(true)
    await authFetch('/api/admin/config', { method: 'PATCH', body: JSON.stringify({ key, value: editValue }) })
    setSaving(false); setEditingKey(null); setEditValue(''); loadConfig(); toast('Key saved')
  }

  async function clearKey(key: string) {
    await authFetch('/api/admin/config', { method: 'DELETE', body: JSON.stringify({ key }) })
    loadConfig(); toast('Key cleared')
  }

  async function updateTier(userId: string, tier: string) {
    await authFetch('/api/admin/users', { method: 'PATCH', body: JSON.stringify({ userId, tier }) })
    loadUsers(); toast('Tier updated')
  }

  async function toggleAdmin(userId: string, is_admin: boolean) {
    await authFetch('/api/admin/users', { method: 'PATCH', body: JSON.stringify({ userId, is_admin }) })
    loadUsers(); toast(is_admin ? 'Admin granted' : 'Admin removed')
  }

  async function cancelJob(jobId: string) {
    await authFetch(`/api/jobs/${jobId}`, { method: 'PATCH' })
    toast('Job cancelled'); loadJobs(); loadStats()
  }

  async function deleteClip(clipId: string, storagePath?: string) {
    await authFetch('/api/admin/clips', {
      method: 'DELETE',
      body: JSON.stringify({ clipId, storagePath })
    })
    toast('Clip deleted'); loadClips()
  }

  function logError(msg: string) {
    const ts = new Date().toLocaleTimeString()
    setAdminErrorLog(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 50))
  }

  async function purgeExpiredClips() {
    const r = await authFetch('/api/admin/clips', { method: 'DELETE', body: JSON.stringify({ deleteAll: true, expiredOnly: true }) })
    const d = await r.json()
    if (!r.ok || d.error) { logError(`Purge expired failed: ${d.error ?? r.status}`); toast('Purge failed — check error log') }
    else { toast(`Purged ${d.deleted} expired clips from R2 + DB`) }
    loadClips()
  }

  async function setUserPassword(userId: string) {
    if (!newPassword || newPassword.length < 8) { toast('Password must be at least 8 chars'); return }
    setSettingPassword(true)
    await authFetch('/api/admin/users', { method: 'PUT', body: JSON.stringify({ userId, newPassword }) })
    setSettingPassword(false); setPasswordModal(null); setNewPassword('')
    toast('Password updated')
  }

  async function remove2FA(userId: string) {
    await authFetch('/api/admin/users', { method: 'PUT', body: JSON.stringify({ userId, remove2fa: true }) })
    toast('2FA removed'); loadUsers()
  }

  async function banUser(userId: string, reason: string) {
    await authFetch('/api/admin/ban', { method: 'POST', body: JSON.stringify({ action: 'ban_user', userId, reason }) })
    setBanModal(null); setBanReason(''); loadUsers(); toast('User banned')
  }

  async function unbanUser(userId: string) {
    await authFetch('/api/admin/ban', { method: 'POST', body: JSON.stringify({ action: 'unban_user', userId }) })
    loadUsers(); toast('User unbanned')
  }

  async function deleteUser(userId: string) {
    if (!confirm('Delete this user permanently? This cannot be undone.')) return
    await authFetch('/api/admin/ban', { method: 'POST', body: JSON.stringify({ action: 'delete_user', userId }) })
    loadUsers(); toast('User deleted')
  }

  async function blockIp() {
    if (!newIp.trim()) return
    await authFetch('/api/admin/ban', { method: 'POST', body: JSON.stringify({ action: 'block_ip', ip: newIp.trim(), reason: newIpReason || 'Blocked by admin' }) })
    setNewIp(''); setNewIpReason(''); loadBlockedIps(); toast('IP blocked')
  }

  async function unblockIp(ip: string) {
    await authFetch('/api/admin/ban', { method: 'POST', body: JSON.stringify({ action: 'unblock_ip', ip }) })
    loadBlockedIps(); toast('IP unblocked')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="text-white/40 text-sm">Loading admin...</p></div>

  const flagGroups = flags.reduce((acc, f) => { if (!acc[f.group_name]) acc[f.group_name] = []; acc[f.group_name].push(f); return acc }, {} as Record<string, Flag[]>)
  const configGroups = config.reduce((acc, r) => { if (!acc[r.group_name]) acc[r.group_name] = []; acc[r.group_name].push(r); return acc }, {} as Record<string, ConfigRow[]>)

  const siteModeFlags = flags.filter(f => f.group_name === 'site_modes')
  const activeSiteMode = siteModeFlags.find(f => f.enabled)

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#FF6B00] text-white text-sm px-4 py-2 rounded-xl shadow-lg">
          {toastMsg}
        </div>
      )}

      {/* Password modal */}
      {passwordModal && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <h3 className="font-medium mb-1">Set password for {passwordModal.email}</h3>
            <p className="text-white/40 text-xs mb-4">This will override their current password immediately.</p>
            <input type="password" placeholder="New password (min 8 chars)" value={newPassword}
              onChange={e => setNewPassword(e.target.value)} minLength={8}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00] mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setUserPassword(passwordModal.userId)} disabled={settingPassword || newPassword.length < 8}
                className="flex-1 bg-[#FF6B00] text-white text-sm font-medium py-2 rounded-xl disabled:opacity-50">
                {settingPassword ? 'Setting...' : 'Set password'}
              </button>
              <button onClick={() => { setPasswordModal(null); setNewPassword('') }}
                className="flex-1 bg-white/10 text-white/60 text-sm py-2 rounded-xl">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Ban modal */}
      {banModal && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <h3 className="font-medium mb-1">Ban {banModal.user.email}</h3>
            <p className="text-white/40 text-xs mb-4">This user will see the ban message and cannot use the app.</p>
            <input
              type="text"
              placeholder="Ban reason (shown to user)..."
              value={banReason}
              onChange={e => setBanReason(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-red-500 mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => banUser(banModal.user.id, banReason)} className="flex-1 bg-red-500 text-white text-sm font-medium py-2 rounded-xl">Ban user</button>
              <button onClick={() => { setBanModal(null); setBanReason('') }} className="flex-1 bg-white/10 text-white/60 text-sm py-2 rounded-xl">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[#FF6B00] font-bold">CLIPFINDER</span>
          <span className="text-white/20">›</span>
          <span className="text-sm text-white/60">Admin</span>
          {activeSiteMode && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
              {activeSiteMode.label} active
            </span>
          )}
        </div>
        <a href="/dashboard" className="text-xs text-white/40 hover:text-white">← Back to app</a>
      </div>

      {/* Stats */}
      {stats && (
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-6 gap-3">
          {[
            { label: 'Total users', value: stats.totalUsers },
            { label: 'Jobs today', value: stats.jobsToday },
            { label: 'Active now', value: stats.activeJobs, hot: stats.activeJobs > 0 },
            { label: 'Pro', value: stats.tiers.pro },
            { label: 'Agency', value: stats.tiers.agency },
          ].map(s => (
            <div key={s.label} className="bg-white/5 rounded-xl p-4">
              <p className="text-xs text-white/40 mb-1">{s.label}</p>
              <p className={`text-2xl font-semibold ${s.hot ? 'text-[#FF6B00]' : ''}`}>{s.value}</p>
            </div>
          ))}
          {/* R2 Storage meter */}
          {storage ? (
            <div className={`rounded-xl p-4 col-span-2 sm:col-span-1 ${storage.critical ? 'bg-red-500/10 border border-red-500/30' : storage.warning ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-white/5'}`}>
              <p className="text-xs text-white/40 mb-1">R2 Storage</p>
              <p className={`text-lg font-semibold leading-none mb-1 ${storage.critical ? 'text-red-400' : storage.warning ? 'text-yellow-400' : ''}`}>
                {storage.totalGb.toFixed(2)}<span className="text-xs text-white/30"> / {storage.limitGb}GB</span>
              </p>
              <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-1">
                <div className={`h-full rounded-full ${storage.critical ? 'bg-red-500' : storage.warning ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${storage.pct}%` }} />
              </div>
              <p className="text-xs text-white/30">{storage.pct}% · {storage.clipCount} clips</p>
              {storage.critical && <p className="text-xs text-red-400 font-medium mt-0.5">⚠️ Auto-purging old clips</p>}
              {storage.warning && <p className="text-xs text-yellow-400 mt-0.5">⚠️ Running low</p>}
            </div>
          ) : (
            <div className="bg-white/5 rounded-xl p-4">
              <p className="text-xs text-white/40 mb-1">R2 Storage</p>
              <p className="text-xs text-white/20">Loading...</p>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 flex gap-1 border-b border-white/10 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm capitalize whitespace-nowrap transition-colors border-b-2 ${tab === t ? 'border-[#FF6B00] text-white' : 'border-transparent text-white/40 hover:text-white'}`}>
            {t === 'jobs' ? `Jobs${stats?.activeJobs ? ` (${stats.activeJobs})` : ''}` : t}
          </button>
        ))}
      </div>

      <div className="px-6 py-5 max-w-5xl">

        {/* JOBS */}
        {tab === 'jobs' && (
          <div>
            <div className="flex gap-2 mb-4 flex-wrap">
              {['active', 'all', 'done', 'error'].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${statusFilter === s ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30' : 'bg-white/5 text-white/50 border border-white/10'}`}>
                  {s}
                </button>
              ))}
              <button onClick={loadJobs} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 border border-white/10 ml-auto">↻ Refresh</button>
            </div>
            <div className="space-y-2">
              {jobs.length === 0 && <p className="text-white/30 text-sm text-center py-8">No jobs</p>}
              {jobs.map(job => (
                <div key={job.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[job.status] ?? 'bg-white/10 text-white/50'}`}>{job.status}</span>
                        <span className="text-xs text-white/30">{job.mode}</span>
                        <span className="text-xs text-white/20">{job.profiles?.email}</span>
                        <span className="text-xs text-white/20">{new Date(job.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-sm font-medium truncate">{job.video_title || job.source_url}</p>
                      {job.progress_msg && <p className="text-xs text-white/40 mt-0.5">{job.progress_msg}</p>}
                      {job.error_msg && <p className="text-xs text-red-400 mt-0.5">{job.error_msg}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium">{job.progress}%</p>
                      {job.clips_found ? <p className="text-xs text-green-400">{job.clips_found} clips</p> : null}
                    </div>
                  </div>
                  {!['done', 'error', 'queued', 'cancelled'].includes(job.status) && (
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-[#FF6B00] rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
                    </div>
                  )}
                  {!['done', 'error', 'cancelled'].includes(job.status) && (
                    <div className="mt-2">
                      <button
                        onClick={() => cancelJob(job.id)}
                        className="text-xs text-red-400/70 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 px-2.5 py-1 rounded-lg transition-colors">
                        ✕ Cancel job
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* USERS */}
        {tab === 'users' && (
          <div className="space-y-2">
            {users.length === 0 && <p className="text-white/30 text-sm text-center py-8">No users yet</p>}
            {users.map(user => (
              <div key={user.id} className={`bg-white/5 border rounded-xl p-4 ${user.is_banned ? 'border-red-500/30' : 'border-white/10'}`}>
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-medium truncate">{user.email}</p>
                      {user.is_admin && <span className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-0.5 rounded-full">admin</span>}
                      {user.is_banned && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">banned</span>}
                    </div>
                    <p className="text-xs text-white/30">{user.clips_today} clips today · joined {new Date(user.created_at).toLocaleDateString()}</p>
                    {user.ban_reason && <p className="text-xs text-red-400/70 mt-0.5">Reason: {user.ban_reason}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={user.tier} onChange={e => updateTier(user.id, e.target.value)}
                      className="text-xs bg-white/10 border border-white/10 rounded-lg px-2 py-1.5 text-white">
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="agency">Agency</option>
                    </select>
                    <button onClick={() => toggleAdmin(user.id, !user.is_admin)}
                      className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${user.is_admin ? 'bg-[#FF6B00]/10 border-[#FF6B00]/30 text-[#FF6B00]' : 'bg-white/5 border-white/10 text-white/40'}`}>
                      {user.is_admin ? 'Remove admin' : 'Make admin'}
                    </button>
                    {user.is_banned
                      ? <button onClick={() => unbanUser(user.id)} className="text-xs px-2 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400">Unban</button>
                      : <button onClick={() => setBanModal({ user })} className="text-xs px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">Ban</button>
                    }
                    <button onClick={() => setPasswordModal({ userId: user.id, email: user.email })}
                      className="text-xs px-2 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
                      🔑 Password
                    </button>
                    <button onClick={() => remove2FA(user.id)}
                      className="text-xs px-2 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
                      Remove 2FA
                    </button>
                    <button onClick={() => deleteUser(user.id)} className="text-xs px-2 py-1.5 rounded-lg bg-red-900/20 border border-red-900/30 text-red-500">Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* KEYS */}
        {tab === 'keys' && (
          <div className="space-y-6">

            {/* AI Keys Section */}
            <div className="bg-white/3 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-medium text-sm">AI API Keys</h3>
                  <p className="text-xs text-white/30 mt-0.5">Gemini → Groq → OpenRouter. Add _2, _3 etc for rotation.</p>
                </div>
                <button onClick={async () => {
                  setKeysHealthLoading(true); setKeyTestResults({})
                  const r = await authFetch('/api/admin/keys-health')
                  if (r.ok) {
                    const d = await r.json()
                    setKeysHealth(d)
                    const results: Record<string, {ok: boolean, error?: string}> = {}
                    for (const res of (d.results ?? [])) results[res.name] = { ok: res.ok, error: res.error }
                    setKeyTestResults(results)
                  }
                  setKeysHealthLoading(false)
                }} className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30 px-3 py-1.5 rounded-lg hover:bg-[#FF6B00]/30">
                  {keysHealthLoading ? '⏳ Testing all...' : '🔍 Test all keys'}
                </button>
              </div>

              {keysHealth && (
                <div className={`rounded-xl px-4 py-3 mb-4 text-xs ${(keysHealth.working as number) === 0 ? 'bg-red-500/10 text-red-400' : (keysHealth.working as number) < (keysHealth.total as number) ? 'bg-yellow-500/10 text-yellow-400' : 'bg-green-500/10 text-green-400'}`}>
                  {keysHealth.working as number}/{keysHealth.total as number} keys working
                  {(keysHealth.working as number) === 0 && ' — AI will fail on all requests'}
                  <span className={`ml-4 ${String(keysHealth.modal_worker_url).startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                    Modal: {keysHealth.modal_worker_url as string}
                  </span>
                </div>
              )}

              {/* Gemini */}
              {[['Gemini', 'GEMINI_API_KEY', 'gemini'], ['Groq', 'GROQ_API_KEY', 'groq'], ['OpenRouter', 'OPENROUTER_API_KEY', 'openrouter']].map(([label, envBase, healthPrefix]) => {
                const aiRows = config.filter(r => r.key.startsWith(envBase))
                const existingNums = aiRows.map(r => parseInt(r.key.replace(envBase, '').replace('_','') || '1')).sort()
                const nextNum = existingNums.length === 0 ? 1 : Math.max(...existingNums) + 1
                const nextKey = nextNum === 1 ? envBase : `${envBase}_${nextNum}`
                return (
                  <div key={envBase} className="mb-5 last:mb-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-white/50 uppercase tracking-wide">{label}</span>
                      <button onClick={() => { setAddingKey(nextKey); setNewKeyValue('') }}
                        className="text-xs text-[#FF6B00]/70 hover:text-[#FF6B00] border border-[#FF6B00]/20 px-2 py-1 rounded-lg hover:bg-[#FF6B00]/10">
                        + Add key {nextNum > 1 ? `#${nextNum}` : ''}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {aiRows.length === 0 && (
                        <div className="bg-white/3 border border-white/5 rounded-lg px-3 py-2 text-xs text-red-400/60">No {label} keys set</div>
                      )}
                      {aiRows.map((row, idx) => {
                        const keyNum = row.key === envBase ? 1 : parseInt(row.key.split('_').pop() ?? '1')
                        const healthKey = `${healthPrefix === 'gemini' ? 'Gemini' : healthPrefix === 'groq' ? 'Groq' : 'OpenRouter'} #${keyNum}`
                        const testResult = keyTestResults[healthKey]
                        return (
                          <div key={row.key} className="bg-white/5 border border-white/10 rounded-xl p-3">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-white/40">{row.key}</span>
                                  {testResult && (
                                    <span className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                                      {testResult.ok ? '✓ Working' : `✗ ${testResult.error}`}
                                    </span>
                                  )}
                                  {testingKey === row.key && <span className="text-xs text-white/30">Testing...</span>}
                                </div>
                                {editingKey === row.key ? (
                                  <div className="flex gap-2 mt-2">
                                    <input type="password" value={editValue} onChange={e => setEditValue(e.target.value)}
                                      placeholder="Paste new key..." autoFocus
                                      className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                                    <button onClick={() => saveKey(row.key)} disabled={saving || !editValue}
                                      className="text-xs bg-[#FF6B00] text-white px-3 py-1.5 rounded-lg disabled:opacity-50">{saving ? '...' : 'Save'}</button>
                                    <button onClick={() => { setEditingKey(null); setEditValue('') }}
                                      className="text-xs bg-white/10 text-white/50 px-2 py-1.5 rounded-lg">✕</button>
                                  </div>
                                ) : (
                                  <p className="text-xs font-mono text-white/30 mt-0.5 truncate">{row.value}</p>
                                )}
                              </div>
                              {editingKey !== row.key && (
                                <div className="flex gap-1.5 flex-shrink-0">
                                  <button onClick={async () => {
                                    setTestingKey(row.key)
                                    const r = await authFetch('/api/admin/keys-health')
                                    if (r.ok) {
                                      const d = await r.json()
                                      const match = (d.results ?? []).find((res: {name: string; ok: boolean; error?: string}) => res.name === healthKey)
                                      if (match) setKeyTestResults(prev => ({ ...prev, [healthKey]: { ok: match.ok, error: match.error } }))
                                    }
                                    setTestingKey(null)
                                  }} className="text-xs bg-white/5 border border-white/10 px-2 py-1.5 rounded-lg hover:bg-white/10 text-white/40">
                                    🔍
                                  </button>
                                  <button onClick={() => { setEditingKey(row.key); setEditValue('') }}
                                    className="text-xs bg-white/10 text-white/60 px-2 py-1.5 rounded-lg hover:bg-white/20">Edit</button>
                                  <button onClick={() => clearKey(row.key)}
                                    className="text-xs bg-red-500/10 text-red-400/70 px-2 py-1.5 rounded-lg hover:bg-red-500/20">✕</button>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {/* Add new key inline */}
                      {addingKey === nextKey && (
                        <div className="bg-[#FF6B00]/5 border border-[#FF6B00]/20 rounded-xl p-3">
                          <p className="text-xs text-white/40 mb-2 font-mono">{nextKey}</p>
                          <div className="flex gap-2">
                            <input type="password" value={newKeyValue} onChange={e => setNewKeyValue(e.target.value)}
                              placeholder={`Paste ${label} API key...`} autoFocus
                              className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                            <button onClick={async () => {
                              if (!newKeyValue) return
                              await saveKey(nextKey)
                              setAddingKey(null); setNewKeyValue('')
                            }} disabled={saving || !newKeyValue}
                              className="text-xs bg-[#FF6B00] text-white px-3 py-1.5 rounded-lg disabled:opacity-50">{saving ? '...' : 'Save'}</button>
                            <button onClick={() => { setAddingKey(null); setNewKeyValue('') }}
                              className="text-xs bg-white/10 text-white/50 px-2 py-1.5 rounded-lg">✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Other config keys (non-AI) */}
            {Object.entries(configGroups).filter(([g]) => !['AI', 'ai'].includes(g)).map(([group, rows]) => (
              <div key={group}>
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">{group}</h3>
                <div className="space-y-2">
                  {rows.filter(r => !r.key.includes('GEMINI') && !r.key.includes('GROQ') && !r.key.includes('OPENROUTER')).map(row => (
                    <div key={row.key} className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{row.label}</p>
                          <p className="text-xs text-white/30 font-mono">{row.key}</p>
                          {editingKey === row.key ? (
                            <div className="flex gap-2 mt-2">
                              <input type={row.is_secret ? 'password' : 'text'} value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                placeholder={`Enter ${row.label}...`} autoFocus
                                className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                              <button onClick={() => saveKey(row.key)} disabled={saving || !editValue}
                                className="text-xs bg-[#FF6B00] text-white px-3 py-1.5 rounded-lg disabled:opacity-50">{saving ? '...' : 'Save'}</button>
                              <button onClick={() => { setEditingKey(null); setEditValue('') }}
                                className="text-xs bg-white/10 text-white/50 px-3 py-1.5 rounded-lg">Cancel</button>
                            </div>
                          ) : (
                            <p className="text-xs font-mono text-white/50 mt-1 truncate">
                              {row.hasValue ? row.value : <span className="text-red-400/70">Not set</span>}
                            </p>
                          )}
                        </div>
                        {editingKey !== row.key && (
                          <div className="flex gap-2 flex-shrink-0">
                            <button onClick={() => { setEditingKey(row.key); setEditValue('') }}
                              className="text-xs bg-white/10 text-white/60 px-3 py-1.5 rounded-lg hover:bg-white/20">
                              {row.hasValue ? 'Update' : 'Set'}
                            </button>
                            {row.hasValue && (
                              <button onClick={() => clearKey(row.key)}
                                className="text-xs bg-red-500/10 text-red-400 px-3 py-1.5 rounded-lg">Clear</button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* FLAGS */}
        {tab === 'flags' && (
          <div className="space-y-6">
            <p className="text-xs text-white/40">Toggle any feature on or off. Changes take effect within 30 seconds.</p>
            {Object.entries(flagGroups).map(([group, groupFlags]) => (
              <div key={group}>
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">{group.replace('_', ' ')}</h3>
                <div className="space-y-2">
                  {groupFlags.map(flag => (
                    <div key={flag.key} className={`bg-white/5 border rounded-xl p-4 ${flag.enabled ? 'border-white/10' : 'border-white/5 opacity-70'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium">{flag.label}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${flag.enabled ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/30'}`}>
                              {flag.enabled ? 'on' : 'off'}
                            </span>
                          </div>
                          <p className="text-xs text-white/40 mt-1 leading-relaxed">{flag.description}</p>
                          <p className="text-xs text-white/20 font-mono mt-1">{flag.key}</p>
                        </div>
                        <button
                          onClick={() => toggleFlag(flag.key, !flag.enabled)}
                          className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 mt-0.5 focus:outline-none ${flag.enabled ? 'bg-[#FF6B00]' : 'bg-white/20'}`}
                          aria-label={`Toggle ${flag.label}`}>
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${flag.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SECURITY */}
        {tab === 'security' && (
          <div className="space-y-6">
            {/* IP Blocking */}
            <div>
              <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Block IP address</h3>
              <div className="flex gap-3 mb-3">
                <input type="text" placeholder="IP address (e.g. 1.2.3.4)" value={newIp} onChange={e => setNewIp(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                <input type="text" placeholder="Reason (optional)" value={newIpReason} onChange={e => setNewIpReason(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]" />
                <button onClick={blockIp} className="bg-red-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl whitespace-nowrap">Block IP</button>
              </div>
              <div className="space-y-2">
                {blockedIps.length === 0 && <p className="text-white/30 text-sm text-center py-4">No blocked IPs</p>}
                {blockedIps.map(b => (
                  <div key={b.ip} className="bg-white/5 border border-red-500/20 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-mono">{b.ip}</p>
                      <p className="text-xs text-white/40">{b.reason} · {new Date(b.created_at).toLocaleDateString()}</p>
                    </div>
                    <button onClick={() => unblockIp(b.ip)} className="text-xs bg-white/10 text-white/60 px-3 py-1.5 rounded-lg hover:bg-white/20">Unblock</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Banned users */}
            <div>
              <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Banned users</h3>
              <div className="space-y-2">
                {users.filter(u => u.is_banned).length === 0 && <p className="text-white/30 text-sm text-center py-4">No banned users</p>}
                {users.filter(u => u.is_banned).map(user => (
                  <div key={user.id} className="bg-white/5 border border-red-500/20 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm">{user.email}</p>
                      <p className="text-xs text-red-400/70">{user.ban_reason}</p>
                    </div>
                    <button onClick={() => unbanUser(user.id)} className="text-xs bg-green-500/10 text-green-400 px-3 py-1.5 rounded-lg">Unban</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* CLIPS */}
        {tab === 'clips' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-white/40">All stored clips. Free=12h, Pro/Agency=15 days.</p>
              <div className="flex gap-2">
                <button onClick={loadClips} className="text-xs bg-white/5 text-white/50 border border-white/10 px-3 py-1.5 rounded-lg hover:bg-white/10">
                  ↻ Refresh
                </button>
                <button onClick={purgeExpiredClips}
                  className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500/20">
                  🗑 Purge expired
                </button>
                <button onClick={async () => {
                  if (!confirm('Delete ALL stored clips permanently? This cannot be undone.')) return
                  const r = await authFetch('/api/admin/clips', { method: 'DELETE', body: JSON.stringify({ deleteAll: true }) })
                  const d = await r.json()
                  if (!r.ok || d.error) { logError(`Purge ALL failed: ${d.error ?? r.status}`); toast('Purge failed — check error log') }
                  else { toast(`Deleted ${d.deleted} clips from R2 + DB`) }
                  loadClips()
                }} className="text-xs bg-red-900/20 text-red-500 border border-red-900/30 px-3 py-1.5 rounded-lg hover:bg-red-900/30">
                  💥 Purge ALL
                </button>
                <button onClick={async () => {
                  if (!confirm('NUKE ALL clip records from DB? Cannot be undone.')) return
                  const r = await authFetch('/api/admin/clips/nuke', { method: 'DELETE' })
                  const d = await r.json()
                  if (!r.ok || d.error) { logError(`Nuke failed: ${d.error ?? r.status}`); toast('Nuke failed') }
                  else { toast(`Nuked ${d.deleted} clip records`) }
                  loadClips()
                }} className="text-xs bg-red-950/40 text-red-600 border border-red-950/50 px-3 py-1.5 rounded-lg hover:bg-red-950/60">
                  ☢️ Nuke DB
                </button>
              </div>
            </div>

            {clipsLoading && <p className="text-white/30 text-sm text-center py-8">Loading...</p>}
            {!clipsLoading && adminClips.length === 0 && <p className="text-white/30 text-sm text-center py-8">No clips stored</p>}

            <div className="space-y-2">
              {adminClips.map(clip => {
                const expired = clip.file_expires_at ? new Date(clip.file_expires_at) < new Date() : false
                const expiresIn = clip.file_expires_at
                  ? Math.ceil((new Date(clip.file_expires_at).getTime() - Date.now()) / (1000 * 60 * 60))
                  : null
                const isPreview = previewAdminClip === clip.id

                return (
                  <div key={clip.id} className={`bg-white/5 border rounded-xl overflow-hidden ${expired ? 'border-red-500/20' : 'border-white/10'}`}>
                    <div className="p-4 flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-sm font-medium truncate">{clip.title}</p>
                          {expired
                            ? <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">expired</span>
                            : expiresIn !== null && <span className="text-xs bg-white/10 text-white/50 px-2 py-0.5 rounded-full">
                                {expiresIn < 24 ? `${expiresIn}h left` : `${Math.ceil(expiresIn/24)}d left`}
                              </span>
                          }
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            clip.profiles?.tier === 'agency' ? 'bg-purple-500/20 text-purple-400' :
                            clip.profiles?.tier === 'pro' ? 'bg-[#FF6B00]/20 text-[#FF6B00]' :
                            'bg-white/10 text-white/40'
                          }`}>{clip.profiles?.tier ?? 'free'}</span>
                        </div>
                        <p className="text-xs text-white/40 truncate">{clip.profiles?.email} · {clip.jobs?.video_title || clip.jobs?.source_url}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-white/30">
                          {clip.file_size_mb && <span>{clip.file_size_mb.toFixed(1)} MB</span>}
                          <span>{new Date(clip.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        {clip.file_url && !expired && (
                          <>
                            <button onClick={() => setPreviewAdminClip(isPreview ? null : clip.id)}
                              className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors ${isPreview ? 'bg-white/20 text-white' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}>
                              {isPreview ? '▼' : '▶'}
                            </button>
                            <a href={clip.file_url} target="_blank" rel="noopener"
                              className="text-xs bg-white/10 text-white/50 px-2.5 py-1.5 rounded-lg hover:bg-white/20">⬇️</a>
                          </>
                        )}
                        <button onClick={() => deleteClip(clip.id, clip.storage_path)}
                          className="text-xs bg-red-500/10 text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-500/20">
                          Delete
                        </button>
                      </div>
                    </div>
                    {isPreview && clip.file_url && (
                      <div className="border-t border-white/10 bg-black p-3">
                        <video src={clip.file_url} controls className="w-full rounded-lg" style={{ maxHeight: '260px' }} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
