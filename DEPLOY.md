# NightWatch Deployment Guide

This document describes how to deploy NightWatch to **Fly.io** (recommended single-container host) or any **Docker-capable VPS / Linux host** (e.g. Ubuntu, Debian, Hetzner, AWS EC2, DigitalOcean).

---

## 1. Fly.io Deployment

Fly.io provides single-machine container hosting with persistent NVMe volumes and automatic HTTPS.

### Prerequisites
- [Fly CLI (`flyctl`) installed](https://fly.io/docs/hands-on/install-flyctl/)
- Fly.io account logged in (`fly auth login`)

### Step 1: Create the App and Persistent Volume
```bash
# Register app name matching fly.toml
fly apps create nightwatch-guard

# Create persistent 1GB volume for SQLite database in your primary region (e.g. iad)
fly volumes create nightwatch_data --size 1 --region iad --app nightwatch-guard
```

### Step 2: Set Secrets
Set all production secrets using the actual environment variable names from `.env.example`:

```bash
fly secrets set \
  NIGHTWATCH_PROVIDER="gemini" \
  GEMINI_API_KEY="AIzaSy..." \
  GITHUB_TOKEN="ghp_..." \
  ETHERSCAN_API_KEY="..." \
  BASE_RPC_URL="https://mainnet.base.org" \
  BASE_SEPOLIA_RPC_URL="https://sepolia.base.org" \
  NIGHTWATCH_TREASURY="0x29fF710a3244f09d25A64889e2a3C0984B01eD55" \
  NIGHTWATCH_PRICE_PRIORITY_USDC="1" \
  NIGHTWATCH_PRICE_DEEP_USDC="5" \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  CRON_SECRET="$(openssl rand -hex 16)" \
  --app nightwatch-guard
```

> **Note on AI Providers:**
> If using Anthropic, set `NIGHTWATCH_PROVIDER="anthropic"` and `ANTHROPIC_API_KEY="sk-ant-..."`.
> If using Qwen (DashScope), set `NIGHTWATCH_PROVIDER="qwen"` and `DASHSCOPE_API_KEY="sk-..."`.

### Step 3: Deploy
Pass the EAS Schema UID build arg during image build:
```bash
fly deploy \
  --build-arg NEXT_PUBLIC_EAS_SCHEMA_UID="0x0c57cb369bf451ea40118e367beb29e6f23c8e0913b29058287337a86237e5c3" \
  --app nightwatch-guard
```

### Step 4: Verify Deployment
```bash
# Check machine status
fly status --app nightwatch-guard

# Run health check against live Fly app
curl -s https://nightwatch-guard.fly.dev/api/health
```

---

## 2. Docker on VPS Deployment

Deploying with Docker on any Linux host with persistent data stored in a Docker named volume.

### Step 1: Clone and Create Production Environment File
On the VPS:
```bash
git clone https://github.com/your-org/nightwatch.git
cd nightwatch

cat <<'EOF' > .env.production
PORT=3000
NODE_ENV=production
NIGHTWATCH_WORKER=1
NIGHTWATCH_DB_PATH=/data/nightwatch.db
NODE_OPTIONS=--dns-result-order=ipv4first

# AI Provider
NIGHTWATCH_PROVIDER=gemini
GEMINI_API_KEY=AIzaSy...

# Optional: GitHub token for increased rate limits (5,000/hr)
GITHUB_TOKEN=ghp_...

# Base Sepolia / Base RPC & Pricing
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
NIGHTWATCH_TREASURY=0x29fF710a3244f09d25A64889e2a3C0984B01eD55
NIGHTWATCH_PRICE_PRIORITY_USDC=1
NIGHTWATCH_PRICE_DEEP_USDC=5
NIGHTWATCH_CONCURRENCY=2

# Security & Session
SESSION_SECRET=change_me_to_at_least_32_random_bytes_hex
CRON_SECRET=change_me_to_random_secret
EOF
```

### Step 2: Build Docker Image
Pass `NEXT_PUBLIC_EAS_SCHEMA_UID` as build argument:
```bash
docker build \
  --build-arg NEXT_PUBLIC_EAS_SCHEMA_UID="0x0c57cb369bf451ea40118e367beb29e6f23c8e0913b29058287337a86237e5c3" \
  -t nightwatch:latest .
```

### Step 3: Run Container with Persistent Volume
```bash
# Create persistent volume
docker volume create nw_data

# Run container attached to persistent volume
docker run -d \
  --name nightwatch \
  --restart unless-stopped \
  -p 3000:3000 \
  -v nw_data:/data \
  --env-file .env.production \
  nightwatch:latest
```

### Step 4: Reverse Proxy with Caddy or Nginx
Example Caddyfile for automatic SSL:
```caddy
audit.yourdomain.com {
    reverse_proxy localhost:3000
}
```

---

## 3. Render Free Web Service + UptimeRobot Deployment

Render offers a free web service tier running Docker containers. Because the free tier does not include persistent disk volumes and spins down after 15 minutes of inactivity, follow these steps:

### Step 1: Create Render Web Service
1. In your [Render Dashboard](https://dashboard.render.com/), click **New + -> Web Service**.
2. Connect your repository (or public Git repo).
3. Select **Docker** as the environment.
4. **Plan:** Choose **Free**.

### Step 2: Environment Variables
Render automatically injects the `PORT` variable (default 10000). The Dockerfile listens dynamically on `0.0.0.0` and `PORT`. Set the following in Render's **Environment** tab:

| Variable | Value / Description |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `NIGHTWATCH_WORKER` | `1` |
| `NIGHTWATCH_DB_PATH` | `/app/data/nightwatch.db` (or leave unset to use container storage) |
| `NIGHTWATCH_PROVIDER` | `gemini` (or `anthropic` / `qwen`) |
| `GEMINI_API_KEY` | Your AI key |
| `BASE_RPC_URL` | `https://mainnet.base.org` |
| `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` |
| `NIGHTWATCH_TREASURY` | `0x29fF710a3244f09d25A64889e2a3C0984B01eD55` |
| `SESSION_SECRET` | 32+ character random hex string |
| `CRON_SECRET` | Random hex string |
| `NIGHTWATCH_PUBLIC_URL` | Optional public domain override (e.g. `https://night-watch-3f97.onrender.com`) to ensure GitHub OAuth callbacks and redirects always use the public HTTPS URL instead of internal bind addresses (`0.0.0.0:10000`). |

> **Reverse Proxy & Public Origin:** NightWatch resolves the canonical public origin in this order:
> 1. `NIGHTWATCH_PUBLIC_URL` env var if set (trailing slash stripped)
> 2. `x-forwarded-proto` + `x-forwarded-host` headers (first comma-separated value)
> 3. `Host` header (with `https` unless localhost/127.0.0.1)
> 4. Request URL (never returns `0.0.0.0` or internal container ports)

> **Note on Persistent Volumes:** Render Free does not offer mounted persistent disks. NightWatch automatically falls back to container `/app/data/nightwatch.db` or `/tmp/nightwatch.db`, which persists across requests during the container's lifecycle.

### Step 3: Prevent Free-Tier Sleep with UptimeRobot
Render free instances spin down after 15 minutes without incoming HTTP traffic. To keep NightWatch awake and prevent watch worker restarts:
1. Create a free account at [UptimeRobot.com](https://uptimerobot.com/).
2. Click **Add New Monitor**:
   - **Monitor Type:** `HTTP(s)`
   - **Friendly Name:** `NightWatch Health`
   - **URL (or IP):** `https://your-app-name.onrender.com/api/health`
   - **Monitoring Interval:** `5 minutes`
3. Save the monitor. UptimeRobot will ping `/api/health` every 5 minutes, preventing Render from suspending the container.

---

## 4. Post-Deploy Checklist

Verify that all subsystems operate correctly against the live URL:

- [ ] **Health Endpoint:** `GET /api/health` returns HTTP 200 with `{"ok":true,"worker":true,"db":"ok","ai":true,"payments":true}`
- [ ] **Payment Config:** `GET /api/pay/config` returns `chainId: 84532`, USDC address `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, and configured tiers.
- [ ] **Volume Persistence:** Restart the container (`docker restart nightwatch` or `fly apps restart`) and confirm reports remain saved in `/data/nightwatch.db`.
- [ ] **Run Smoke Test:**
  ```bash
  npx tsx scripts/smoke-prod.ts https://nightwatch-guard.fly.dev
  ```
- [ ] **Sandbox Audit Test:** Audit `sample:rekkt-vault` in browser UI; verify findings and exploit badges render.
- [ ] **Base Sepolia Contract Test:** Audit a verified contract (e.g. `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on Base mainnet or testnet demo vault).
- [ ] **Night Shift Worker:** Inspect server logs for `[worker]` tick messages confirming the in-process watcher is running.
