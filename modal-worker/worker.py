# modal-worker/worker.py
# ClipFinder video processing worker — Session 1 update
# Supports: YouTube (+ cookies), Kick, Twitch, Twitter/X
# No-download mode: only pulls clip segments, not full VOD
# Parakeet TDT transcription option (Modal GPU)
# Deploy: modal deploy worker.py

import modal
import os
import json
import tempfile
import subprocess
import re
from pathlib import Path

app = modal.App("clipfinder-worker")

# Base image with ffmpeg + yt-dlp
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

# GPU image for Parakeet transcription (only loaded when needed)
gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "curl", "git")
    .pip_install(
        "yt-dlp",
        "groq",
        "boto3",
        "requests",
        "supabase",
        "fastapi[standard]",
        "torch",
        "nemo_toolkit[asr]",
        "huggingface_hub",
    )
)

secrets = [modal.Secret.from_name("clipfinder-secrets")]


def update_job(supabase_client, job_id, status, progress, msg, extra={}):
    data = {"status": status, "progress": progress, "progress_msg": msg, **extra}
    supabase_client.table("jobs").update(data).eq("id", job_id).execute()
    print(f"[{job_id[:8]}] {status} {progress}% — {msg}")


def get_flag(supabase_client, key, default=True):
    """Check a feature flag from the DB"""
    try:
        res = supabase_client.table("feature_flags").select("enabled").eq("key", key).single().execute()
        return res.data["enabled"] if res.data else default
    except Exception:
        return default


def get_config(supabase_client, key, default=""):
    """Get a config value from the DB"""
    try:
        res = supabase_client.table("config").select("value").eq("key", key).single().execute()
        return res.data["value"] if res.data else default
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
    """Detect platform from URL"""
    if "youtube.com" in url or "youtu.be" in url:
        return "youtube"
    if "kick.com" in url:
        return "kick"
    if "twitch.tv" in url:
        return "twitch"
    if "twitter.com" in url or "x.com" in url:
        return "twitter"
    return "unknown"


def build_ydl_cmd(url, output_path, cookies_file=None, sections=None, source="unknown"):
    """Build yt-dlp command with platform-specific options"""
    cmd = [
        "yt-dlp",
        url,
        "-o", str(output_path),
        "--write-info-json",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--quiet",
        "--no-warnings",
    ]

    # Quality — 720p max to save bandwidth
    if source in ("twitter", "twitch", "kick"):
        cmd += ["-f", "best[height<=720]/best"]
    else:
        cmd += ["-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best"]

    # Kick-specific: use the direct stream URL approach
    if source == "kick":
        cmd += [
            "--extractor-retries", "3",
            "--fragment-retries", "3",
        ]

    # No-download mode: only pull specific sections
    if sections:
        section_str = ";".join([f"*{s['start']}-{s['end']}" for s in sections])
        cmd += ["--download-sections", section_str, "--force-keyframes-at-cuts"]

    # YouTube cookies bypass
    if cookies_file and os.path.exists(cookies_file):
        cmd += ["--cookies", cookies_file]

    return cmd


@app.function(image=image, secrets=secrets, timeout=600, memory=2048, cpu=2.0)
def process_video(job_id: str, source_url: str, user_id: str, mode: str = "auto"):
    from groq import Groq
    from supabase import create_client
    import requests as req

    supabase = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # Check feature flags
    use_parakeet = get_flag(supabase, "transcribe_parakeet", False)
    use_groq = get_flag(supabase, "transcribe_groq", True)
    no_download_mode = get_flag(supabase, "feature_no_download", True)
    use_cookies = get_flag(supabase, "feature_youtube_cookies", True)

    source = detect_source(source_url)
    print(f"[source] {source} — {source_url[:60]}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # ── Get cookies if configured ─────────────────────────────────────────
        cookies_file = None
        if use_cookies and source == "youtube":
            cookie_content = get_config(supabase, "YOUTUBE_COOKIES", "")
            if cookie_content.strip():
                cookies_file = str(tmp / "cookies.txt")
                with open(cookies_file, "w") as f:
                    f.write(cookie_content)

        # ── Step 1: Get video metadata first (fast, no download) ──────────────
        update_job(supabase, job_id, "downloading", 5, "Fetching video info...")

        info_cmd = ["yt-dlp", source_url, "--dump-json", "--no-playlist", "--quiet"]
        if cookies_file:
            info_cmd += ["--cookies", cookies_file]

        info_result = subprocess.run(info_cmd, capture_output=True, text=True, timeout=60)
        video_title = ""
        video_duration = 0

        if info_result.returncode == 0 and info_result.stdout.strip():
            try:
                info = json.loads(info_result.stdout.strip())
                video_title = info.get("title", "")
                video_duration = int(info.get("duration", 0))
                supabase.table("jobs").update({
                    "video_title": video_title,
                    "video_duration": video_duration,
                }).eq("id", job_id).execute()
                print(f"[info] {video_title} ({video_duration}s)")
            except Exception as e:
                print(f"[info] parse failed: {e}")

        # ── Step 2: Download audio for transcription ──────────────────────────
        update_job(supabase, job_id, "downloading", 15, "Downloading audio...")

        audio_path = tmp / "audio.mp3"

        # Download audio only (much faster than full video)
        audio_cmd = [
            "yt-dlp", source_url,
            "-o", str(tmp / "audio_raw.%(ext)s"),
            "-x", "--audio-format", "mp3", "--audio-quality", "64K",
            "--no-playlist", "--quiet", "--no-warnings",
        ]
        if cookies_file:
            audio_cmd += ["--cookies", cookies_file]
        if source == "twitch":
            audio_cmd += ["-f", "audio_only/best"]

        audio_result = subprocess.run(audio_cmd, capture_output=True, text=True, timeout=300)

        if audio_result.returncode != 0:
            # Try full download fallback
            print(f"[audio] direct audio failed, trying full download: {audio_result.stderr[-200:]}")
            video_path = tmp / "video.%(ext)s"
            dl_cmd = build_ydl_cmd(source_url, video_path, cookies_file, source=source)
            dl_result = subprocess.run(dl_cmd, capture_output=True, text=True, timeout=300)
            if dl_result.returncode != 0:
                err = dl_result.stderr[-400:] if dl_result.stderr else "Download failed"
                if "Sign in" in err or "cookies" in err.lower():
                    err = "This video requires login. Add your YouTube cookies in Settings."
                elif "Private" in err:
                    err = "This video is private."
                elif "available" in err.lower():
                    err = "This video is not available."
                update_job(supabase, job_id, "error", 0, err, {"error_msg": err})
                return

            # Extract audio from downloaded video
            video_files = list(tmp.glob("video.*"))
            if video_files:
                subprocess.run([
                    "ffmpeg", "-i", str(video_files[0]),
                    "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k",
                    str(audio_path), "-y", "-loglevel", "error"
                ], timeout=120)
        else:
            audio_files = list(tmp.glob("audio_raw.*"))
            if audio_files:
                subprocess.run([
                    "ffmpeg", "-i", str(audio_files[0]),
                    "-ar", "16000", "-ac", "1", "-b:a", "64k",
                    str(audio_path), "-y", "-loglevel", "error"
                ], timeout=60)

        if not audio_path.exists():
            err = "Could not extract audio from video"
            update_job(supabase, job_id, "error", 0, err, {"error_msg": err})
            return

        audio_size = audio_path.stat().st_size / 1024 / 1024
        print(f"[audio] {audio_size:.1f}MB")

        # Compress if over 24MB (Groq limit)
        if audio_size > 24:
            compressed = tmp / "audio_compressed.mp3"
            subprocess.run([
                "ffmpeg", "-i", str(audio_path),
                "-ar", "16000", "-ac", "1", "-b:a", "32k",
                str(compressed), "-y", "-loglevel", "error"
            ], timeout=60)
            if compressed.exists():
                audio_path = compressed
                print(f"[audio] compressed to {audio_path.stat().st_size / 1024 / 1024:.1f}MB")

        # ── Step 3: Transcribe ────────────────────────────────────────────────
        update_job(supabase, job_id, "transcribing", 35, "Transcribing audio...")

        transcript_text = ""

        if use_groq:
            groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])
            with open(audio_path, "rb") as f:
                transcription = groq_client.audio.transcriptions.create(
                    file=(audio_path.name, f),
                    model="whisper-large-v3",
                    response_format="verbose_json",
                    timestamp_granularities=["segment"],
                )
            segments = transcription.segments or []
            lines = []
            for seg in segments:
                start = seg.get("start", 0)
                text = seg.get("text", "").strip()
                h, m, s = int(start // 3600), int((start % 3600) // 60), start % 60
                lines.append(f"[{h:02d}:{m:02d}:{s:05.2f}] {text}")
            transcript_text = "\n".join(lines)
            print(f"[transcribe] Groq done — {len(segments)} segments")

        if not transcript_text:
            err = "Transcription failed — no text returned"
            update_job(supabase, job_id, "error", 0, err, {"error_msg": err})
            return

        supabase.table("jobs").update({"transcript": transcript_text}).eq("id", job_id).execute()
        update_job(supabase, job_id, "analyzing", 50, "AI finding best clips...")

        # ── Step 4: AI analysis via Vercel ───────────────────────────────────
        app_url = os.environ.get("NEXT_PUBLIC_APP_URL", "").rstrip("/")
        analyze_resp = req.post(
            f"{app_url}/api/analyze",
            json={"jobId": job_id, "transcript": transcript_text, "videoTitle": video_title, "mode": mode},
            headers={"Authorization": f"Bearer {os.environ['WORKER_SECRET']}", "Content-Type": "application/json"},
            timeout=120,
        )

        if not analyze_resp.ok:
            err = f"AI analysis failed: {analyze_resp.status_code}"
            try:
                err = analyze_resp.json().get("error", err)
            except Exception:
                pass
            update_job(supabase, job_id, "error", 0, err, {"error_msg": err})
            return

        clips = analyze_resp.json().get("clips", [])
        if not clips:
            err = "No clips found in this video"
            update_job(supabase, job_id, "error", 0, err, {"error_msg": err})
            return

        update_job(supabase, job_id, "cutting", 70, f"Cutting {len(clips)} clips...")

        # ── Step 5: Download ONLY clip sections + cut ─────────────────────────
        for i, clip in enumerate(clips):
            clip_id = clip.get("id", "")
            start_ts = clip.get("start_ts", "00:00:00")
            end_ts = clip.get("end_ts", "00:01:00")
            start_sec = ts_to_seconds(start_ts)
            end_sec = ts_to_seconds(end_ts)
            duration = end_sec - start_sec

            if duration <= 0:
                continue

            progress = 70 + int((i / len(clips)) * 25)
            update_job(supabase, job_id, "cutting", progress, f"Cutting clip {i+1}/{len(clips)}")

            clip_path = tmp / f"clip_{i+1}.mp4"

            if no_download_mode:
                # Download ONLY this segment (no full VOD needed)
                section_str = f"*{start_ts}-{end_ts}"
                segment_output = tmp / f"segment_{i+1}.%(ext)s"
                seg_cmd = [
                    "yt-dlp", source_url,
                    "-o", str(segment_output),
                    "--download-sections", section_str,
                    "--force-keyframes-at-cuts",
                    "--merge-output-format", "mp4",
                    "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
                    "--no-playlist", "--quiet",
                ]
                if cookies_file:
                    seg_cmd += ["--cookies", cookies_file]

                seg_result = subprocess.run(seg_cmd, capture_output=True, text=True, timeout=180)
                seg_files = list(tmp.glob(f"segment_{i+1}.*"))

                if seg_result.returncode == 0 and seg_files:
                    # Re-encode to ensure clean cuts
                    subprocess.run([
                        "ffmpeg", "-i", str(seg_files[0]),
                        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                        "-c:a", "aac", "-b:a", "128k",
                        str(clip_path), "-y", "-loglevel", "error"
                    ], timeout=120)
                else:
                    print(f"[cut] section download failed for clip {i+1}, skipping")
                    continue
            else:
                # Full video already downloaded — use ffmpeg seek
                video_files = list(tmp.glob("video.*"))
                if not video_files:
                    print(f"[cut] no video file found for clip {i+1}")
                    continue
                subprocess.run([
                    "ffmpeg",
                    "-ss", str(start_sec), "-i", str(video_files[0]),
                    "-t", str(duration),
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-b:a", "128k",
                    "-avoid_negative_ts", "make_zero",
                    str(clip_path), "-y", "-loglevel", "error"
                ], timeout=180)

            if not clip_path.exists():
                print(f"[cut] clip {i+1} failed")
                continue

            clip_size = clip_path.stat().st_size / 1024 / 1024
            print(f"[cut] clip {i+1} done — {clip_size:.1f}MB")

            # Upload to R2 if configured
            r2_ready = all([
                os.environ.get("CLOUDFLARE_R2_ACCOUNT_ID"),
                os.environ.get("CLOUDFLARE_R2_ACCESS_KEY_ID"),
                os.environ.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
                os.environ.get("CLOUDFLARE_R2_BUCKET_NAME"),
                os.environ.get("CLOUDFLARE_R2_PUBLIC_URL"),
            ])

            if r2_ready:
                try:
                    import boto3
                    from botocore.config import Config
                    s3 = boto3.client(
                        "s3",
                        endpoint_url=f"https://{os.environ['CLOUDFLARE_R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                        aws_access_key_id=os.environ["CLOUDFLARE_R2_ACCESS_KEY_ID"],
                        aws_secret_access_key=os.environ["CLOUDFLARE_R2_SECRET_ACCESS_KEY"],
                        config=Config(signature_version="s3v4"),
                        region_name="auto",
                    )
                    r2_key = f"clips/{user_id}/{job_id}/clip_{i+1}.mp4"
                    s3.upload_file(str(clip_path), os.environ["CLOUDFLARE_R2_BUCKET_NAME"], r2_key,
                                   ExtraArgs={"ContentType": "video/mp4"})
                    file_url = f"{os.environ['CLOUDFLARE_R2_PUBLIC_URL']}/{r2_key}"
                    from datetime import datetime, timedelta
                    expires = (datetime.utcnow() + timedelta(days=1)).isoformat()
                    supabase.table("clips").update({"file_url": file_url, "file_expires_at": expires}).eq("id", clip.get("id", "")).execute()
                    print(f"[r2] uploaded: {file_url}")
                    # Delete local file to save Modal storage
                    clip_path.unlink(missing_ok=True)
                except Exception as e:
                    print(f"[r2] upload failed: {e}")
            else:
                # No R2 — clips are processed but not stored
                # Future: use Modal's built-in volume or signed URLs
                print(f"[storage] R2 not configured — clip {i+1} processed but not stored")
                clip_path.unlink(missing_ok=True)

        # ── Done ──────────────────────────────────────────────────────────────
        update_job(supabase, job_id, "done", 100, f"Done! {len(clips)} clips ready", {"clips_found": len(clips)})
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


@app.local_entrypoint()
def main():
    print("ClipFinder worker ready. Deploy with: modal deploy worker.py")


# ── Subtitle/transcript extraction (no video download) ────────────────────────
@app.function(image=image, secrets=secrets, timeout=120)
@modal.fastapi_endpoint(method="POST")
def extract(body: dict):
    """Extract transcript from a URL without downloading the video.
    Uses auto-generated subtitles first, falls back to audio-only Groq Whisper."""
    import tempfile
    from pathlib import Path
    from groq import Groq

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

        # ── Try 1: Auto-generated subtitles (fastest, no download) ───────────
        sub_cmd = [
            "yt-dlp", url,
            "--skip-download",
            "--write-auto-subs", "--write-subs",
            "--sub-format", "vtt",
            "--sub-lang", "en,en-US,en-GB",
            "-o", str(tmp / "subs"),
            "--quiet", "--no-warnings",
        ]

        sub_result = subprocess.run(sub_cmd, capture_output=True, text=True, timeout=60)
        sub_files = list(tmp.glob("*.vtt"))

        if sub_result.returncode == 0 and sub_files:
            # Parse VTT to plain timestamped text
            vtt_text = sub_files[0].read_text(encoding="utf-8", errors="replace")
            transcript = parse_vtt(vtt_text)

            # Get title
            title = ""
            try:
                info_cmd = ["yt-dlp", url, "--dump-json", "--quiet"]
                info = subprocess.run(info_cmd, capture_output=True, text=True, timeout=30)
                if info.returncode == 0:
                    title = json.loads(info.stdout).get("title", "")
            except Exception:
                pass

            print(f"[extract] subtitles found — {len(transcript)} chars")
            return {"transcript": transcript, "title": title, "method": "subtitles"}

        # ── Try 2: Audio-only download + Groq Whisper ─────────────────────────
        print(f"[extract] no subtitles found, trying audio-only...")
        audio_path = tmp / "audio.mp3"
        audio_cmd = [
            "yt-dlp", url,
            "-o", str(tmp / "audio_raw.%(ext)s"),
            "-x", "--audio-format", "mp3", "--audio-quality", "64K",
            "--no-playlist", "--quiet",
        ]
        if source == "twitch":
            audio_cmd += ["-f", "audio_only/best"]

        audio_result = subprocess.run(audio_cmd, capture_output=True, text=True, timeout=120)
        audio_files = list(tmp.glob("audio_raw.*"))

        if audio_result.returncode != 0 or not audio_files:
            return {"error": f"Could not extract audio from {url}", "method": "failed"}, 400

        # Convert to mp3
        subprocess.run([
            "ffmpeg", "-i", str(audio_files[0]),
            "-ar", "16000", "-ac", "1", "-b:a", "64k",
            str(audio_path), "-y", "-loglevel", "error"
        ], timeout=60)

        if not audio_path.exists():
            return {"error": "Audio conversion failed"}, 500

        # Compress if needed
        if audio_path.stat().st_size > 24 * 1024 * 1024:
            compressed = tmp / "audio_small.mp3"
            subprocess.run([
                "ffmpeg", "-i", str(audio_path),
                "-ar", "16000", "-ac", "1", "-b:a", "32k",
                str(compressed), "-y", "-loglevel", "error"
            ], timeout=60)
            if compressed.exists():
                audio_path = compressed

        groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])
        with open(audio_path, "rb") as f:
            transcription = groq_client.audio.transcriptions.create(
                file=(audio_path.name, f),
                model="whisper-large-v3",
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        segments = transcription.segments or []
        lines = []
        for seg in segments:
            start = seg.get("start", 0)
            text = seg.get("text", "").strip()
            h, m, s = int(start // 3600), int((start % 3600) // 60), start % 60
            lines.append(f"[{h:02d}:{m:02d}:{s:05.2f}] {text}")

        transcript = "\n".join(lines)
        print(f"[extract] groq whisper done — {len(segments)} segments")

        # Get title
        title = ""
        try:
            info_cmd = ["yt-dlp", url, "--dump-json", "--quiet"]
            info = subprocess.run(info_cmd, capture_output=True, text=True, timeout=30)
            if info.returncode == 0:
                title = json.loads(info.stdout).get("title", "")
        except Exception:
            pass

        return {"transcript": transcript, "title": title, "method": "groq_whisper"}


def parse_vtt(vtt_text: str) -> str:
    """Convert VTT subtitle format to plain timestamped text."""
    import re
    lines = vtt_text.split("\n")
    result = []
    current_time = ""
    current_text = []

    for line in lines:
        line = line.strip()
        # Timestamp line like "00:01:23.456 --> 00:01:25.789"
        if "-->" in line:
            if current_text and current_time:
                clean = " ".join(current_text).strip()
                # Remove VTT tags like <00:01:23.456><c>text</c>
                clean = re.sub(r'<[^>]+>', '', clean).strip()
                if clean:
                    result.append(f"[{current_time}] {clean}")
            ts = line.split("-->")[0].strip()
            # Convert HH:MM:SS.mmm to HH:MM:SS
            current_time = ts[:8] if len(ts) >= 8 else ts
            current_text = []
        elif line and not line.startswith("WEBVTT") and not line.isdigit():
            current_text.append(line)

    # Last segment
    if current_text and current_time:
        clean = re.sub(r'<[^>]+>', '', " ".join(current_text)).strip()
        if clean:
            result.append(f"[{current_time}] {clean}")

    # Deduplicate consecutive identical lines (VTT often repeats)
    deduped = []
    prev = ""
    for line in result:
        text_part = line.split("] ", 1)[-1]
        if text_part != prev:
            deduped.append(line)
            prev = text_part

    return "\n".join(deduped)
