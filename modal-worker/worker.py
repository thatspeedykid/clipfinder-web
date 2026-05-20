# modal-worker/worker.py
# ClipFinder video processing worker
# Runs on Modal.com — handles yt-dlp download, Groq Whisper transcription,
# FFmpeg clip cutting, and Cloudflare R2 upload
#
# Deploy: modal deploy worker.py
# Test:   modal run worker.py

import modal
import os
import json
import tempfile
import subprocess
from pathlib import Path

# ── Modal app setup ───────────────────────────────────────────────────────────
app = modal.App("clipfinder-worker")

# Docker image with everything we need
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

# ── Secrets (set these in Modal dashboard → Secrets) ─────────────────────────
# Go to modal.com → your workspace → Secrets → Create secret
# Name it "clipfinder-secrets" and add all these keys
secrets = [modal.Secret.from_name("clipfinder-secrets")]


# ── Helper: update job status in Supabase ────────────────────────────────────
def update_job(supabase_client, job_id: str, status: str, progress: int, msg: str, extra: dict = {}):
    data = {"status": status, "progress": progress, "progress_msg": msg, **extra}
    supabase_client.table("jobs").update(data).eq("id", job_id).execute()
    print(f"[job {job_id[:8]}] {status} {progress}% — {msg}")


# ── Helper: upload file to Cloudflare R2 ─────────────────────────────────────
def upload_to_r2(local_path: str, key: str) -> str:
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

    bucket = os.environ["CLOUDFLARE_R2_BUCKET_NAME"]
    s3.upload_file(local_path, bucket, key, ExtraArgs={"ContentType": "video/mp4"})

    public_url = os.environ["CLOUDFLARE_R2_PUBLIC_URL"]
    return f"{public_url}/{key}"


# ── Helper: convert HH:MM:SS to seconds ──────────────────────────────────────
def ts_to_seconds(ts: str) -> float:
    parts = ts.strip().split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    return float(parts[0])


# ── Main processing function ──────────────────────────────────────────────────
@app.function(
    image=image,
    secrets=secrets,
    timeout=600,        # 10 min max per job
    memory=2048,        # 2GB RAM
    cpu=2.0,
)
def process_video(job_id: str, source_url: str, user_id: str, mode: str = "auto"):
    from groq import Groq
    from supabase import create_client

    # Init clients
    supabase = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # ── Step 1: Download video ────────────────────────────────────────────
        update_job(supabase, job_id, "downloading", 10, "Downloading video...")

        video_path = tmp / "video.mp4"
        info_path = tmp / "info.json"

        ydl_cmd = [
            "yt-dlp",
            source_url,
            "-o", str(video_path),
            "--write-info-json", "--print-json",
            "--merge-output-format", "mp4",
            "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
            "--no-playlist",
            "--quiet",
        ]

        result = subprocess.run(ydl_cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            error = result.stderr[-500:] if result.stderr else "Download failed"
            # Check for common errors
            if "Sign in" in error or "cookies" in error.lower():
                error = "This video requires login. Try a different video."
            elif "Private" in error:
                error = "This video is private."
            elif "available" in error.lower():
                error = "This video is not available."
            update_job(supabase, job_id, "error", 0, error, {"error_msg": error})
            return

        if not video_path.exists():
            # yt-dlp sometimes changes the extension
            candidates = list(tmp.glob("video.*"))
            if candidates:
                video_path = candidates[0]
            else:
                err = "Video file not found after download"
                update_job(supabase, job_id, "error", 0, err, {"error_msg": err})
                return

        # Get video title from yt-dlp output
        video_title = ""
        try:
            info_files = list(tmp.glob("*.info.json"))
            if info_files:
                info = json.loads(info_files[0].read_text())
                video_title = info.get("title", "")
                duration = int(info.get("duration", 0))
                supabase.table("jobs").update({
                    "video_title": video_title,
                    "video_duration": duration,
                }).eq("id", job_id).execute()
        except Exception as e:
            print(f"[info] could not parse info.json: {e}")

        print(f"[download] done — {video_path.stat().st_size / 1024 / 1024:.1f}MB")
        update_job(supabase, job_id, "transcribing", 25, "Transcribing audio...")

        # ── Step 2: Transcribe with Groq Whisper ──────────────────────────────
        # Extract audio first (Groq has 25MB limit)
        audio_path = tmp / "audio.mp3"
        subprocess.run([
            "ffmpeg", "-i", str(video_path),
            "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k",
            str(audio_path), "-y", "-loglevel", "error"
        ], timeout=120, check=True)

        audio_size = audio_path.stat().st_size / 1024 / 1024
        print(f"[audio] extracted — {audio_size:.1f}MB")

        # If audio > 24MB, compress more aggressively
        if audio_size > 24:
            audio_path2 = tmp / "audio_compressed.mp3"
            subprocess.run([
                "ffmpeg", "-i", str(audio_path),
                "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k",
                str(audio_path2), "-y", "-loglevel", "error"
            ], timeout=120, check=True)
            audio_path = audio_path2
            print(f"[audio] compressed to {audio_path.stat().st_size / 1024 / 1024:.1f}MB")

        # Transcribe
        with open(audio_path, "rb") as f:
            transcription = groq_client.audio.transcriptions.create(
                file=(audio_path.name, f),
                model="whisper-large-v3",
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        # Format transcript with timestamps
        segments = transcription.segments or []
        transcript_lines = []
        for seg in segments:
            start = seg.get("start", 0)
            end = seg.get("end", 0)
            text = seg.get("text", "").strip()
            h, m, s = int(start // 3600), int((start % 3600) // 60), start % 60
            transcript_lines.append(f"[{h:02d}:{m:02d}:{s:05.2f}] {text}")

        transcript_text = "\n".join(transcript_lines)
        print(f"[transcribe] done — {len(segments)} segments")

        # Save transcript to job
        supabase.table("jobs").update({"transcript": transcript_text}).eq("id", job_id).execute()
        update_job(supabase, job_id, "analyzing", 45, "AI finding best clips...")

        # ── Step 3: Call Vercel AI analysis endpoint ──────────────────────────
        import requests as req

        app_url = os.environ.get("NEXT_PUBLIC_APP_URL", "").rstrip("/")
        analyze_url = f"{app_url}/api/analyze"

        # Get a service token for the API call
        analyze_resp = req.post(analyze_url, json={
            "jobId": job_id,
            "transcript": transcript_text,
            "videoTitle": video_title,
            "mode": mode,
        }, headers={
            "Authorization": f"Bearer {os.environ['WORKER_SECRET']}",
            "Content-Type": "application/json",
        }, timeout=120)

        if not analyze_resp.ok:
            err = f"AI analysis failed: {analyze_resp.status_code}"
            try:
                err = analyze_resp.json().get("error", err)
            except Exception:
                pass
            update_job(supabase, job_id, "error", 0, err, {"error_msg": err})
            return

        analyze_data = analyze_resp.json()
        clips = analyze_data.get("clips", [])
        print(f"[analyze] got {len(clips)} clips")

        if not clips:
            err = "No clips found in this video"
            update_job(supabase, job_id, "error", 0, err, {"error_msg": err})
            return

        update_job(supabase, job_id, "cutting", 70, f"Cutting {len(clips)} clips...")

        # ── Step 4: Cut clips with FFmpeg + upload to R2 ──────────────────────
        r2_available = all([
            os.environ.get("CLOUDFLARE_R2_ACCOUNT_ID"),
            os.environ.get("CLOUDFLARE_R2_ACCESS_KEY_ID"),
            os.environ.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
            os.environ.get("CLOUDFLARE_R2_BUCKET_NAME"),
            os.environ.get("CLOUDFLARE_R2_PUBLIC_URL"),
        ])

        for i, clip in enumerate(clips):
            clip_id = clip.get("id", f"clip_{i}")
            start_ts = clip.get("start_ts", "00:00:00")
            end_ts = clip.get("end_ts", "00:01:00")

            progress = 70 + int((i / len(clips)) * 25)
            update_job(supabase, job_id, "cutting", progress, f"Cutting clip {i+1}/{len(clips)}: {clip.get('title', '')[:40]}")

            start_sec = ts_to_seconds(start_ts)
            end_sec = ts_to_seconds(end_ts)
            duration = end_sec - start_sec

            if duration <= 0:
                print(f"[cut] skipping clip {i+1} — invalid duration {duration}s")
                continue

            clip_path = tmp / f"clip_{i+1}.mp4"

            # Cut with FFmpeg — fast seek + re-encode for clean cuts
            ffmpeg_cmd = [
                "ffmpeg",
                "-ss", str(start_sec),
                "-i", str(video_path),
                "-t", str(duration),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-avoid_negative_ts", "make_zero",
                str(clip_path), "-y", "-loglevel", "error"
            ]

            cut_result = subprocess.run(ffmpeg_cmd, timeout=180, capture_output=True, text=True)

            if cut_result.returncode != 0 or not clip_path.exists():
                print(f"[cut] clip {i+1} failed: {cut_result.stderr[-200:]}")
                continue

            clip_size = clip_path.stat().st_size / 1024 / 1024
            print(f"[cut] clip {i+1} done — {clip_size:.1f}MB")

            # Upload to R2 if configured
            file_url = None
            if r2_available:
                try:
                    r2_key = f"clips/{user_id}/{job_id}/clip_{i+1}.mp4"
                    file_url = upload_to_r2(str(clip_path), r2_key)
                    print(f"[r2] uploaded: {file_url}")
                except Exception as e:
                    print(f"[r2] upload failed: {e}")

            # Update clip record with file URL
            if file_url:
                from datetime import datetime, timedelta
                expires = (datetime.utcnow() + timedelta(days=30)).isoformat()
                supabase.table("clips").update({
                    "file_url": file_url,
                    "file_expires_at": expires,
                }).eq("id", clip_id).execute()

        # ── Step 5: Done! ─────────────────────────────────────────────────────
        update_job(supabase, job_id, "done", 100, f"Done! {len(clips)} clips ready", {
            "clips_found": len(clips),
        })
        print(f"[done] job {job_id[:8]} complete — {len(clips)} clips")


# ── Web endpoint — called by Vercel dashboard ─────────────────────────────────
@app.function(
    image=image,
    secrets=secrets,
    timeout=30,
)
@modal.fastapi_endpoint(method="POST")
def start(body: dict):
    import requests as req

    job_id = body.get("jobId")
    source_url = body.get("url")
    user_id = body.get("userId")
    mode = body.get("mode", "auto")
    auth_token = body.get("authToken", "")

    # Validate worker secret
    worker_secret = os.environ.get("WORKER_SECRET", "")
    if worker_secret and auth_token != worker_secret:
        return {"error": "Unauthorized"}, 401

    if not job_id or not source_url or not user_id:
        return {"error": "jobId, url, and userId required"}, 400

    # Create job in Supabase
    from supabase import create_client
    supabase = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # Fire and forget — don't wait for completion
    process_video.spawn(job_id, source_url, user_id, mode)

    return {"success": True, "jobId": job_id, "message": "Processing started"}


# ── Local test ────────────────────────────────────────────────────────────────
@app.local_entrypoint()
def main():
    print("ClipFinder worker ready. Deploy with: modal deploy worker.py")
