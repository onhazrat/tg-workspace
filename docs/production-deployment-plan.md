# Production deployment on vm-contabo

Status: live since 2026-10-04 on staging's data; cutover (below) is the operator's.

Production runs on `vm-contabo` (Contabo, Ubuntu 24.04, 4 vCPU, 7.8 GB RAM,
96 GB disk, public `94.250.201.181`, Tailscale `100.118.228.11`). Staging
stays on `vm-oracle-amd` and is not touched except for read-only copies.

## Decisions (confirmed with the operator 2026-10-04)

| Question | Answer |
|---|---|
| Domain | `tg-workspace.hazrati.dev` for the app (`dashboard.` redirects there since 2026-10-04); `api.`, `adminer.`, `traefik.` |
| Starting data | One-time copy of staging's database |
| Duplicate auto-publish | Production's copy starts with the `auto_summary` job **disabled**; the operator flips it on in prod and off in staging at cutover |
| Deploy trigger | `release: published` plus `workflow_dispatch` |
| Signup | `USERS_OPEN_REGISTRATION=true`, `USERS_REQUIRE_APPROVAL=true` |
| Secrets | New `SECRET_KEY`, `API_KEY`, `POSTGRES_PASSWORD`; `TOKEN_ENCRYPTION_KEY`, `GEMINI_API_KEY`, `FIRST_SUPERUSER*` copied from staging, because the copied rows' encrypted bot tokens and AI keys only decrypt with staging's key. Set by pipe into a `production` GitHub environment, never printed |
| Cloudflare token | Staging Traefik's `CF_DNS_API_TOKEN`, copied |
| Port 80/443 clash | See below |

## The box already runs a DERP relay

`derper` (Tailscale DERP for `edge-eu.devopsguys.online`, region `fleet-eu`)
held `:443` and `:80`. Traefik needs both. derper only serves TLS when its
listen port is 443 (`-a=:8443` serves plain HTTP), and it binds STUN to the
same host as `-a`, so moving its port or address on the host breaks it.

What runs instead: derper as a container on the `traefik-public` network
(`/root/code/derper/compose.yml` on the VM), same binary, state directory,
hostname and certificate, still on `:443` inside its container. Traefik
labels forward `HostSNI(edge-eu.devopsguys.online)` with TLS passthrough and
plain HTTP for the same host (Tailscale's captive-portal probe). STUN is
published on `3478/udp`. The systemd unit is disabled, with a backup at
`/root/derper.service.bak`. Its domain and DERP map entry are unchanged.

Staging's Traefik turned out to use HTTP-01, not the repo's DNS-01 with a
Cloudflare token, so there was no token to reuse. Production does the same,
as a VM-local edit to its copy of `compose.traefik.yml`; the records are
DNS-only.

## What was done (2026-10-04)

1. **Repo**, PR #149: both deploy workflows call `scripts/write-deploy-env.sh`;
   production deploys on `release: published` or `workflow_dispatch`.
2. **VM base**: Docker from Docker's apt repository; runner `production-vm`
   (label `production`, user `github`), so the deploy directory is
   `/home/github/actions-runner/_work/tg-workspace/tg-workspace`, Compose
   project `tg-workspace-production`.
3. **derper and Traefik**: Traefik from `/root/code/traefik-public/`
   (HTTP-01, dashboard password in `dashboard-password` there, root only);
   derper containerised as above. `/derp/probe` 200, `/generate_204` 204,
   `tailscale debug derp fleet-eu` clean over IPv4.
4. **DNS**: `tg-workspace.hazrati.dev` and `*.tg-workspace.hazrati.dev`, A
   to `94.250.201.181`, DNS-only like staging.
5. **Secrets**: `production` environment; `SECRET_KEY`, `API_KEY`,
   `POSTGRES_PASSWORD` new, the rest copied from staging's `.env`. Mail, Tor
   and Sentry are empty on staging and so on production too, which means
   password recovery sends nothing.
6. **First deploy**: run 37215826002, empty stack, all 200.
7. **Data copy**: `pg_dump -Fc -N proto` inside staging's db container
   (3.0 GB from an 11 GB database), pulled to vm-contabo and checked by
   sha256, `pg_restore -j 4` into a recreated `app`, then the `jobs` row
   `{"auto_summary": {"enabled": false}}` inserted before the worker
   started. Row counts matched staging to within its growth during the copy
   (513,166 vs 512,619 Posts). Both dump files deleted.
8. **Verify**: `/docs` and the health check 200, `openapi.json` paths and
   schemas identical to `main` (122 and 213), derper still 200.

### The transfer is slow per stream

Staging to vm-contabo is 105 ms over a direct Tailscale path with a little
loss, so one TCP stream (cubic) holds about 1 MB/s whatever either port can
do; both CPUs sat idle. Eight parallel `dd` byte ranges over SSH reached
about 7 MB/s. Split a large copy between these boxes from the start; the
end-to-end sha256 is what proves the pieces reassembled.

## Cutover (operator)

Turn on `auto_summary` in production, turn it off in staging. Both
deployments scrape Telegram on their own schedule until then, which doubles
request load on any proxy they share but publishes nothing twice.
