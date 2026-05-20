// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server'

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.ico).*)'],
}

const PUBLIC_PATHS = ['/login', '/api/auth', '/_next', '/favicon', '/api/admin']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  // Always allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  // ── Admin bypass token — add ?adminkey=YOUR_WORKER_SECRET to any URL ──────
  // Or set ADMIN_BYPASS_COOKIE via the admin token system
  const adminBypassKey = process.env.WORKER_SECRET ?? ''
  const urlAdminKey = req.nextUrl.searchParams.get('adminkey')
  const cookieAdminKey = req.cookies.get('cf_admin_bypass')?.value ?? ''

  if (adminBypassKey && (urlAdminKey === adminBypassKey || cookieAdminKey === adminBypassKey)) {
    // Set a cookie so subsequent requests don't need the query param
    const res = NextResponse.next()
    if (urlAdminKey === adminBypassKey) {
      res.cookies.set('cf_admin_bypass', adminBypassKey, { httpOnly: true, maxAge: 60 * 60 * 24, path: '/' })
    }
    return res
  }

  // ── Fetch flags from Supabase ─────────────────────────────────────────────
  let flags: Record<string, boolean> = {}
  try {
    const flagsRes = await fetch(`${supabaseUrl}/rest/v1/feature_flags?select=key,enabled`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
      next: { revalidate: 30 }, // cache 30s
    })
    if (flagsRes.ok) {
      const data = await flagsRes.json()
      if (Array.isArray(data)) {
        data.forEach((f: { key: string; enabled: boolean }) => { flags[f.key] = f.enabled })
      }
    }
  } catch { flags = {} }

  // If no site mode flags are on, just pass through
  const anySiteModeActive = flags.site_sandbox_mode || flags.site_brb_mode || flags.site_maintenance_mode
  if (!anySiteModeActive && !flags.feature_ip_block && !flags.feature_vpn_block) {
    return NextResponse.next()
  }

  // ── IP blocking ───────────────────────────────────────────────────────────
  if (flags.feature_ip_block) {
    try {
      const ipRes = await fetch(`${supabaseUrl}/rest/v1/blocked_ips?ip=eq.${ip}&select=ip`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
      })
      const ipData = await ipRes.json()
      if (Array.isArray(ipData) && ipData.length > 0) {
        return new NextResponse(blockedPage('Access Denied', 'Your IP has been blocked.'), {
          status: 403, headers: { 'Content-Type': 'text/html' },
        })
      }
    } catch { /* fail open */ }
  }

  // ── VPN blocking ──────────────────────────────────────────────────────────
  if (flags.feature_vpn_block && ip !== 'unknown' && process.env.VPN_DETECT_API_KEY) {
    try {
      const vpnRes = await fetch(`https://ipapi.is/json/?ip=${ip}&key=${process.env.VPN_DETECT_API_KEY}`)
      const vpnData = await vpnRes.json()
      if (vpnData.is_proxy || vpnData.is_vpn || vpnData.is_tor) {
        return new NextResponse(blockedPage('VPN Detected', 'Please disable your VPN to use ClipFinder.'), {
          status: 403, headers: { 'Content-Type': 'text/html' },
        })
      }
    } catch { /* fail open */ }
  }

  // ── Try to get user admin status from Supabase ────────────────────────────
  let isAdmin = false
  try {
    // Get the auth token from cookies
    const authCookies = req.cookies.getAll()
    const accessTokenCookie = authCookies.find(c =>
      c.name.includes('access_token') || c.name.includes('auth-token') || c.name.startsWith('sb-')
    )

    if (accessTokenCookie) {
      // Try to verify the token and get admin status
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${accessTokenCookie.value}`,
        },
      })
      if (userRes.ok) {
        const userData = await userRes.json()
        if (userData.id) {
          const profileRes = await fetch(
            `${supabaseUrl}/rest/v1/profiles?id=eq.${userData.id}&select=is_admin`,
            { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
          )
          if (profileRes.ok) {
            const profiles = await profileRes.json()
            isAdmin = profiles?.[0]?.is_admin === true
          }
        }
      }
    }
  } catch { isAdmin = false }

  // Admins bypass all site modes
  if (isAdmin) return NextResponse.next()

  // ── Site modes (non-admins only) ──────────────────────────────────────────
  if (!pathname.startsWith('/api')) {
    if (flags.site_brb_mode) {
      return new NextResponse(modePage('☕ Be Right Back', process.env.BRB_MSG ?? 'Be right back! Taking a short break.', '#FF6B00'), {
        status: 503, headers: { 'Content-Type': 'text/html', 'Retry-After': '300' },
      })
    }
    if (flags.site_maintenance_mode) {
      return new NextResponse(modePage('🔧 Under Maintenance', process.env.MAINTENANCE_MSG ?? 'We are performing maintenance. Back soon!', '#6366f1'), {
        status: 503, headers: { 'Content-Type': 'text/html', 'Retry-After': '600' },
      })
    }
    if (flags.site_sandbox_mode) {
      return new NextResponse(modePage('🧪 Sandbox Mode', 'ClipFinder is currently in testing mode. Check back soon!', '#10b981'), {
        status: 503, headers: { 'Content-Type': 'text/html' },
      })
    }
  }

  return NextResponse.next()
}

function modePage(title: string, message: string, color: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — ClipFinder</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f0f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{text-align:center;max-width:420px;padding:2rem}.logo{font-size:24px;font-weight:700;margin-bottom:2rem}.logo span{color:${color}}h1{font-size:22px;font-weight:500;margin-bottom:12px}p{color:rgba(255,255,255,0.5);font-size:15px;line-height:1.6}.dot{width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;margin-bottom:1.5rem;animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}</style></head><body><div class="box"><div class="logo"><span>CLIP</span>FINDER</div><div class="dot"></div><h1>${title}</h1><p>${message}</p></div></body></html>`
}

function blockedPage(title: string, message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title} — ClipFinder</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f0f;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{text-align:center;max-width:420px;padding:2rem}.logo{font-size:24px;font-weight:700;margin-bottom:2rem}.logo span{color:#ef4444}h1{font-size:22px;font-weight:500;margin-bottom:12px}p{color:rgba(255,255,255,0.5);font-size:15px}</style></head><body><div class="box"><div class="logo"><span>CLIP</span>FINDER</div><h1>${title}</h1><p>${message}</p></div></body></html>`
}
