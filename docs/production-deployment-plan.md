# Production deployment on vm-contabo

Status: in progress, started 2026-10-04.

Production runs on `vm-contabo` (Contabo, Ubuntu 24.04, 4 vCPU, 7.8 GB RAM,
96 GB disk, public `94.250.201.181`, Tailscale `100.118.228.11`). Staging
stays on `vm-oracle-amd` and is not touched except for read-only copies.

## Decisions (confirmed with the operator 2026-10-04)

| Question | Answer |
|---|---|
| Domain | `tg-workspace.hazrati.dev`: `dashboard.`, `api.`, `adminer.`, `traefik.` |
| Starting data | One-time copy of staging's database |
| Duplicate auto-publish | Production's copy starts with the `auto_summary` job **disabled**; the operator flips it on in prod and off in staging at cutover |
| Deploy trigger | `release: published` plus `workflow_dispatch` |
| Signup | `USERS_OPEN_REGISTRATION=true`, `USERS_REQUIRE_APPROVAL=true` |
| Secrets | New `SECRET_KEY`, `API_KEY`, `POSTGRES_PASSWORD`; `TOKEN_ENCRYPTION_KEY`, `GEMINI_API_KEY`, `FIRST_SUPERUSER*` copied from staging, because the copied rows' encrypted bot tokens and AI keys only decrypt with staging's key. Set by pipe into a `production` GitHub environment, never printed |
| Cloudflare token | Staging Traefik's `CF_DNS_API_TOKEN`, copied |
| Port 80/443 clash | See below |

## The box already runs a DERP relay

`derper.service` (Tailscale DERP for `edge-eu.devopsguys.online`, systemd,
`-certmode=letsencrypt`) listens on `:443` and `:80`. Traefik needs both.
Chosen fix is SNI passthrough, so the tailnet's DERP map does not change:

- derper moves to `-a=172.17.0.1:8443 -http-port=8080`, bound on the Docker
  bridge so it is not public, and reached from the Traefik container through
  `host.docker.internal:host-gateway`. Its unit gains `After=docker.service`
  so the bridge address exists when it binds.
- Traefik reads a file-provider directory (`compose.traefik.yml` now mounts
  `./dynamic`). The DERP file stays on the VM only, because it names a domain
  that is not this project's:
  - a TCP router `HostSNI(edge-eu.devopsguys.online)` on `https` with
    `tls.passthrough=true` to `host.docker.internal:8443`. derper keeps
    terminating its own TLS, so its Let's Encrypt TLS-ALPN renewal still
    works through the passthrough.
  - an HTTP router `Host(edge-eu.devopsguys.online)` on `http` to
    `host.docker.internal:8080`, with no HTTPS redirect, because Tailscale
    clients probe DERP nodes over plain HTTP for captive-portal detection.
- STUN (UDP 3478) is untouched.

Cost: a DERP outage of a few seconds while derper restarts and Traefik
starts. SSH still works over the public IP's sshd if Tailscale paths flap.

## Steps

### 1. Repo (one PR)

- `deploy-production.yml` is stale: it writes no `.env` and lacks
  `TOKEN_ENCRYPTION_KEY`. Bring it level with staging, add
  `workflow_dispatch`, and stop the two `.env` writers drifting again by
  moving the writer into one script both workflows call.
- This plan.

### 2. VM base

- Docker Engine from Docker's apt repository.
- `github` user in the `docker` group; GitHub runner registered as
  `production-vm` with label `production`, running as a systemd service.
- `docker network create traefik-public`.

### 3. derper and Traefik

- Edit `derper.service` ports, `daemon-reload`, restart.
- `/root/code/traefik-public/` with `compose.traefik.yml`, an `.env`
  holding `DOMAIN`, `EMAIL`, `USERNAME`, `HASHED_PASSWORD`,
  `CF_DNS_API_TOKEN`, and the DERP file-provider config.
- Verify `https://edge-eu.devopsguys.online/derp/probe` and
  `tailscale netcheck` from a client.

### 4. DNS

A records for `dashboard`, `api`, `adminer`, `traefik` under
`tg-workspace.hazrati.dev` to `94.250.201.181`, proxied the same way
staging's are.

### 5. Secrets

`production` GitHub environment with the secrets the workflow reads.

### 6. First deploy

`workflow_dispatch` on `main`. Brings up an empty stack and proves TLS,
routing and the backend's secret checks.

### 7. Data copy

1. On staging: `pg_dump -Fc` to a file inside the db container (never stream
   it through `docker exec`, which truncated a dump before), `docker cp`
   out, `sha256sum`. Excludes the `proto` schema. `--no-owner --no-acl`.
2. `scp -3` staging to vm-contabo, check the hash.
3. On prod: stop `backend` and `worker`, drop and recreate `app`,
   `pg_restore`, then set `jobs.auto_summary.enabled = false` in
   `tg_app_settings` **before** the worker starts again.
4. `docker compose up -d`; prestart migrates to the deployed revision.
5. Delete the dump files on both boxes.

### 8. Verify

- `https://api.tg-workspace.hazrati.dev/docs` is 200 and its
  `openapi.json` matches the deployed commit.
- Dashboard login with the copied superuser.
- Settings show `auto_summary` disabled.
- derper still reachable.

## Cutover (operator)

Turn on `auto_summary` in production, turn it off in staging. Both
deployments scrape Telegram on their own schedule until then, which doubles
request load on any proxy they share but publishes nothing twice.
