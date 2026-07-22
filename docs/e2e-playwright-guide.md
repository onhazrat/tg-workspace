# Running the Playwright e2e suite (read before you run it)

**Date:** 2026-07-22

This repo's Playwright suite has several sharp edges that cost real time when
hit blind. Every one below was actually encountered. Follow this exactly.

---

## TL;DR — the one command that works

```bash
cd frontend        # NOT the repo root — this matters, see §1
PLAYWRIGHT_CHANNEL=chrome bunx playwright test tests/summarizer.spec.ts --reporter=line
```

- `tests/summarizer.spec.ts` is the **only** safe spec to run. Do not run the
  others (`items`, `admin`, `user-settings`) — they import a non-existent
  `PrivateService` and always fail (production-mode client generation excludes
  private routes, by design).
- Playwright starts its own frontend dev server (`bun run dev`) automatically
  and reuses one if already running.

---

## 1. Run from `frontend/`, never the repo root

`playwright.config.ts` lives in `frontend/`. If you run `bunx playwright test`
from the **repo root**, config resolution changes and the
`PLAYWRIGHT_CHANNEL` → `channel: 'chrome'` branch does not take effect. The
tests then try to launch bundled **chromium headless shell**, whose download is
**geo-blocked here (HTTP 403)**, and every test fails with:

```
browserType.launch: Executable doesn't exist at .../chrome-headless-shell...
Looks like Playwright Test or Playwright was just installed or updated.
  npx playwright install
```

This is **not** a real "browsers not installed" problem and `npx playwright
install` will **not** fix it (the download is blocked). The fix is: run from
`frontend/` with `PLAYWRIGHT_CHANNEL=chrome` so it uses the system-installed
Google Chrome instead of downloading chromium.

> Watch your shell's working directory across a long session — background
> `docker`/`git` commands can leave you at the repo root. If you suddenly get
> the "install browsers" banner after previously-green runs, **check your cwd
> first** — it is almost always this, not a code change.

---

## 2. Always `PLAYWRIGHT_CHANNEL=chrome`

The config only sets `channel: 'chrome'` when `process.env.PLAYWRIGHT_CHANNEL`
is present. Without it, it defaults to chromium (blocked download, see §1).
Google Chrome is installed at
`/Applications/Google Chrome.app/...`; the `chrome` channel uses it directly.

---

## 3. The suite runs `workers: 1` — leave it that way

`playwright.config.ts` pins `workers: 1`. Every spec shares **one** backend,
one database, and one user account, and most setup paths fetch the unbounded
channel list. Parallel workers starve each other: parallel runs took
**6.8–16.5 min and failed 1–3 specs at random** (a different set each run),
while serial passes **51/51 in ~2.6 min**. Do not re-parallelise. If you see
timeout/visibility failures whose *set changes between runs*, suspect
contention, not the specs — reproduce in isolation before blaming a diff.

---

## 4. The e2e frontend proxies to the `:8000` backend — make sure it runs YOUR code

`frontend/vite.config.ts` proxies `/api` to `http://localhost:8000`. That
backend is a **Docker container**, and by default it is the **main checkout's**
image — it does **not** have your worktree's backend changes. Any endpoint your
branch added returns **404** there, and unmocked calls during test setup
(e.g. seeding) will fail in confusing ways (you may even land on the login page
if an auth-shaped error results).

**If your branch changes the backend and the e2e hits any *unmocked* endpoint,
rebuild `:8000` from your worktree first.** Steps that worked:

```bash
# from the worktree root
docker stop tg_summarizer_migrate_to_fastapi-backend-1   # free :8000 (main image)

# bring up db + prestart + backend from THIS worktree.
# Trap: the main project's db already publishes host port 5432, so a plain
# `docker compose up` fails with "Bind for 0.0.0.0:5432 failed". The backend
# reaches the db by the internal hostname `db`, not the host port, so drop the
# db's host publish with a tiny override:
cat > /tmp/nodbport.yml <<'YAML'
services:
  db:
    ports: !reset []
YAML
docker compose -f compose.yml -f compose.override.yml -f /tmp/nodbport.yml up -d --force-recreate db
# wait for db healthy, then:
docker compose -f compose.yml -f compose.override.yml -f /tmp/nodbport.yml \
  up -d --force-recreate --no-deps prestart backend

# verify your endpoint is live (401 = exists but needs auth; 404 = wrong code):
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/v1/data/posts/counts
```

Another trap: if you `docker compose start db` a **standalone** db container it
can come up **detached from the compose network**, and `prestart` then fails
with `failed to resolve host 'db'`. Recreate db *with* the compose file set (as
above) so it joins the network; do not start it in isolation.

The rebuilt worktree db is **empty** — that is fine: the specs seed their own
channels through the API, and `prestart` creates the `FIRST_SUPERUSER` the auth
setup logs in with.

**Restore the main backend when done:**

```bash
docker compose down                                        # tear down worktree stack
docker start tg_summarizer_migrate_to_fastapi-backend-1    # bring main :8000 back
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/v1/utils/health-check/  # expect 200
```

**You can skip all of §4 if every endpoint your test touches is mocked via
`page.route(...)`.** The Discover specs mock `/discover/candidates` and
`/posts/counts`; but seeding (`seedTestChannel`) hits real `/data/channels` and
`/data/posts/counts`, so a backend without those endpoints breaks seeding.

---

## 5. Reading results correctly

- Trust the final `N passed / N failed` summary line, **not** a grep of the log
  body. Misreading the body once produced a confidently wrong tally.
- Match a failing spec by its **name**, not its line number — edits shift line
  numbers and a shifted line looks like a "new" failure when it is the same test.
- Serial mode (`workers: 1`) **skips** the remaining specs in a
  `describe.serial` block after one fails ("N did not run"). One red spec can
  therefore hide the state of several others.
- Container/host RSS oddities and CDN 403s are environment, not your diff.

---

## 6. Other known-broken things (do not try to "fix")

- **GitHub Actions is billing-blocked.** All GitHub-hosted test workflows fail
  with a payment error — they never *started*. Red CI ≠ your fault. Only
  `Deploy to Staging` (self-hosted) actually runs. **Local runs are the gate.**
- `bunx tsc -p tsconfig.build.json --noEmit` excludes test files by design; the
  full `tsconfig.json` surfaces the `PrivateService` error from the specs you
  should not run anyway.
