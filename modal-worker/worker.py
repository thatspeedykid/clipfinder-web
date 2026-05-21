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
    yt-dlp's Kick extractor is broken since Feb 2026 due to API changes.
    """
    import requests as req

    # Extract clip slug from URL
    # URL formats: kick.com/clips/SLUG or kick.com/channel/clips/SLUG
    slug = clip_slug.split('/')[-1]
    if '?' in slug:
        slug = slug.split('?')[0]

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://kick.com/',
        'Origin': 'https://kick.com',
    }

    # Try Kick's public API
    api_url = f'https://kick.com/api/v2/clips/{slug}'
    try:
        r = req.get(api_url, headers=headers, timeout=15)
        if r.ok:
            data = r.json()
            clip_url = data.get('clip_url') or data.get('video_url') or data.get('playback_url')
            title = data.get('title', '')
            duration = data.get('duration', 0)
            if clip_url:
                print(f"[kick] Got clip URL directly from API: {clip_url[:60]}")
                return clip_url, title, duration
    except Exception as e:
        print(f"[kick] API v2 failed: {e}")

    # Try alternate API endpoint
    try:
        api_url2 = f'https://kick.com/api/v1/clips/{slug}'
        r2 = req.get(api_url2, headers=headers, timeout=15)
        if r2.ok:
            data2 = r2.json()
            clip_url = data2.get('clip_url') or data2.get('video_url')
            title = data2.get('title', '')
            if clip_url:
                print(f"[kick] Got clip URL from API v1: {clip_url[:60]}")
                return clip_url, title, 0
    except Exception as e:
        print(f"[kick] API v1 failed: {e}")

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
        cmd += [
            "--add-headers", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "--add-headers", "Referer:https://kick.com/",
            "--add-headers", "Origin:https://kick.com",
            "--extractor-retries", "5",
            "--fragment-retries", "5",
        ]
    elif source == "youtube":
        cmd += [
            "--extractor-args", "youtube:player_client=android,web",
            "--no-check-certificates",
        ]
        proxy = get_proxy()
        if proxy:
            cmd += ["--proxy", proxy]
            print("[proxy] routing YouTube through residential proxy")
        # Try WITHOUT cookies first — cookies are tied to browser IP
        # and get rejected when coming from proxy IP
        result = run_yt_dlp(cmd, timeout=120)
        if result.returncode == 0:
            return result
        # If failed and we have cookies, try WITH cookies as fallback
        print("[youtube] no-cookie attempt failed, trying with cookies...")
        if cookies_file:
            cmd += ["--cookies", cookies_file]
        return run_yt_dlp(cmd, timeout=120)
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


def cut_clip_section(url, start_ts, end_ts, output_path, cookies_file=None, source="unknown"):
    """Download only the specific clip section (no-download mode)."""
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


@app.function(image=image, secrets=secrets, timeout=600, memory=2048, cpu=2.0)
def process_video(job_id: str, source_url: str, user_id: str, mode: str = "auto"):
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
        if use_cookies_flag:
            cookie_content = get_user_cookies(sb, user_id)
            if not cookie_content.strip():
                cookie_content = get_config(sb, "YOUTUBE_COOKIES", "")
            cookies_file = write_cookies_file(tmp, cookie_content)
            if cookies_file:
                print(f"[cookies] loaded ({len(cookie_content)} chars)")

        # ── Step 1: Get video info ────────────────────────────────────────────
        update_job(sb, job_id, "downloading", 5, "Fetching video info...")
        info = get_video_info(source_url, cookies_file, source)
        video_title = info.get("title", "")
        video_duration = int(info.get("duration", 0))
        if video_title:
            sb.table("jobs").update({"video_title": video_title, "video_duration": video_duration}).eq("id", job_id).execute()
            print(f"[info] {video_title} ({video_duration}s)")

        # ── Step 2: Download audio ─────────────────────────────────────────────
        update_job(sb, job_id, "downloading", 15, "Downloading audio...")
        audio_result = download_audio(source_url, tmp, source, cookies_file)
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

        # ── Step 3: Transcribe ─────────────────────────────────────────────────
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

        # ── Step 4: AI analysis ────────────────────────────────────────────────
        app_url = os.environ.get("NEXT_PUBLIC_APP_URL", "").rstrip("/")
        analyze_resp = req.post(
            f"{app_url}/api/analyze",
            json={"jobId": job_id, "transcript": transcript_text, "videoTitle": video_title, "mode": mode, "userId": user_id},
            headers={"Authorization": f"Bearer {os.environ['WORKER_SECRET']}", "Content-Type": "application/json"},
            timeout=120,
        )

        if not analyze_resp.ok:
            err = f"AI analysis failed: {analyze_resp.status_code}"
            try:
                err = analyze_resp.json().get("error", err)
            except Exception:
                pass
            update_job(sb, job_id, "error", 0, err, {"error_msg": err})
            return

        clips = analyze_resp.json().get("clips", [])
        if not clips:
            err = "No clips found in this video"
            update_job(sb, job_id, "error", 0, err, {"error_msg": err})
            return

        update_job(sb, job_id, "cutting", 70, f"Cutting {len(clips)} clips...")

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
                result = cut_clip_section(source_url, start_ts, end_ts, clip_path, cookies_file, source)
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
                    expires = datetime.utcnow() + timedelta(hours=24)
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

                # Update clip record
                clip_id = clip.get("id", "")
                if clip_id:
                    sb.table("clips").update({
                        "file_url": file_url,
                        "file_expires_at": expires.isoformat(),
                        "file_size_mb": round(clip_size_mb, 2),
                        "storage_path": storage_path,
                    }).eq("id", clip_id).execute()

                print(f"[storage] uploaded clip {i+1} — expires {expires.strftime('%Y-%m-%d %H:%M')} UTC")
                clip_path.unlink(missing_ok=True)

            except Exception as e:
                print(f"[storage] upload failed for clip {i+1}: {e}")
                # Still delete local file even if upload fails
                clip_path.unlink(missing_ok=True)

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

    worker_secret = os.environ.get("WORKER_SECRET", "")
    if worker_secret and auth_token != worker_secret:
        return {"error": "Unauthorized"}, 401
    if not job_id or not source_url or not user_id:
        return {"error": "jobId, url, and userId required"}, 400

    process_video.spawn(job_id, source_url, user_id, mode)
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
