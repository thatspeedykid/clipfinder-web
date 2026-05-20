# ClipFinder Web

AI-powered viral clip extractor for YouTube and Kick streams.
Open source (AGPL-3.0) · Hosted at clipfinder.app

---

## Stack

| Layer | Service | Cost |
|---|---|---|
| Frontend + API | Vercel (Next.js) | Free |
| Database + Auth | Supabase | Free up to 500MB |
| Transcription | Groq Whisper API | Free tier |
| AI Analysis | Gemini 2.5 Flash + Groq LLaMA | Free tier |
| Video worker | Modal.com (yt-dlp + FFmpeg) | $30 free credits |
| File storage | Cloudflare R2 | Free 10GB |
| Job queue | Upstash Redis | Free 10k/day |
| Billing | LemonSqueezy | 0% until first sale |

---

## Setup — Step by Step

### 1. Clone and install

```bash
git clone https://github.com/thatspeedykid/clipfinder-web
cd clipfinder-web
npm install
```

### 2. Set up Supabase

1. Go to [supabase.com](https://supabase.com) → New project
2. Project name: `clipfinder` · Password: save it somewhere
3. Wait for it to spin up (~2 min)
4. Go to **SQL Editor** → paste the entire contents of `supabase-schema.sql` → Run
5. Go to **Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`
6. Go to **Authentication → Providers** → enable **Google**
   - You'll need Google OAuth credentials from [console.cloud.google.com](https://console.cloud.google.com)
   - Create a project → Credentials → OAuth 2.0 Client → Web application
   - Authorized redirect: `https://your-project.supabase.co/auth/v1/callback`

### 3. Get free API keys

**Groq** (transcription + LLM):
1. Go to [console.groq.com](https://console.groq.com) → Sign up free
2. API Keys → Create new key → copy to `GROQ_API_KEY`

**Gemini** (AI analysis):
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create API key → copy to `GEMINI_API_KEY`

**Upstash Redis** (rate limiting):
1. Go to [console.upstash.com](https://console.upstash.com) → Create Database
2. Region: `us-east-1` · Type: Regional
3. REST API tab → copy URL and token

**Cloudflare R2** (file storage):
1. [dash.cloudflare.com](https://dash.cloudflare.com) → R2 → Create bucket: `clipfinder-clips`
2. Manage API tokens → Create token with R2 edit permissions
3. Enable public access on the bucket for download URLs

### 4. Set up Modal.com worker (video download + cutting)

1. Sign up at [modal.com](https://modal.com) — you get $30 free credits
2. Install modal: `pip install modal`
3. Authenticate: `modal setup`
4. Deploy the worker: `cd modal-worker && modal deploy worker.py`
5. Copy the deployed URL → `MODAL_WORKER_URL`

The Modal worker is in `/modal-worker/worker.py` — deploy it separately.

### 5. Set up LemonSqueezy (billing)

1. Sign up at [lemonsqueezy.com](https://lemonsqueezy.com)
2. Create a store
3. Create two products: **ClipFinder Pro** ($12/mo) and **ClipFinder Agency** ($39/mo)
   - Set them as subscriptions
4. Settings → API → copy your API key
5. Webhooks → Add webhook:
   - URL: `https://your-vercel-app.vercel.app/api/webhook`
   - Events: `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_expired`
   - Copy the signing secret → `LEMONSQUEEZY_WEBHOOK_SECRET`
6. Copy the **Variant IDs** from each product → `LEMONSQUEEZY_PRO_VARIANT_ID`, `LEMONSQUEEZY_AGENCY_VARIANT_ID`

### 6. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Follow prompts:
# - Link to your GitHub repo
# - Framework: Next.js (auto-detected)
# - Add env vars when asked, or add them in the Vercel dashboard
```

After deploy:
1. Go to Vercel dashboard → your project → Settings → Environment Variables
2. Add every variable from `.env.example`
3. Go to **Domains** — add your custom domain (e.g. clipfinder.app)
4. Redeploy: `vercel --prod`

### 7. Final checks

- [ ] Visit `yourapp.vercel.app` — landing page loads
- [ ] Click "Get started free" — login page works
- [ ] Sign in with Google — redirects to dashboard
- [ ] Paste a YouTube URL — job starts
- [ ] Supabase → Table Editor → jobs — confirm row was created
- [ ] LemonSqueezy webhook URL shows up as active

---

## Development

```bash
cp .env.example .env.local
# Fill in your keys
npm run dev
# Open http://localhost:3000
```

---

## Architecture

```
Browser → Vercel (Next.js)
             ├── /api/analyze   → Gemini + Groq in parallel
             ├── /api/jobs/[id] → Status polling
             ├── /api/webhook   → LemonSqueezy subscription events
             └── /api/user      → Profile + quota

         → Modal.com worker (separate deploy)
             ├── yt-dlp download
             ├── Groq Whisper transcription
             ├── FFmpeg clip cutting
             └── Upload to Cloudflare R2
```

---

## License

AGPL-3.0 — use freely, open source your changes if you host publicly.
