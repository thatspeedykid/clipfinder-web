'use client'
// src/app/admin/page.tsx
// Admin dashboard — jobs monitor, user manager, key manager
// Access: /admin (redirects to login if not admin)

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Stats = {
  totalUsers: number
  totalJobs: number
  jobsToday: number
  activeJobs: number
  tiers: { free: number; pro: number; agency: number }
}

type Job = {
  id: string
  status: string
  mode: string
  source_url: string
  video_title?: string
  progress: number
  progress_msg?: string
  error_msg?: string
  clips_found?: number
  created_at: string
  profiles?: { email: string; tier: string }
}

type User = {
  id: string
  email: string
  tier: string
  is_admin: boolean
  clips_today: number
  created_at: string
}

type ConfigRow = {
  key: string
  value: string
  label: string
  group_name: string
  is_secret: boolean
  hasValue: boolean
  updated_at: string
}

const STATUS_COLOR: Record<string, string> = {
  queued:       'bg-gray-500/20 text-gray-400',
  downloading:  'bg-blue-500/20 text-blue-400',
  transcribing: 'bg-purple-500/20 text-purple-400',
  analyzing:    'bg-yellow-500/20 text-yellow-400',
  cutting:      'bg-orange-500/20 text-orange-400',
  done:         'bg-green-500/20 text-green-400',
  error:        'bg-red-500/20 text-red-400',
}

export default function AdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const tokenRef = useRef<string>('')

  const [tab, setTab] = useState<'jobs' | 'users' | 'keys'>('jobs')
  const [stats, setStats] = useState<Stats | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [config, setConfig] = useState<ConfigRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')

  const authFetch = useCallback(async (url: string, opts: RequestInit = {}) => {
    return fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenRef.current}`,
        ...(opts.headers ?? {}),
      },
    })
  }, [])

  const loadStats = useCallback(async () => {
    const r = await authFetch('/api/admin/stats')
    if (r.ok) setStats(await r.json())
  }, [authFetch])

  const loadJobs = useCallback(async () => {
    const url = statusFilter === 'all' ? '/api/admin/jobs?limit=50' : `/api/admin/jobs?status=${statusFilter}&limit=50`
    const r = await authFetch(url)
    if (r.ok) { const d = await r.json(); setJobs(d.jobs ?? []) }
  }, [authFetch, statusFilter])

  const loadUsers = useCallback(async () => {
    const r = await authFetch('/api/admin/users')
    if (r.ok) { const d = await r.json(); setUsers(d.users ?? []) }
  }, [authFetch])

  const loadConfig = useCallback(async () => {
    const r = await authFetch('/api/admin/config')
    if (r.ok) { const d = await r.json(); setConfig(d.config ?? []) }
  }, [authFetch])

  // Auth + initial load
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      tokenRef.current = session.access_token

      // Verify admin
      const r = await fetch('/api/admin/stats', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (r.status === 403) { router.replace('/dashboard'); return }
      if (r.ok) setStats(await r.json())
      setLoading(false)
    })
  }, [])

  // Load data on tab change
  useEffect(() => {
    if (loading) return
    if (tab === 'jobs') loadJobs()
    if (tab === 'users') loadUsers()
    if (tab === 'keys') loadConfig()
  }, [tab, loading, statusFilter])

  // Auto-refresh jobs every 5s
  useEffect(() => {
    if (tab !== 'jobs') return
    const interval = setInterval(() => { loadJobs(); loadStats() }, 5000)
    return () => clearInterval(interval)
  }, [tab, loadJobs, loadStats])

  async function updateUserTier(userId: string, tier: string) {
    await authFetch('/api/admin/users', {
      method: 'PATCH',
      body: JSON.stringify({ userId, tier }),
    })
    loadUsers()
  }

  async function toggleAdmin(userId: string, is_admin: boolean) {
    await authFetch('/api/admin/users', {
      method: 'PATCH',
      body: JSON.stringify({ userId, is_admin }),
    })
    loadUsers()
  }

  async function saveKey(key: string) {
    setSaving(true)
    await authFetch('/api/admin/config', {
      method: 'PATCH',
      body: JSON.stringify({ key, value: editValue }),
    })
    setSaving(false)
    setEditingKey(null)
    setEditValue('')
    loadConfig()
  }

  async function clearKey(key: string) {
    await authFetch('/api/admin/config', {
      method: 'DELETE',
      body: JSON.stringify({ key }),
    })
    loadConfig()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-white/40 text-sm">Loading admin...</p>
      </div>
    )
  }

  const groupedConfig = config.reduce((acc, row) => {
    const g = row.group_name || 'other'
    if (!acc[g]) acc[g] = []
    acc[g].push(row)
    return acc
  }, {} as Record<string, ConfigRow[]>)

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[#FF6B00] font-bold">CLIPFINDER</span>
          <span className="text-white/20">›</span>
          <span className="text-sm text-white/60">Admin</span>
        </div>
        <a href="/dashboard" className="text-xs text-white/40 hover:text-white">← Back to app</a>
      </div>

      {/* Stats */}
      {stats && (
        <div className="px-6 py-5 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total users', value: stats.totalUsers },
            { label: 'Jobs today', value: stats.jobsToday },
            { label: 'Active now', value: stats.activeJobs, highlight: stats.activeJobs > 0 },
            { label: 'Pro users', value: stats.tiers.pro },
            { label: 'Agency users', value: stats.tiers.agency },
          ].map(s => (
            <div key={s.label} className="bg-white/5 rounded-xl p-4">
              <p className="text-xs text-white/40 mb-1">{s.label}</p>
              <p className={`text-2xl font-semibold ${s.highlight ? 'text-[#FF6B00]' : ''}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 flex gap-1 border-b border-white/10">
        {(['jobs', 'users', 'keys'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm capitalize transition-colors border-b-2 ${
              tab === t
                ? 'border-[#FF6B00] text-white'
                : 'border-transparent text-white/40 hover:text-white'
            }`}
          >
            {t === 'jobs' && `Jobs ${stats?.activeJobs ? `(${stats.activeJobs} active)` : ''}`}
            {t === 'users' && 'Users'}
            {t === 'keys' && 'API Keys'}
          </button>
        ))}
      </div>

      <div className="px-6 py-5">

        {/* ── JOBS TAB ── */}
        {tab === 'jobs' && (
          <div>
            <div className="flex gap-2 mb-4 flex-wrap">
              {['all', 'queued', 'downloading', 'transcribing', 'analyzing', 'cutting', 'done', 'error'].map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                    statusFilter === s
                      ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30'
                      : 'bg-white/5 text-white/50 border border-white/10'
                  }`}
                >
                  {s}
                </button>
              ))}
              <button onClick={loadJobs} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-white/50 border border-white/10 ml-auto">
                ↻ Refresh
              </button>
            </div>

            <div className="space-y-2">
              {jobs.length === 0 && <p className="text-white/30 text-sm text-center py-8">No jobs found</p>}
              {jobs.map(job => (
                <div key={job.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[job.status] ?? 'bg-white/10 text-white/50'}`}>
                          {job.status}
                        </span>
                        <span className="text-xs text-white/40">{job.mode}</span>
                        <span className="text-xs text-white/30">{job.profiles?.email}</span>
                        <span className="text-xs text-white/20">{new Date(job.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-sm font-medium truncate">{job.video_title || job.source_url}</p>
                      {job.progress_msg && <p className="text-xs text-white/40 mt-0.5">{job.progress_msg}</p>}
                      {job.error_msg && <p className="text-xs text-red-400 mt-0.5">{job.error_msg}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium">{job.progress}%</p>
                      {job.clips_found && <p className="text-xs text-green-400">{job.clips_found} clips</p>}
                    </div>
                  </div>
                  {job.status !== 'done' && job.status !== 'error' && job.status !== 'queued' && (
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#FF6B00] rounded-full transition-all duration-500"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── USERS TAB ── */}
        {tab === 'users' && (
          <div className="space-y-2">
            {users.length === 0 && <p className="text-white/30 text-sm text-center py-8">No users yet</p>}
            {users.map(user => (
              <div key={user.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{user.email}</p>
                    {user.is_admin && <span className="text-xs bg-[#FF6B00]/20 text-[#FF6B00] px-2 py-0.5 rounded-full">admin</span>}
                  </div>
                  <p className="text-xs text-white/40">{user.clips_today} clips today · joined {new Date(user.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={user.tier}
                    onChange={e => updateUserTier(user.id, e.target.value)}
                    className="text-xs bg-white/10 border border-white/10 rounded-lg px-2 py-1.5 text-white"
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="agency">Agency</option>
                  </select>
                  <button
                    onClick={() => toggleAdmin(user.id, !user.is_admin)}
                    className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                      user.is_admin
                        ? 'bg-[#FF6B00]/10 border-[#FF6B00]/30 text-[#FF6B00]'
                        : 'bg-white/5 border-white/10 text-white/40'
                    }`}
                  >
                    {user.is_admin ? 'Remove admin' : 'Make admin'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── KEYS TAB ── */}
        {tab === 'keys' && (
          <div className="space-y-6">
            <p className="text-xs text-white/40">Keys saved here are used by the worker. Changes take effect on the next job.</p>
            {Object.entries(groupedConfig).map(([group, rows]) => (
              <div key={group}>
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">{group}</h3>
                <div className="space-y-2">
                  {rows.map(row => (
                    <div key={row.key} className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{row.label}</p>
                          <p className="text-xs text-white/30 font-mono">{row.key}</p>
                          {editingKey === row.key ? (
                            <div className="flex gap-2 mt-2">
                              <input
                                type={row.is_secret ? 'password' : 'text'}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                placeholder={`Enter ${row.label}...`}
                                autoFocus
                                className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF6B00]"
                              />
                              <button
                                onClick={() => saveKey(row.key)}
                                disabled={saving || !editValue}
                                className="text-xs bg-[#FF6B00] text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                              >
                                {saving ? '...' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditingKey(null); setEditValue('') }}
                                className="text-xs bg-white/10 text-white/50 px-3 py-1.5 rounded-lg"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <p className="text-xs font-mono text-white/50 mt-1">
                              {row.hasValue ? row.value : <span className="text-red-400/70">Not set</span>}
                            </p>
                          )}
                        </div>
                        {editingKey !== row.key && (
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              onClick={() => { setEditingKey(row.key); setEditValue('') }}
                              className="text-xs bg-white/10 text-white/60 px-3 py-1.5 rounded-lg hover:bg-white/20"
                            >
                              {row.hasValue ? 'Update' : 'Set'}
                            </button>
                            {row.hasValue && (
                              <button
                                onClick={() => clearKey(row.key)}
                                className="text-xs bg-red-500/10 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/20"
                              >
                                Clear
                              </button>
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
      </div>
    </main>
  )
}
