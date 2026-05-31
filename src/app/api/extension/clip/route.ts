// src/app/api/extension/clip/route.ts
// Browser extension API — accepts clip commands with timestamps
// Auth: X-Api-Key header (user's personal API key from profiles.extension_api_key)
//
// POST body:
// {
//   vod_url: string,           // full VOD URL (Kick/Twitch/YouTube)
//   clips: [                   // array of timestamp pairs to cut
//     { start: "01:23:45", end: "01:27:30", label?: "funny moment" },
//     ...
//   ],
//   mode?: "auto" | "interview" | "auto_edit",
//   batch?: boolean            // if true, queue all as one job; default false (one job per clip)
//   stream_id?: string         // optional: group clips from same live stream session
// }
//
// Returns: { success: true, jobs: [{ jobId, clipIndex }] }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkQuota } from '@/lib/quota'

const MODAL_WORKER_URL = process.env.MODAL_WORKER_URL ?? ''
const WORKER_SECRET = process.env.WORKER_SECRET ?? ''
const MAX_CLIPS_PER_REQUEST = 20
const MAX_CLIP_DURATION_SEC = 4 * 60 // 4 minutes max per clip

function tsToSeconds(ts: string): number {
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

function secondsToTs(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()

    // ── Auth via API key ─────────────────────────────────────────────────────
    const apiKey = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace('Bearer ', '')
    console.log('[extension/clip] POST received, apiKey present:', !!apiKey, 'key prefix:', apiKey?.slice(0,8))
    if (!apiKey) {
      console.log('[extension/clip] rejected - no api key')
      return NextResponse.json({ error: 'Missing API key. Include X-Api-Key header.' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, tier, is_admin, is_banned, extension_api_key')
      .eq('extension_api_key', apiKey)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 })
    }

    if (profile.is_banned) {
      return NextResponse.json({ error: 'Account suspended.' }, { status: 403 })
    }

    const userId = profile.id

    // ── Validate body ────────────────────────────────────────────────────────
    const body = await req.json()
    const { vod_url, clips, streamer_name: streamerName = "", mode = 'auto', batch = false, stream_id, segments, live_url } = body

    // ── Segments mode (3x Kick clips to concat) ──────────────────────────────
    console.log('[extension/clip] body keys:', Object.keys(body))
    console.log('[extension/clip] segments:', JSON.stringify(segments)?.slice(0, 200))
    console.log('[extension/clip] clips:', JSON.stringify(clips)?.slice(0, 100))
    console.log('[extension/clip] vod_url:', vod_url?.slice(0, 80))
    if (segments && Array.isArray(segments) && segments.length > 0) {
      const quota = await checkQuota(userId)
      if (!quota.allowed) return NextResponse.json({ error: quota.message }, { status: 429 })

      const { data: job } = await supabase.from('jobs')
        .insert({ user_id: userId, source_url: vod_url, mode, status: 'queued', progress: 0, progress_msg: 'Queued...' })
        .select('id').single()

      if (!job) return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })

      if (MODAL_WORKER_URL) {
        fetch(MODAL_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.id, url: vod_url, userId, mode,
            authToken: WORKER_SECRET,
            streamerName,
            segments: segments.map((s: {url: string, index: number, id?: string}) => ({ url: s.url, index: s.index })),
            is_multi_segment: Array.isArray(segments) && segments.length > 1,
            total_duration_sec: body.total_duration_sec ?? segments.length * 90,
            segment_count: segments.length,
          }),
        }).catch(err => console.error('[extension/clip] worker fire failed:', err))
      }

      return NextResponse.json({ success: true, jobs: [{ jobId: job.id }] })
    }

    if (!vod_url || typeof vod_url !== 'string') {
      return NextResponse.json({ error: 'vod_url is required.' }, { status: 400 })
    }

    if (!clips || !Array.isArray(clips) || clips.length === 0) {
      return NextResponse.json({ error: 'clips array is required and must not be empty.' }, { status: 400 })
    }

    if (clips.length > MAX_CLIPS_PER_REQUEST) {
      return NextResponse.json({ error: `Maximum ${MAX_CLIPS_PER_REQUEST} clips per request.` }, { status: 400 })
    }

    // Validate and sanitize clip timestamps
    const validatedClips: { start: string; end: string; label?: string; durationSec: number }[] = []
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      if (!clip.start || !clip.end) {
        return NextResponse.json({ error: `Clip ${i + 1} missing start or end timestamp.` }, { status: 400 })
      }

      const startSec = tsToSeconds(clip.start)
      const endSec = tsToSeconds(clip.end)

      if (endSec <= startSec) {
        return NextResponse.json({ error: `Clip ${i + 1}: end must be after start.` }, { status: 400 })
      }

      const durationSec = endSec - startSec
      if (durationSec > MAX_CLIP_DURATION_SEC) {
        // Auto-trim to 4 minutes instead of rejecting
        validatedClips.push({
          start: clip.start,
          end: secondsToTs(startSec + MAX_CLIP_DURATION_SEC),
          label: clip.label,
          durationSec: MAX_CLIP_DURATION_SEC,
        })
      } else {
        validatedClips.push({ start: clip.start, end: clip.end, label: clip.label, durationSec })
      }
    }

    // ── Quota check ──────────────────────────────────────────────────────────
    const quota = await checkQuota(userId)
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.message, quota }, { status: 429 })
    }

    // ── Create jobs ──────────────────────────────────────────────────────────
    // batch=true: one job containing all clips as a pre-defined cut list
    // batch=false (default): one job per clip timestamp pair
    const createdJobs: { jobId: string; clipIndex: number }[] = []

    if (batch) {
      // Single job with a pre-specified cut list (extension_clips stored in job metadata)
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          user_id: userId,
          source_url: vod_url,
          mode,
          status: 'queued',
          progress: 0,
          progress_msg: `Extension job: ${validatedClips.length} clips queued`,
          stream_id: stream_id ?? null,
          extension_clips: validatedClips,  // stored as JSONB
          source: 'extension',
        })
        .select('id')
        .single()

      if (jobError || !job) {
        console.error('[extension/clip] batch job insert error:', jobError)
        return NextResponse.json({ error: 'Failed to create job.' }, { status: 500 })
      }

      createdJobs.push({ jobId: job.id, clipIndex: -1 })

      // Fire Modal worker
      if (!MODAL_WORKER_URL) {
        console.error('[extension] MODAL_WORKER_URL not set — job created but worker not triggered. Set MODAL_WORKER_URL in Vercel env vars.')
      } else if (MODAL_WORKER_URL) {
        fetch(`${MODAL_WORKER_URL}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.id,
            url: vod_url,
            userId,
            mode,
            authToken: WORKER_SECRET,
            extensionClips: validatedClips,
            streamerName,
          }),
        }).catch(err => console.error('[extension/clip] worker fire failed:', err))
      }

    } else {
      // One job per clip pair — each job targets a specific time range
      for (let i = 0; i < validatedClips.length; i++) {
        const clip = validatedClips[i]

        // Check quota again for each after first (concurrent limit)
        if (i > 0) {
          const q = await checkQuota(userId)
          if (!q.allowed) {
            // Return what we have so far with a warning
            return NextResponse.json({
              success: true,
              partial: true,
              message: `Quota limit reached after ${i} clips. ${q.message}`,
              jobs: createdJobs,
            })
          }
        }

        const { data: job, error: jobError } = await supabase
          .from('jobs')
          .insert({
            user_id: userId,
            source_url: vod_url,
            mode,
            status: 'queued',
            progress: 0,
            progress_msg: `Extension clip: ${clip.start} → ${clip.end}`,
            stream_id: stream_id ?? null,
            extension_clips: [clip],
            source: 'extension',
          })
          .select('id')
          .single()

        if (jobError || !job) {
          console.error(`[extension/clip] job ${i + 1} insert error:`, jobError)
          continue
        }

        createdJobs.push({ jobId: job.id, clipIndex: i })

        // Fire Modal worker (non-blocking)
        if (MODAL_WORKER_URL) {
          fetch(`${MODAL_WORKER_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jobId: job.id,
              url: vod_url,
              userId,
              mode,
              authToken: WORKER_SECRET,
              extensionClips: [clip],
            }),
          }).catch(err => console.error(`[extension/clip] worker fire for job ${i + 1} failed:`, err))
        }
      }
    }

    if (createdJobs.length === 0) {
      return NextResponse.json({ error: 'No jobs could be created.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      jobs: createdJobs,
      message: `${createdJobs.length} job${createdJobs.length > 1 ? 's' : ''} queued. Poll /api/jobs/{jobId} for status.`,
    })

  } catch (err) {
    console.error('[extension/clip] error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

// GET — poll multiple job statuses at once (extension convenience endpoint)
// ?jobs=jobId1,jobId2,jobId3
export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()

    const apiKey = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace('Bearer ', '')
    if (!apiKey) return NextResponse.json({ error: 'Missing API key.' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('extension_api_key', apiKey)
      .single()

    if (!profile) return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 })

    const jobIds = req.nextUrl.searchParams.get('jobs')?.split(',').filter(Boolean) ?? []
    if (jobIds.length === 0) return NextResponse.json({ jobs: [] })

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, status, progress, progress_msg, error_msg, clips_found, video_title')
      .eq('user_id', profile.id)
      .in('id', jobIds.slice(0, 20))

    return NextResponse.json({ jobs: jobs ?? [] })
  } catch (err) {
    console.error('[extension/clip GET] error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
