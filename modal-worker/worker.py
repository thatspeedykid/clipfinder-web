# modal-worker/worker.py
# ClipFinder video processing worker
# Supports: YouTube (+user cookies), Kick, Twitch, Twitter/X
# No-download mode: only pulls clip segments
# Deploy: modal deploy worker.py

import modal
import os
import json
import tempfile
import subprocess
import re
from pathlib import Path

app = modal.App("clipfinder-worker")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "curl")
    .pip_install(
        "yt-dlp",
        "groq",
        "boto3",
        "requests",
        "curl_cffi",
        "supabase",
        "fastapi[standard]",
    )
)

secrets = [modal.Secret.from_name("clipfinder-secrets")]


def update_job(sb, job_id, status, progress, msg, extra={}):
    sb.table("jobs").update({"status": status, "progress": progress, "progress_msg": msg, **extra}).eq("id", job_id).execute()
    print(f"[{job_id[:8]}] {status} {progress}% — {msg}")


def get_flag(sb, key, default=True):
    try:
        r = sb.table("feature_flags").select("enabled").eq("key", key).single().execute()
        return r.data["enabled"] if r.data else default
    except Exception:
        return default


def get_config(sb, key, default=""):
    try:
        r = sb.table("config").select("value").eq("key", key).single().execute()
        return r.data["value"] if r.data else default
    except Exception:
        return default


def ts_to_seconds(ts):
    parts = ts.strip().split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    return float(parts[0])


def detect_source(url):
    if "youtube.com" in url or "youtu.be" in url:
        return "youtube"
    if "kick.com" in url:
        return "kick"
    if "twitch.tv" in url:
        return "twitch"
    if "twitter.com" in url or "x.com" in url:
        return "twitter"
    return "unknown"


def get_user_cookies(sb, user_id):
    """Get user's personal YouTube cookies from user_secrets table."""
    try:
        r = sb.table("user_secrets").select("yt_cookies").eq("user_id", user_id).single().execute()
        return (r.data or {}).get("yt_cookies", "")
    except Exception:
        return ""


def write_cookies_file(tmp, cookie_content):
    """Write cookies to a temp file and return the path."""
    if not cookie_content.strip():
        return None
    path = str(tmp / "cookies.txt")
    with open(path, "w") as f:
        f.write(cookie_content)
    return path


def run_yt_dlp(cmd, timeout=300):
    """Run yt-dlp with common error handling."""
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return result


def get_kick_clip_direct(clip_slug, tmp):
    """
    Bypass yt-dlp for Kick clips by hitting their API directly.
    Uses curl_cffi with browser impersonation to bypass Cloudflare.
    """
    try:
        from curl_cffi import requests as cf_requests
    except ImportError:
        import requests as cf_requests

    # Extract slug from URL
    slug = clip_slug.split('/')[-1]
    if '?' in slug:
        slug = slug.split('?')[0]

    print(f"[kick] trying direct API for slug: {slug}")

    # Try with curl_cffi browser impersonation
    for browser in ["chrome124", "chrome131", "safari17_0"]:
        try:
            r = cf_requests.get(
                f"https://kick.com/api/v2/clips/{slug}",
                impersonate=browser,
                timeout=15,
                headers={
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://kick.com/',
                    'Origin': 'https://kick.com',
                }
            )
            if r.ok:
                data = r.json()
                clip_url = (data.get('clip_url') or data.get('video_url') or
                           data.get('playback_url') or
                           data.get('clip', {}).get('video_url', ''))
                title = data.get('title') or data.get('clip', {}).get('title', '')
                duration = data.get('duration', 0)
                if clip_url:
                    print(f"[kick] API success with {browser}: {clip_url[:60]}")
                    return clip_url, title, duration
            print(f"[kick] {browser} got {r.status_code}")
        except Exception as e:
            print(f"[kick] {browser} failed: {e}")

    return None, None, 0


def download_audio(url, tmp, source, cookies_file=None):
    """Download audio only — much faster than full video."""
    audio_raw = tmp / "audio_raw.%(ext)s"

    # Kick: try direct API first, then yt-dlp as fallback
    if source == "kick":
        clip_url, _, _ = get_kick_clip_direct(url, tmp)
        if clip_url:
            # Download the direct MP4 URL
            cmd = [
                "yt-dlp", clip_url,
                "-o", str(audio_raw),
                "-x", "--audio-format", "mp3", "--audio-quality", "64K",
                "--quiet", "--no-warnings",
            ]
            result = run_yt_dlp(cmd)
            if result.returncode == 0:
                return result
            print(f"[kick] Direct URL download failed, trying yt-dlp...")

    cmd = [
        "yt-dlp", url,
        "-o", str(audio_raw),
        "-x", "--audio-format", "mp3", "--audio-quality", "64K",
        "--no-playlist", "--quiet", "--no-warnings",
    ]

    if source == "kick":
        # If we got a direct CDN URL (clips.kick.com), download it directly
        if "clips.kick.com" in url:
            cmd += ["-f", "best", "--no-playlist"]
        else:
            cmd += [
                "--add-headers", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "--add-headers", "Referer:https://kick.com/",
                "--add-headers", "Origin:https://kick.com",
                "--extractor-retries", "5",
                "--fragment-retries", "5",
            ]
    elif source == "youtube":
        cmd += [
            "--extractor-args", "youtube:player_client=tv_simply,web",
            "--no-check-certificates",
            "--sleep-requests", "1",
        ]
        proxy = get_proxy()
        if proxy:
            cmd += ["--proxy", proxy]
            print("[proxy] routing YouTube through residential proxy")
        # With tv_simply client, cookies work better
        if cookies_file:
            cmd += ["--cookies", cookies_file]
    elif source == "twitch":
        cmd += ["-f", "audio_only/bestaudio/best"]
    elif source in ("twitter", "unknown"):
        cmd += ["-f", "bestaudio/best"]

    if cookies_file:
        cmd += ["--cookies", cookies_file]

    return run_yt_dlp(cmd)


def get_proxy():
    """Get proxy URL from environment for YouTube requests."""
    return os.environ.get("PROXY_URL", "")


def get_video_info(url, cookies_file=None, source="unknown"):
    """Get video metadata without downloading."""
    cmd = ["yt-dlp", url, "--dump-json", "--no-playlist", "--quiet"]
    if source == "youtube":
        cmd += ["--extractor-args", "youtube:player_client=android,web"]
        proxy = get_proxy()
        if proxy:
            cmd += ["--proxy", proxy]
    if cookies_file:
        cmd += ["--cookies", cookies_file]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode == 0 and result.stdout.strip():
        try:
            return json.loads(result.stdout.strip())
        except Exception:
            pass
    # For Kick, try direct API
    if source == "kick":
        _, title, duration = get_kick_clip_direct(url, None)
        if title:
            return {"title": title, "duration": duration}
    return {}


def convert_to_mp3(input_path, output_path, bitrate="64k"):
    """Convert any audio file to mono mp3."""
    subprocess.run([
        "ffmpeg", "-i", str(input_path),
        "-ar", "16000", "-ac", "1", "-b:a", bitrate,
        str(output_path), "-y", "-loglevel", "error"
    ], timeout=120)


def compress_audio_if_needed(audio_path, tmp):
    """Compress audio if over 24MB (Groq limit)."""
    size_mb = audio_path.stat().st_size / 1024 / 1024
    if size_mb > 24:
        compressed = tmp / "audio_small.mp3"
        convert_to_mp3(audio_path, compressed, "32k")
        if compressed.exists():
            print(f"[audio] compressed {size_mb:.1f}MB → {compressed.stat().st_size/1024/1024:.1f}MB")
            return compressed
    return audio_path


def transcribe_with_groq(audio_path, groq_api_key):
    """Transcribe audio with Groq Whisper, return timestamped text."""
    from groq import Groq
    client = Groq(api_key=groq_api_key)
    with open(audio_path, "rb") as f:
        result = client.audio.transcriptions.create(
            file=(audio_path.name, f),
            model="whisper-large-v3",
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )
    segments = result.segments or []
    lines = []
    for seg in segments:
        start = seg.get("start", 0)
        text = seg.get("text", "").strip()
        h, m, s = int(start // 3600), int((start % 3600) // 60), start % 60
        lines.append(f"[{h:02d}:{m:02d}:{s:05.2f}] {text}")
    print(f"[transcribe] {len(segments)} segments")
    return "\n".join(lines)


def cut_clip_section(url, start_ts, end_ts, output_path, cookies_file=None, source="unknown", direct_url=None):
    """Download only the specific clip section (no-download mode).
    For Kick, use direct_url (from API) to bypass 403."""
    
    # For Kick, use the direct CDN URL with ffmpeg instead of yt-dlp
    if source == "kick" and direct_url:
        start_sec = ts_to_seconds(start_ts)
        end_sec = ts_to_seconds(end_ts)
        duration = end_sec - start_sec
        # Use input seeking (-ss before -i) — fast, no full download needed
        result = subprocess.run([
            "ffmpeg",
            "-ss", str(start_sec),      # seek BEFORE input = fast
            "-i", direct_url,
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(output_path), "-y", "-loglevel", "error"
        ], capture_output=True, text=True, timeout=180)
        if result.returncode != 0:
            print(f"[kick] ffmpeg stderr: {result.stderr[-200:]}")
        return result

    section_str = f"*{start_ts}-{end_ts}"
    cmd = [
        "yt-dlp", url,
        "-o", str(output_path.parent / f"{output_path.stem}.%(ext)s"),
        "--download-sections", section_str,
        "--force-keyframes-at-cuts",
        "--merge-output-format", "mp4",
        "--no-playlist", "--quiet", "--no-warnings",
    ]
    if source == "kick":
        cmd += [
            "--add-headers", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "--add-headers", "Referer:https://kick.com/",
            "--extractor-retries", "5",
        ]
    elif source in ("twitter", "twitch", "unknown"):
        cmd += ["-f", "best[height<=720]/best"]
    else:
        cmd += ["-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best"]

    if cookies_file:
        cmd += ["--cookies", cookies_file]

    return run_yt_dlp(cmd)



def _upload_clip_to_storage(sb, clip_path, user_id, job_id, clip_num, clip_id, start_ts):
    """Upload a clip file to Supabase Storage and update the clip record."""
    from datetime import datetime, timedelta
    try:
        profile_res = sb.table("profiles").select("tier").eq("id", user_id).single().execute()
        tier = (profile_res.data or {}).get("tier", "free")
        expires = datetime.utcnow() + (timedelta(hours=12) if tier == "free" else timedelta(days=15))
        storage_path = f"{user_id}/{job_id}/clip_{clip_num}.mp4"
        with open(clip_path, "rb") as f:
            clip_data = f.read()
        sb.storage.from_("clips").upload(path=storage_path, file=clip_data, file_options={"content-type": "video/mp4", "upsert": "true"})
        sign_seconds = int((expires - datetime.utcnow()).total_seconds())
        signed = sb.storage.from_("clips").create_signed_url(storage_path, sign_seconds)
        file_url = signed.get("signedURL", "")
        size_mb = round(clip_path.stat().st_size / 1024 / 1024, 2)
        if clip_id:
            sb.table("clips").update({
                "file_url": file_url, "file_expires_at": expires.isoformat(),
                "file_size_mb": size_mb, "storage_path": storage_path
            }).eq("id", clip_id).execute()
        print(f"[storage] clip {clip_num} uploaded {size_mb}MB — expires {expires.strftime('%Y-%m-%d %H:%M')} UTC")
        clip_path.unlink(missing_ok=True)
        return True
    except Exception as e:
        print(f"[storage] upload failed for clip {clip_num}: {e}")
        clip_path.unlink(missing_ok=True)
        return False


def _ext_cut_and_upload(sb, tmp, source_url, extension_clips, job_id, user_id, seg_start_offset=0):
    """Cut clips at given timestamps from HLS URL and upload."""
    # Insert clip rows
    clip_rows = []
    for ec in extension_clips:
        start = ec.get("start", "00:00:00")
        end = ec.get("end", "00:01:00")
        clip_rows.append({
            "job_id": job_id, "user_id": user_id,
            "title": ec.get("label") or f"Extension clip {start}–{end}",
            "summary": "Clipped via browser extension",
            "start_ts": start, "end_ts": end,
            "duration_sec": int(ts_to_seconds(end) - ts_to_seconds(start)), "score": 80,
        })
    sb.table("clips").insert(clip_rows).execute()
    db_clips = sb.table("clips").select("id, start_ts").eq("job_id", job_id).execute()
    clip_id_map = {r["start_ts"]: r["id"] for r in (db_clips.data or [])}

    for i, ec in enumerate(extension_clips):
        start_ts = ec.get("start", "00:00:00")
        end_ts = ec.get("end", "00:01:00")
        clip_path = tmp / f"clip_{i+1}.mp4"
        start_sec = ts_to_seconds(start_ts) + seg_start_offset
        duration = ts_to_seconds(end_ts) - ts_to_seconds(start_ts)
        result = subprocess.run([
            "ffmpeg", "-ss", str(start_sec), "-i", source_url,
            "-t", str(duration), "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
            str(clip_path), "-y", "-loglevel", "error"
        ], capture_output=True, text=True, timeout=300)
        if result.returncode == 0 and clip_path.exists():
            clip_id = clip_id_map.get(start_ts, "")
            _upload_clip_to_storage(sb, clip_path, user_id, job_id, i+1, clip_id, start_ts)

    update_job(sb, job_id, "done", 100, f"Done! {len(extension_clips)} clips ready", {"clips_found": len(extension_clips)})
    print(f"[done] job {job_id[:8]} — {len(extension_clips)} extension clips")


def _upload_clips_from_hls(sb, tmp, source_url, clips_data, clip_id_map, job_id, user_id, seg_start_offset=0):
    """Cut and upload AI-identified clips from HLS URL."""
    for i, clip in enumerate(clips_data):
        start_ts = clip.get("start_ts", "00:00:00")
        end_ts = clip.get("end_ts", "00:01:00")
        clip_path = tmp / f"clip_{i+1}.mp4"
        # Offset by segment start since transcript timestamps are relative to segment
        start_sec = ts_to_seconds(start_ts) + seg_start_offset
        duration = ts_to_seconds(end_ts) - ts_to_seconds(start_ts)
        print(f"[extension] cutting clip {i+1}: {start_ts}+{seg_start_offset}s offset")
        result = subprocess.run([
            "ffmpeg", "-ss", str(start_sec), "-i", source_url,
            "-t", str(duration), "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
            str(clip_path), "-y", "-loglevel", "error"
        ], capture_output=True, text=True, timeout=300)
        if result.returncode == 0 and clip_path.exists():
            clip_id = clip_id_map.get(start_ts, "")
            _upload_clip_to_storage(sb, clip_path, user_id, job_id, i+1, clip_id, start_ts)
        else:
            print(f"[extension] ffmpeg failed clip {i+1}: {result.stderr[-100:]}")

    done_count = len(clips_data)
    update_job(sb, job_id, "done", 100, f"Done! {done_count} clips ready", {"clips_found": done_count})
    print(f"[done] job {job_id[:8]} — {done_count} extension clips")


@app.function(image=image, secrets=secrets, timeout=600, memory=2048, cpu=2.0)
def process_video(job_id: str, source_url: str, user_id: str, mode: str = "auto", extension_clips: list = None, streamer_name: str = ""):
    from supabase import create_client
    import requests as req

    sb = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    use_groq = get_flag(sb, "transcribe_groq", True)
    use_cookies_flag = get_flag(sb, "feature_youtube_cookies", True)
    no_download_mode = get_flag(sb, "feature_no_download", True)

    source = detect_source(source_url)
    print(f"[source] {source} — {source_url[:80]}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # ── Cookies: user-specific first, then global fallback ────────────────
        cookies_file = None
        kick_direct_url = None  # Store direct URL for Kick cutting
        if use_cookies_flag:
            cookie_content = get_user_cookies(sb, user_id)
            if not cookie_content.strip():
                cookie_content = get_config(sb, "YOUTUBE_COOKIES", "")
            cookies_file = write_cookies_file(tmp, cookie_content)
            if cookies_file:
                print(f"[cookies] loaded ({len(cookie_content)} chars)")

        # ── Step 1: Get video info ────────────────────────────────────────────
        update_job(sb, job_id, "downloading", 5, "Fetching video info...")
        video_title = ""
        video_duration = 0

        # Detect HLS stream URLs from browser extension (stream.kick.com or .m3u8)
        is_hls_stream = "stream.kick.com" in source_url or ".m3u8" in source_url

        # For HLS streams from extension: download segment audio, transcribe, AI finds best moment
        if is_hls_stream and extension_clips and len(extension_clips) > 0:
            print(f"[extension] HLS stream — downloading segment audio for AI analysis")
            ec0 = extension_clips[0]
            seg_start = ts_to_seconds(ec0.get("start", "00:00:00"))
            seg_end = ts_to_seconds(ec0.get("end", "00:04:00"))
            seg_duration = seg_end - seg_start
            video_title = streamer_name or "Extension clip"
            sb.table("jobs").update({"video_title": video_title}).eq("id", job_id).execute()

            # Download just the segment audio from HLS
            update_job(sb, job_id, "downloading", 15, "Downloading stream segment...")
            seg_audio = tmp / "seg_audio.mp3"
            result = subprocess.run([
                "ffmpeg", "-ss", str(seg_start), "-i", source_url,
                "-t", str(seg_duration), "-vn",
                "-ar", "16000", "-ac", "1", "-b:a", "32k",
                str(seg_audio), "-y", "-loglevel", "error"
            ], capture_output=True, text=True, timeout=300)

            if result.returncode != 0 or not seg_audio.exists():
                # Fallback: cut at timestamps directly without AI
                print(f"[extension] audio download failed, cutting directly at timestamps")
                _ext_cut_and_upload(sb, tmp, source_url, extension_clips, job_id, user_id, seg_start)
                return

            print(f"[extension] segment audio: {seg_audio.stat().st_size/1024/1024:.1f}MB")

            # Transcribe
            update_job(sb, job_id, "transcribing", 35, "Transcribing stream segment...")
            transcript_text = ""
            try:
                transcript_text = transcribe_with_groq(seg_audio, os.environ["GROQ_API_KEY"])
                print(f"[extension] transcript: {len(transcript_text)} chars")
            except Exception as e:
                print(f"[extension] transcription failed: {e}")

            if not transcript_text:
                print("[extension] no transcript, cutting at timestamps")
                _ext_cut_and_upload(sb, tmp, source_url, extension_clips, job_id, user_id, seg_start)
                return

            # AI analysis
            update_job(sb, job_id, "analyzing", 50, "AI finding best moment...")
            app_url = os.environ.get("NEXT_PUBLIC_APP_URL", "").rstrip("/")
            try:
                analyze_resp = req.post(
                    f"{app_url}/api/analyze",
                    json={"jobId": job_id, "transcript": transcript_text, "videoTitle": video_title,
                          "mode": mode, "userId": user_id, "names": streamer_name, "clipsTarget": 3,
                          "segmentOffsetSec": seg_start},
                    headers={"Authorization": f"Bearer {os.environ['WORKER_SECRET']}", "Content-Type": "application/json"},
                    timeout=120,
                )
                if not analyze_resp.ok:
                    raise Exception(f"analyze {analyze_resp.status_code}")
                clips_data = analyze_resp.json().get("clips", [])
                clip_id_map = {c.get("start_ts", ""): c.get("id", "") for c in clips_data}
            except Exception as e:
                print(f"[extension] AI failed: {e}, cutting at timestamps")
                _ext_cut_and_upload(sb, tmp, source_url, extension_clips, job_id, user_id, seg_start)
                return

            # Cut AI-identified clips from HLS
            update_job(sb, job_id, "cutting", 70, f"Cutting {len(clips_data)} clips...")
            _upload_clips_from_hls(sb, tmp, source_url, clips_data, clip_id_map, job_id, user_id, seg_start)
            return

        # For Kick: get direct URL ONCE here, reuse for audio + cutting
        kick_direct_url = None
        if source == "kick":
            kick_direct_url, kick_title, kick_duration = get_kick_clip_direct(source_url, tmp)
            if kick_direct_url:
                video_title = kick_title or "Kick clip"
                video_duration = kick_duration or 0
                print(f"[kick] cached direct URL: {kick_direct_url[:60]}")
                sb.table("jobs").update({"video_title": video_title, "video_duration": video_duration}).eq("id", job_id).execute()
                print(f"[info] {video_title} ({video_duration}s)")
            else:
                err = "Could not get Kick clip URL"
                update_job(sb, job_id, "error", 0, err, {"error_msg": err})
                return
        else:
            info = get_video_info(source_url, cookies_file, source)
            video_title = info.get("title", "")
            video_duration = int(info.get("duration", 0))
            if video_title:
                sb.table("jobs").update({"video_title": video_title, "video_duration": video_duration}).eq("id", job_id).execute()
                print(f"[info] {video_title} ({video_duration}s)")

        # ── Step 2: Download audio ─────────────────────────────────────────────
        update_job(sb, job_id, "downloading", 15, "Downloading audio...")
        # For Kick: use the already-fetched direct URL, skip API call
        audio_result = download_audio(
            kick_direct_url if source == "kick" and kick_direct_url else source_url,
            tmp, source, cookies_file
        )
        audio_files = list(tmp.glob("audio_raw.*"))

        if audio_result.returncode != 0 or not audio_files:
            # Parse error for user-friendly message
            stderr = audio_result.stderr if audio_result.returncode != 0 else ""
            if "Sign in" in stderr or "cookies" in stderr.lower():
                err = "This video requires login. Add your YouTube cookies in Settings."
            elif "Private" in stderr:
                err = "This video is private."
            elif "403" in stderr or "Forbidden" in stderr:
                err = f"Access denied by {source.capitalize()}. This clip may be private or region-locked."
            elif "available" in stderr.lower():
                err = "This video is not available."
            else:
                err = f"Download failed: {stderr[-200:] if stderr else 'Unknown error'}"
            update_job(sb, job_id, "error", 0, err, {"error_msg": err})
            return

        # Convert to standard mp3
        audio_path = tmp / "audio.mp3"
        convert_to_mp3(audio_files[0], audio_path)
        if not audio_path.exists():
            err = "Audio conversion failed"
            update_job(sb, job_id, "error", 0, err, {"error_msg": err})
            return

        audio_path = compress_audio_if_needed(audio_path, tmp)
        print(f"[audio] {audio_path.stat().st_size/1024/1024:.1f}MB")

        # ── Extension clips fast path ──────────────────────────────────────────
        # If the browser extension pre-specified timestamps, skip transcription
        # and AI analysis entirely — go straight to cutting.
        if extension_clips and len(extension_clips) > 0:
            print(f"[extension] {len(extension_clips)} pre-specified clips — skipping transcription & AI")
            update_job(sb, job_id, "cutting", 70, f"Cutting {len(extension_clips)} extension clips...")

            # Insert clip rows into DB so they show up in history
            clip_rows = []
            for ec in extension_clips:
                start = ec.get("start", "00:00:00")
                end = ec.get("end", "00:01:00")
                start_sec = ts_to_seconds(start)
                end_sec = ts_to_seconds(end)
                clip_rows.append({
                    "job_id": job_id,
                    "user_id": user_id,
                    "title": ec.get("label") or f"Extension clip {start}–{end}",
                    "summary": "Clipped via browser extension",
                    "start_ts": start,
                    "end_ts": end,
                    "duration_sec": int(end_sec - start_sec),
                    "score": 80,
                })
            sb.table("clips").insert(clip_rows).execute()

            # Fetch back with real UUIDs
            db_clips = sb.table("clips").select("id, start_ts").eq("job_id", job_id).execute()
            clip_id_map = {r["start_ts"]: r["id"] for r in (db_clips.data or [])}

            # Build clips list in same format as AI output
            clips = []
            for ec in extension_clips:
                clips.append({
                    "start_ts": ec.get("start", "00:00:00"),
                    "end_ts": ec.get("end", "00:01:00"),
                    "id": clip_id_map.get(ec.get("start", ""), ""),
                })

        else:
            # ── Step 3: Transcribe ─────────────────────────────────────────────
            update_job(sb, job_id, "transcribing", 35, "Transcribing audio...")
            transcript_text = ""

            if use_groq:
                try:
                    transcript_text = transcribe_with_groq(audio_path, os.environ["GROQ_API_KEY"])
                except Exception as e:
                    print(f"[transcribe] Groq failed: {e}")

            if not transcript_text:
                err = "Transcription failed"
                update_job(sb, job_id, "error", 0, err, {"error_msg": err})
                return

            sb.table("jobs").update({"transcript": transcript_text}).eq("id", job_id).execute()
            update_job(sb, job_id, "analyzing", 50, "AI finding best clips...")

            # ── Step 4: AI analysis ───────────────────────────────────────────
            app_url = os.environ.get("NEXT_PUBLIC_APP_URL", "").rstrip("/")
            worker_secret_val = os.environ.get('WORKER_SECRET', 'NOT_SET')
            print(f"[analyze] sending secret: {worker_secret_val[:6]}... to {app_url}/api/analyze")
            analyze_resp = req.post(
                f"{app_url}/api/analyze",
                json={"jobId": job_id, "transcript": transcript_text, "videoTitle": video_title, "mode": mode, "userId": user_id, "names": streamer_name},
                headers={"Authorization": f"Bearer {os.environ['WORKER_SECRET']}", "Content-Type": "application/json"},
                timeout=120,
            )

            if not analyze_resp.ok:
                err = f"AI analysis failed: {analyze_resp.status_code}"
                try:
                    resp_json = analyze_resp.json()
                    err = resp_json.get("error", err)
                    details = resp_json.get("details", "")
                    if details:
                        print(f"[analyze] error details: {details}")
                except Exception:
                    pass
                print(f"[analyze] full response: {analyze_resp.text[:500]}")
                update_job(sb, job_id, "error", 0, err, {"error_msg": err})
                return

            clips = analyze_resp.json().get("clips", [])
            if not clips:
                err = "No clips found in this video"
                update_job(sb, job_id, "error", 0, err, {"error_msg": err})
                return

            update_job(sb, job_id, "cutting", 70, f"Cutting {len(clips)} clips...")

        # Build a lookup: start_ts -> supabase clip id
        # The analyze API now returns clips with real UUIDs
        clip_id_map = {}
        for c in clips:
            real_id = c.get("id", "")
            start = c.get("start_ts", "")
            if real_id and start:
                clip_id_map[start] = real_id

        # Fallback: fetch from DB by job_id if map is empty
        if not clip_id_map:
            db_clips = sb.table("clips").select("id, start_ts").eq("job_id", job_id).execute()
            for row in (db_clips.data or []):
                clip_id_map[row["start_ts"]] = row["id"]

        # ── Step 5: Cut clips ──────────────────────────────────────────────────
        for i, clip in enumerate(clips):
            start_ts = clip.get("start_ts", "00:00:00")
            end_ts = clip.get("end_ts", "00:01:00")
            duration = ts_to_seconds(end_ts) - ts_to_seconds(start_ts)
            if duration <= 0:
                continue

            progress = 70 + int((i / len(clips)) * 25)
            update_job(sb, job_id, "cutting", progress, f"Cutting clip {i+1}/{len(clips)}")

            clip_path = tmp / f"clip_{i+1}.mp4"

            if no_download_mode:
                result = cut_clip_section(source_url, start_ts, end_ts, clip_path, cookies_file, source, direct_url=kick_direct_url if source == "kick" else None)
                # Kick with direct URL: ffmpeg writes directly to clip_path
                if source == "kick" and kick_direct_url:
                    if result.returncode != 0 or not clip_path.exists():
                        print(f"[cut] Kick ffmpeg cut failed: {result.stderr[-100:]}")
                        continue
                else:
                    seg_files = list(tmp.glob(f"clip_{i+1}.*"))
                    if result.returncode == 0 and seg_files:
                        actual = seg_files[0]
                        if str(actual) != str(clip_path):
                            subprocess.run(["ffmpeg", "-i", str(actual), "-c", "copy", str(clip_path), "-y", "-loglevel", "error"], timeout=60)
                    else:
                        print(f"[cut] clip {i+1} section download failed: {result.stderr[-100:]}")
                        continue
            else:
                print(f"[cut] clip {i+1} — no full video available, skipping")
                continue

            if not clip_path.exists():
                print(f"[cut] clip {i+1} output missing")
                continue

            clip_size_mb = clip_path.stat().st_size / 1024 / 1024
            print(f"[cut] clip {i+1} — {clip_size_mb:.1f}MB")

            # ── Upload to Supabase Storage ────────────────────────────────
            # Free tier: 24h expiry. Pro/Agency: 15 days.
            try:
                # Get user tier for expiry calculation
                profile_res = sb.table("profiles").select("tier").eq("id", user_id).single().execute()
                tier = (profile_res.data or {}).get("tier", "free")
                from datetime import datetime, timedelta
                if tier == "free":
                    expires = datetime.utcnow() + timedelta(hours=12)
                else:
                    expires = datetime.utcnow() + timedelta(days=15)

                # Upload to Supabase Storage bucket "clips"
                storage_path = f"{user_id}/{job_id}/clip_{i+1}.mp4"
                with open(clip_path, "rb") as f:
                    clip_data = f.read()

                sb.storage.from_("clips").upload(
                    path=storage_path,
                    file=clip_data,
                    file_options={"content-type": "video/mp4", "upsert": "true"}
                )

                # Get signed URL valid for expiry duration
                sign_seconds = int((expires - datetime.utcnow()).total_seconds())
                signed = sb.storage.from_("clips").create_signed_url(storage_path, sign_seconds)
                file_url = signed.get("signedURL", "")

                # Update clip record — use the real Supabase UUID from our map
                clip_id = clip_id_map.get(start_ts, "")
                if not clip_id:
                    # Last resort: fetch by job_id + start_ts
                    try:
                        row = sb.table("clips").select("id").eq("job_id", job_id).eq("start_ts", start_ts).single().execute()
                        clip_id = (row.data or {}).get("id", "")
                    except Exception:
                        pass
                if clip_id:
                    sb.table("clips").update({
                        "file_url": file_url,
                        "file_expires_at": expires.isoformat(),
                        "file_size_mb": round(clip_size_mb, 2),
                        "storage_path": storage_path,
                    }).eq("id", clip_id).execute()
                    print(f"[storage] updated clip record {clip_id[:8]}")
                else:
                    print(f"[storage] WARNING: could not find clip record for start_ts={start_ts}")

                print(f"[storage] uploaded clip {i+1} — expires {expires.strftime('%Y-%m-%d %H:%M')} UTC")
                clip_path.unlink(missing_ok=True)

            except Exception as e:
                print(f"[storage] upload failed for clip {i+1}: {e}")
                # Still delete local file even if upload fails
                clip_path.unlink(missing_ok=True)

        # ── Optional: Upload to Google Drive ──────────────────────────────────
        try:
            drive_secrets = sb.table("user_secrets").select(
                "gdrive_access_token, gdrive_refresh_token, gdrive_token_expires_at"
            ).eq("user_id", user_id).single().execute()

            if drive_secrets.data and drive_secrets.data.get("gdrive_access_token"):
                gdrive_access_token = drive_secrets.data["gdrive_access_token"]
                gdrive_refresh_token = drive_secrets.data.get("gdrive_refresh_token", "")
                expires_at_str = drive_secrets.data.get("gdrive_token_expires_at", "")

                # Refresh token if expired
                from datetime import datetime as dt
                if expires_at_str:
                    token_exp = dt.fromisoformat(expires_at_str.replace("Z", "+00:00"))
                    if dt.utcnow().replace(tzinfo=token_exp.tzinfo) > token_exp:
                        print("[gdrive] access token expired, refreshing...")
                        refresh_resp = req.post("https://oauth2.googleapis.com/token", data={
                            "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
                            "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
                            "refresh_token": gdrive_refresh_token,
                            "grant_type": "refresh_token",
                        })
                        if refresh_resp.ok:
                            new_tokens = refresh_resp.json()
                            gdrive_access_token = new_tokens["access_token"]
                            new_exp = dt.utcnow().replace(microsecond=0).isoformat()
                            sb.table("user_secrets").update({
                                "gdrive_access_token": gdrive_access_token,
                                "gdrive_token_expires_at": new_exp,
                            }).eq("user_id", user_id).execute()
                        else:
                            print(f"[gdrive] token refresh failed: {refresh_resp.status_code}")

                # Get or create ClipFinder folder in Drive
                folder_id = None
                search_resp = req.get(
                    "https://www.googleapis.com/drive/v3/files",
                    params={"q": "name='ClipFinder' and mimeType='application/vnd.google-apps.folder' and trashed=false", "fields": "files(id)"},
                    headers={"Authorization": f"Bearer {gdrive_access_token}"},
                )
                if search_resp.ok:
                    files = search_resp.json().get("files", [])
                    if files:
                        folder_id = files[0]["id"]
                    else:
                        # Create folder
                        create_resp = req.post(
                            "https://www.googleapis.com/drive/v3/files",
                            json={"name": "ClipFinder", "mimeType": "application/vnd.google-apps.folder"},
                            headers={"Authorization": f"Bearer {gdrive_access_token}", "Content-Type": "application/json"},
                        )
                        if create_resp.ok:
                            folder_id = create_resp.json().get("id")

                # Upload completed clips from Supabase to Drive
                drive_clips = sb.table("clips").select("id, title, storage_path").eq("job_id", job_id).execute()
                uploaded_count = 0
                for dc in (drive_clips.data or []):
                    if not dc.get("storage_path"):
                        continue
                    try:
                        # Download from Supabase Storage
                        clip_bytes_resp = sb.storage.from_("clips").download(dc["storage_path"])
                        if not clip_bytes_resp:
                            continue
                        clip_bytes = clip_bytes_resp if isinstance(clip_bytes_resp, bytes) else bytes(clip_bytes_resp)

                        fname = f"{dc.get('title', 'clip')[:50].replace('/', '-')}.mp4"

                        # Multipart upload to Drive
                        import io
                        metadata = {"name": fname, "parents": [folder_id] if folder_id else []}
                        boundary = "clip_boundary_xyz"
                        body = (
                            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                            + json.dumps(metadata)
                            + f"\r\n--{boundary}\r\nContent-Type: video/mp4\r\n\r\n"
                        ).encode() + clip_bytes + f"\r\n--{boundary}--".encode()

                        upload_resp = req.post(
                            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
                            data=body,
                            headers={
                                "Authorization": f"Bearer {gdrive_access_token}",
                                "Content-Type": f"multipart/related; boundary={boundary}",
                            },
                            timeout=120,
                        )
                        if upload_resp.ok:
                            drive_file_id = upload_resp.json().get("id", "")
                            # Save Drive file ID to clip record
                            sb.table("clips").update({"gdrive_file_id": drive_file_id}).eq("id", dc["id"]).execute()
                            uploaded_count += 1
                            print(f"[gdrive] uploaded {fname} → Drive file {drive_file_id[:12]}")
                        else:
                            print(f"[gdrive] upload failed for {fname}: {upload_resp.status_code} {upload_resp.text[:200]}")
                    except Exception as e:
                        print(f"[gdrive] clip upload error: {e}")

                if uploaded_count > 0:
                    print(f"[gdrive] {uploaded_count}/{len(drive_clips.data or [])} clips uploaded to Google Drive")
                    sb.table("jobs").update({"gdrive_upload_count": uploaded_count}).eq("id", job_id).execute()

        except Exception as e:
            # Drive upload is optional — don't fail the job if it errors
            print(f"[gdrive] Drive upload skipped: {e}")

        update_job(sb, job_id, "done", 100, f"Done! {len(clips)} clips ready", {"clips_found": len(clips)})
        print(f"[done] job {job_id[:8]} — {len(clips)} clips")


@app.function(image=image, secrets=secrets, timeout=30)
@modal.fastapi_endpoint(method="POST")
def start(body: dict):
    from supabase import create_client
    job_id = body.get("jobId")
    source_url = body.get("url")
    user_id = body.get("userId")
    mode = body.get("mode", "auto")
    auth_token = body.get("authToken", "")
    extension_clips = body.get("extensionClips", None)  # pre-defined timestamps from browser extension
    streamer_name = body.get("streamerName", "")  # streamer name from extension page

    worker_secret = os.environ.get("WORKER_SECRET", "")
    if worker_secret and auth_token != worker_secret:
        return {"error": "Unauthorized"}, 401
    if not job_id or not source_url or not user_id:
        return {"error": "jobId, url, and userId required"}, 400

    process_video.spawn(job_id, source_url, user_id, mode, extension_clips, streamer_name)
    return {"success": True, "jobId": job_id}


@app.function(image=image, secrets=secrets, timeout=120)
@modal.fastapi_endpoint(method="POST")
def extract(body: dict):
    """Extract transcript from URL without downloading full video."""
    url = body.get("url", "")
    auth_token = body.get("authToken", "")
    worker_secret = os.environ.get("WORKER_SECRET", "")

    if worker_secret and auth_token != worker_secret:
        return {"error": "Unauthorized"}, 401
    if not url:
        return {"error": "url required"}, 400

    source = detect_source(url)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # Try subtitles first (fastest)
        sub_cmd = [
            "yt-dlp", url, "--skip-download",
            "--write-auto-subs", "--write-subs",
            "--sub-format", "vtt", "--sub-lang", "en,en-US,en-GB",
            "-o", str(tmp / "subs"), "--quiet",
        ]
        if source == "kick":
            sub_cmd += ["--add-headers", "User-Agent:Mozilla/5.0", "--add-headers", "Referer:https://kick.com/"]

        sub_result = subprocess.run(sub_cmd, capture_output=True, text=True, timeout=60)
        sub_files = list(tmp.glob("*.vtt"))

        if sub_result.returncode == 0 and sub_files:
            vtt_text = sub_files[0].read_text(encoding="utf-8", errors="replace")
            transcript = parse_vtt(vtt_text)
            info = get_video_info(url)
            return {"transcript": transcript, "title": info.get("title",""), "method": "subtitles"}

        # Fall back to audio + Groq Whisper
        audio_result = download_audio(url, tmp, source)
        audio_files = list(tmp.glob("audio_raw.*"))
        if not audio_files:
            return {"error": "Could not extract audio"}, 400

        audio_path = tmp / "audio.mp3"
        convert_to_mp3(audio_files[0], audio_path)
        audio_path = compress_audio_if_needed(audio_path, tmp)

        transcript = transcribe_with_groq(audio_path, os.environ["GROQ_API_KEY"])
        info = get_video_info(url)
        return {"transcript": transcript, "title": info.get("title",""), "method": "groq_whisper"}


def parse_vtt(vtt_text: str) -> str:
    lines = vtt_text.split("\n")
    result, current_time, current_text = [], "", []
    for line in lines:
        line = line.strip()
        if "-->" in line:
            if current_text and current_time:
                clean = re.sub(r'<[^>]+>', '', " ".join(current_text)).strip()
                if clean:
                    result.append(f"[{current_time}] {clean}")
            current_time = line.split("-->")[0].strip()[:8]
            current_text = []
        elif line and not line.startswith("WEBVTT") and not line.isdigit():
            current_text.append(line)
    if current_text and current_time:
        clean = re.sub(r'<[^>]+>', '', " ".join(current_text)).strip()
        if clean:
            result.append(f"[{current_time}] {clean}")
    # Deduplicate
    deduped, prev = [], ""
    for line in result:
        text = line.split("] ", 1)[-1]
        if text != prev:
            deduped.append(line)
            prev = text
    return "\n".join(deduped)


@app.local_entrypoint()
def main():
    print("ClipFinder worker ready. Deploy with: modal deploy worker.py")
