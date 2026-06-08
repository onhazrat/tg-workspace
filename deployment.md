# TG Summarizer — Deployment

Deploy the stack with Docker Compose on a remote server behind a shared Traefik reverse proxy (HTTPS + Let's Encrypt).

## Preparation

* Remote server with [Docker Engine](https://docs.docker.com/engine/install/) installed.
* DNS A record for your domain pointing to the server.
* Wildcard DNS for subdomains (`*.example.com`, `*.staging.example.com`) so services are reachable at `dashboard.`, `api.`, `adminer.`, `traefik.`, etc.
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
| `SECRET_KEY` | JWT signing key — not `changethis` |
| `POSTGRES_PASSWORD` | Database password |
| `FIRST_SUPERUSER` / `FIRST_SUPERUSER_PASSWORD` | Initial admin account |
| `BACKEND_CORS_ORIGINS` | `https://dashboard.${DOMAIN},https://api.${DOMAIN}` |
| `FRONTEND_HOST` | `https://dashboard.${DOMAIN}` |

### TG Summarizer secrets

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google Gemini API for summaries, chat, embeddings |
| `API_KEY` | Optional shared key for `X-API-Key` auth (scripts/automation) |
| `TOR_CONTROL_PASSWORD` | Tor control port password (if using Tor features) |
| `TOR_CONTROL_PORT` | Default `9051` |
| `TOR_SOCKS_PROXY` | Default `socks5h://127.0.0.1:9050` |
| `DEFAULT_PROXY_URLS` | Comma-separated scrape proxy URLs |
| `EMBEDDING_MODEL` | Default `gemini-embedding-2-preview` |
| `DEFAULT_AI_MODEL` | Default `gemini-3-flash-preview` |
| `USERS_OPEN_REGISTRATION` | Set `false` in production to disable signup |

### Manual deploy

```bash
cd /root/code/app/
docker compose -f compose.yml build
docker compose -f compose.yml up -d
```

Use `compose.yml` only in production (not `compose.override.yml`).

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
* `API_KEY` (optional)
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
