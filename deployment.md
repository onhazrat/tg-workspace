# TG Summarizer — Deployment

Deploy the stack with Docker Compose on a remote server behind a shared Traefik reverse proxy (HTTPS + Let's Encrypt).

## Preparation

* Remote server with [Docker Engine](https://docs.docker.com/engine/install/) installed.
* Domain DNS hosted on **Cloudflare** (required for automatic certificate issuance).
* DNS A records for your domain (and subdomains, or a wildcard) pointing to the server — e.g. `api.`, `dashboard.`, `adminer.`, `traefik.` under `${DOMAIN}`. Orange-cloud (proxied) records are supported with the DNS-01 challenge.
* A Cloudflare **API token** with **Zone → DNS → Edit** and **Zone → Zone → Read** for the target zone.
* [GitHub Actions self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners) (optional, for CD).

## Public Traefik (one-time)

### Copy Traefik compose

```bash
mkdir -p /root/code/traefik-public/
rsync -a compose.traefik.yml root@your-server.example.com:/root/code/traefik-public/
```

### Create shared network

```bash
docker network create traefik-public
```

### Traefik environment

On the server:

```bash
export USERNAME=admin
export PASSWORD=changethis
export HASHED_PASSWORD=$(openssl passwd -apr1 $PASSWORD)
export DOMAIN=tg-summarizer.example.com
export EMAIL=admin@your-real-domain.com
export CF_DNS_API_TOKEN=your-cloudflare-api-token
```

Start Traefik:

```bash
cd /root/code/traefik-public/
docker compose -f compose.traefik.yml up -d
```

## Application stack

Copy the project (excluding gitignored files):

```bash
rsync -av --filter=":- .gitignore" ./ root@your-server.example.com:/root/code/app/
```

### Deployment mode (Mode A)

Production uses **Mode A — hardened single-operator** ([DECISIONS.md](docs/migration/DECISIONS.md)): one operator, JWT for the browser UI, and fail-closed auth on sensitive API routes. The backend **refuses to start** in `staging`/`production` without the secrets below.

### Required environment variables

Generate secrets:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Set at minimum:

| Variable | Notes |
|----------|-------|
| `ENVIRONMENT` | `staging` or `production` |
| `DOMAIN` | e.g. `tg-summarizer.example.com` |
| `STACK_NAME` | Unique per environment (used in Traefik labels) |
| `SECRET_KEY` | JWT signing key — not `changethis`; must be stable across restarts |
| `POSTGRES_PASSWORD` | Database password |
| `FIRST_SUPERUSER` / `FIRST_SUPERUSER_PASSWORD` | Initial admin account |
| `BACKEND_CORS_ORIGINS` | `https://dashboard.${DOMAIN},https://api.${DOMAIN}` |
| `FRONTEND_HOST` | `https://dashboard.${DOMAIN}` |
| `API_KEY` | **Required** in staging/production — scripts use `X-API-Key`; browser uses JWT |
| `TOKEN_ENCRYPTION_KEY` | **Required** — Fernet key for bot tokens at rest (see `.env.example`) |
| `USERS_OPEN_REGISTRATION` | **`false`** in production |

### TG Summarizer secrets

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google Gemini API for summaries, chat, embeddings |
| `TOR_CONTROL_PASSWORD` | Tor control port password (if using Tor features) |
| `TOR_CONTROL_PORT` | Default `9051` |
| `TOR_SOCKS_PROXY` | Default `socks5h://127.0.0.1:9050` |
| `DEFAULT_PROXY_URLS` | Comma-separated scrape proxy URLs |
| `EMBEDDING_MODEL` | Default `gemini-embedding-2-preview` |
| `DEFAULT_AI_MODEL` | Default `gemini-3-flash-preview` |

### Manual deploy

```bash
cd /root/code/app/
docker compose -f compose.yml build
docker compose -f compose.yml up -d
```

Use `compose.yml` only in production (not `compose.override.yml`).

### Post-deploy (Mode A, one-time)

After the first deploy (or when upgrading from pre–Sprint 2 data), assign all existing TG rows to the operator superuser so scheduler jobs and sync scope correctly:

```bash
# from repo root (e.g. /root/code/app)
uv run python backend/scripts/backfill_user_id.py --dry-run   # preview
uv run python backend/scripts/backfill_user_id.py             # apply

# or from backend/
cd /root/code/app/backend
uv run python scripts/backfill_user_id.py --dry-run   # preview
uv run python scripts/backfill_user_id.py             # apply
```

**Single-owner model:** Mode A treats the bootstrap superuser as the sole data owner. Scheduler jobs (auto-sync, retention, summaries) and manual sync without `channelIds` only touch channels/posts linked to that user. Legacy `/api/*` routes return **410 Gone** in production; use `/api/v1/*` only.

## Response compression

Traefik gzips responses for both the API and the dashboard. Before this, nothing on
the deployment was compressed — the channel list went over the wire as **3.39 MB** of
raw JSON, and `summarizer-*.js` as **1,039 KB** of raw JavaScript. On a slow link
(measured ~0.3–0.75 MB/s from Iran to the Hetzner box) that transfer was roughly 5 of
the ~7 seconds the Channels tab took to load, which is more than the entire backend
cost of the same request.

**Effect on the largest payload:** 3.39 MB → **0.53 MB** (6.4×), for ~76 ms of encoding CPU.

### Where it is configured, and why there

In `compose.yml`, as labels on the `backend` and `frontend` services — **not** in
`compose.traefik.yml`.

The shared `https-redirect` middleware lives in the Traefik stack, so that would have
been the consistent-looking home. It is the wrong one here: the Traefik stack is
deployed by hand from `/root/code/traefik-public/`, while `deploy-staging.yml` only
ever touches the application stack. A middleware defined there would not ship with the
app, and enabling it would mean a manual Traefik restart — an ingress outage — on every
environment. Traefik's Docker provider reads labels from every container on the
`traefik-public` network, so defining it on the app's own services works identically
and rides along with the normal deploy.

The backend and frontend get **two separate middleware definitions** with identical
settings rather than one shared one, because the Docker provider drops the labels of a
stopped container: a single definition living on the backend would take the frontend's
router down with it whenever the backend was down.

### What is excluded, and why

Both middlewares set:

```
excludedcontenttypes=text/event-stream,image/jpeg,image/png,image/webp,image/gif
minresponsebodybytes=1024
```

**`text/event-stream`** — the five SSE routes (sync progress, AI streaming). This entry
is load-bearing: **Traefik 3.6 does not skip SSE on its own.** Remove the entry and it
gzips the stream, verified directly.

It is worth recording what that would actually cost, because the usual reason given for
this exclusion turns out not to apply. Compressed SSE does **not** stall: events still
flush per write, measured arriving at t=0, 1, 2, 3 s with and without compression. The
real cost is size — an event here is ~14 bytes and gzip framing takes each to ~24, so
compressing spends CPU on a long-lived connection in order to send ~70% *more* bytes.

**`image/*`** — cached avatars and post thumbnails are already-compressed JPEG. Gzip
cannot shrink them and may grow them slightly, and they are the highest-frequency
responses the API serves (one per visible channel on the Channels tab). They already
carry `ETag` and `Cache-Control`, so the win there is revalidation, not encoding.

`minresponsebodybytes=1024` keeps small JSON replies uncompressed, where framing
overhead would outweigh any saving.

### Verifying it

```bash
# Expect: content-encoding: gzip, and vary: accept-encoding
curl -s -D- -o /dev/null -H 'Accept-Encoding: gzip' \
  https://api.${DOMAIN}/api/v1/utils/health-check/ | grep -i 'content-encoding\|vary'

# Expect NO content-encoding on an SSE route
curl -s -D- -o /dev/null --max-time 5 -H 'Accept-Encoding: gzip' \
  -H "X-API-Key: ${API_KEY}" \
  https://api.${DOMAIN}/api/v1/jobs/sync/<id>/events | grep -i 'content-encoding'
```

A missing `content-encoding` on a large JSON response usually means the router lost its
middleware reference — check `traefik.http.routers.<stack>-backend-https.middlewares`
resolves to a middleware that is actually defined, and look for a Traefik log line
naming an unknown middleware. Middleware names are namespaced per provider, so the
reference in a Docker label resolves against Docker-provided middlewares.

## Continuous deployment (GitHub Actions)

Workflows deploy via self-hosted runners with labels:

| Environment | Trigger | Runner labels |
|-------------|---------|---------------|
| `staging` | Push to `main` | `self-hosted`, `staging` |
| `production` | Release published | `self-hosted`, `production` |

### Configure GitHub Environments

Repository **Settings → Environments** → create `staging` and `production`.

### Environment secrets

For each environment, configure:

**Shared**
* `SECRET_KEY`
* `FIRST_SUPERUSER`
* `FIRST_SUPERUSER_PASSWORD`
* `POSTGRES_PASSWORD`
* `EMAILS_FROM_EMAIL`
* `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` (if sending mail)
* `SENTRY_DSN` (optional)

**Per environment**
* `DOMAIN_STAGING` / `DOMAIN_PRODUCTION`
* `STACK_NAME_STAGING` / `STACK_NAME_PRODUCTION`

**TG Summarizer (both environments)**
* `GEMINI_API_KEY`
* `API_KEY` (required for Mode A)
* `TOKEN_ENCRYPTION_KEY` (required for Mode A)
* `TOR_CONTROL_PASSWORD` (if using Tor)

**CI only (repository secrets)**
* `SMOKESHOW_AUTH_KEY` — coverage report publishing (optional)

### Install self-hosted runner

```bash
sudo adduser github
sudo usermod -aG docker github
sudo su - github
# Follow GitHub's runner install guide; add label `staging` or `production`
exit
sudo su
cd /home/github/actions-runner
./svc.sh install github
./svc.sh start
```

## URLs

Replace `tg-summarizer.example.com` with your domain.

| Service | Production | Staging |
|---------|------------|---------|
| Frontend | `https://dashboard.tg-summarizer.example.com` | `https://dashboard.staging.tg-summarizer.example.com` |
| API | `https://api.tg-summarizer.example.com` | `https://api.staging.tg-summarizer.example.com` |
| API docs | `.../docs` | `.../docs` |
| Adminer | `https://adminer.tg-summarizer.example.com` | `https://adminer.staging.tg-summarizer.example.com` |
| Traefik UI | `https://traefik.tg-summarizer.example.com` | same host pattern |

Primary app route after login: `/summarizer`.
