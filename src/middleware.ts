// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.ico).*)'],
}

const PUBLIC_PATHS = ['/login', '/api/auth', '/_next', '/favicon']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown'

  // Always allow login and auth
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  // ── Step 1: Check if current user is admin FIRST ──────────────────────────
  // Admins bypass everything — check this before any blocking logic
  const response = NextResponse.next()
  let isAdmin = false
  let isBanned = false
  let banReason = ''

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    })
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin, is_banned, ban_reason')
        .eq('id', user.id)
        .single()
      isAdmin = profile?.is_admin ?? false
      isBanned = profile?.is_banned ?? false
      banReason = profile?.ban_reason ?? ''
    }
  } catch { /* auth check failed — continue as non-admin */ }

  // Admins can always access everything with no restrictions
  if (isAdmin) return response

  // ── Step 2: Fetch flags + IP block list in parallel ───────────────────────
  const [flagsRes, blockedIpRes] = await Promise.allSettled([
    fetch(`${supabaseUrl}/rest/v1/feature_flags?select=key,enabled`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
    }).then(r => r.json()),
    fetch(`${supabaseUrl}/rest/v1/blocked_ips?ip=eq.${ip}&select=ip`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
    }).then(r => r.json()),
  ])

  const flags: Record<string, boolean> = {}
  if (flagsRes.status === 'fulfilled' && Array.isArray(flagsRes.value)) {
    flagsRes.value.forEach((f: { key: string; enabled: boolean }) => { flags[f.key] = f.enabled })
  }

  const isIpBlocked = blockedIpRes.status === 'fulfilled' &&
    Array.isArray(blockedIpRes.value) && blockedIpRes.value.length > 0

  // ── Step 3: Apply blocks (non-admins only) ────────────────────────────────

  // Banned user
  if (isBanned) {
    return new NextResponse(blockedPage('Account Banned', banReason || 'Your account has been banned.'), {
      status: 403, headers: { 'Content-Type': 'text/html' },
    })
  }

  // IP blocked
  if (flags.feature_ip_block && isIpBlocked) {
    return new NextResponse(blockedPage('Access Denied', 'Your IP has been blocked.'), {
      status: 403, headers: { 'Content-Type': 'text/html' },
    })
  }

  // VPN blocking
  if (flags.feature_vpn_block && ip !== 'unknown') {
    const vpnApiKey = process.env.VPN_DETECT_API_KEY
    if (vpnApiKey) {
      try {
        const vpnRes = await fetch(`https://ipapi.is/json/?ip=${ip}&key=${vpnApiKey}`)
        const vpnData = await vpnRes.json()
        if (vpnData.is_proxy || vpnData.is_vpn || vpnData.is_tor) {
          return new NextResponse(blockedPage('VPN Detected', 'Please disable your VPN to use ClipFinder.'), {
            status: 403, headers: { 'Content-Type': 'text/html' },
          })
        }
      } catch { /* fail open */ }
    }
  }

  // BRB mode
  if (flags.site_brb_mode && !pathname.startsWith('/api')) {
    const msg = process.env.BRB_MSG ?? 'Be right back! Taking a short break.'
    return new NextResponse(modePage('☕ Be Right Back', msg, '#FF6B00'), {
      status: 503, headers: { 'Content-Type': 'text/html', 'Retry-After': '300' },
    })
  }

  // Maintenance mode
  if (flags.site_maintenance_mode && !pathname.startsWith('/api')) {
    const msg = process.env.MAINTENANCE_MSG ?? 'We are performing maintenance. Back soon!'
    return new NextResponse(modePage('🔧 Under Maintenance', msg, '#6366f1'), {
      status: 503, headers: { 'Content-Type': 'text/html', 'Retry-After': '600' },
    })
  }

  // Sandbox mode — non-admins blocked entirely
  if (flags.site_sandbox_mode) {
    return new NextResponse(
      modePage('🧪 Sandbox Mode', 'ClipFinder is currently in testing mode. Check back soon!', '#10b981'),
      { status: 503, headers: { 'Content-Type': 'text/html' } }
    )
  }

  return response
}

function modePage(title: string, message: string, color: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — ClipFinder</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f0f; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .box { text-align: center; max-width: 420px; padding: 2rem; }
  .logo { font-size: 24px; font-weight: 700; margin-bottom: 2rem; }
  .logo span { color: ${color}; }
  h1 { font-size: 22px; font-weight: 500; margin-bottom: 12px; }
  p { color: rgba(255,255,255,0.5); font-size: 15px; line-height: 1.6; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: ${color}; display: inline-block; margin-bottom: 1.5rem; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
</head>
<body>
<div class="box">
  <div class="logo"><span>CLIP</span>FINDER</div>
  <div class="dot"></div>
  <h1>${title}</h1>
  <p>${message}</p>
</div>
</body>
</html>`
}

function blockedPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} — ClipFinder</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f0f; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .box { text-align: center; max-width: 420px; padding: 2rem; }
  .logo { font-size: 24px; font-weight: 700; margin-bottom: 2rem; }
  .logo span { color: #ef4444; }
  h1 { font-size: 22px; font-weight: 500; margin-bottom: 12px; }
  p { color: rgba(255,255,255,0.5); font-size: 15px; }
</style>
</head>
<body>
<div class="box">
  <div class="logo"><span>CLIP</span>FINDER</div>
  <h1>${title}</h1>
  <p>${message}</p>
</div>
</body>
</html>`
}
