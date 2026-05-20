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

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-gray-500/20 text-gray-400', downloading: 'bg-blue-500/20 text-blue-400',
  transcribing: 'bg-purple-500/20 text-purple-400', analyzing: 'bg-yellow-500/20 text-yellow-400',
  cutting: 'bg-orange-500/20 text-orange-400', done: 'bg-green-500/20 text-green-400', error: 'bg-red-500/20 text-red-400',
}

const TABS = ['jobs', 'users', 'keys', 'flags', 'security'] as const
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
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('active')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
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
        <div className="fixed top-4 right-4 z-50 bg-[#FF6B00] text-white text-sm px-4 py-2 rounded-xl shadow-lg">
          {toastMsg}
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
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
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
                  {!['done', 'error', 'queued'].includes(job.status) && (
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-[#FF6B00] rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
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
            <p className="text-xs text-white/40">Changes take effect on the next job. Secrets are masked.</p>
            {Object.entries(configGroups).map(([group, rows]) => (
              <div key={group}>
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">{group}</h3>
                <div className="space-y-2">
                  {rows.map(row => (
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
                    <div key={flag.key} className={`bg-white/5 border rounded-xl p-4 flex items-center justify-between gap-4 ${flag.enabled ? 'border-white/10' : 'border-white/5 opacity-60'}`}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{flag.label}</p>
                          {flag.enabled && <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">on</span>}
                        </div>
                        <p className="text-xs text-white/40 mt-0.5">{flag.description}</p>
                        <p className="text-xs text-white/20 font-mono">{flag.key}</p>
                      </div>
                      <button
                        onClick={() => toggleFlag(flag.key, !flag.enabled)}
                        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${flag.enabled ? 'bg-[#FF6B00]' : 'bg-white/10'}`}>
                        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${flag.enabled ? 'translate-x-7' : 'translate-x-1'}`} />
                      </button>
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
      </div>
    </main>
  )
}
