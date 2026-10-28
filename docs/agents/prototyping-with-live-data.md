# Prototyping with live data and new backend routes

How to build a throwaway UI prototype that needs backend routes the app does not have, against
a deployment's real data, without touching the real API, its guards, or the deployment's data.
It is the setup the Directory tab came from (prototype branch `prototype/directory-tab`, design
in `.scratch/directory-tab/`). Use it with the `/prototype` skill's UI branch.

Placeholders: `<host>` is the deployment's server, `<db-container>` its Postgres container,
`<api-base>` its public API URL, `<role>` and `<schema>` the prototype's database role and schema.
This repo is public, so none of them is written down here; ask the user, or read your own notes.

## The shape

```
browser ─▶ local Vite dev server ─┬─ /api   ─▶ <api-base>             (the real API, real login)
                                  └─ /proto ─▶ local prototype API ─▶ SSH tunnel ─▶ <db-container>
                                                                      (read-only role + scratch schema)
```

- The **frontend** is the app itself, run locally, with the prototype as a throwaway workspace tab.
- **Real routes** go to the deployment's real API, so login, Follows and everything else are real.
- **New routes** live in a standalone FastAPI script that is never mounted in the real API. The
  route guards (route inventory, account isolation, the approval gate, route-module hygiene) would
  all demand a real route's ceremony from code that will be thrown away.
- That script reads the deployment's **database** live, as a role that can read everything and
  write only its own scratch schema.

## 1. Ask first

Creating a role and a schema changes the deployment, and the standing rule is that a deployment
is read-only. **Ask the user before step 2**, and say which deployment. Also ask, before building
any action, whether actions that go through `/api` (Follow, dismiss, anything that writes) should
be real or stubbed: through `/api` they change the user's real account.

## 2. The read-only role and its scratch schema

Check whether one already exists (`\du`, `\dn`) before creating anything. Otherwise, as the
database superuser on `<host>`:

```sql
CREATE ROLE <role> LOGIN PASSWORD '<generated>' CONNECTION LIMIT 12;
GRANT pg_read_all_data TO <role>;            -- reads every table, including future ones
CREATE SCHEMA <schema> AUTHORIZATION <role>;  -- the only place it can write
ALTER ROLE <role> SET idle_in_transaction_session_timeout = '5min';
ALTER ROLE <role> SET statement_timeout = '10min';
```

- Naming the role and the schema the same puts unqualified `CREATE TABLE` in the scratch schema,
  because the default `search_path` is `"$user", public`.
- The timeouts stop a forgotten session from pinning the xmin horizon on a live database (see
  CLAUDE.md: never hold a session open across slow work).
- Generate the password (`openssl rand -hex 24`), send it to the server on stdin rather than as a
  command-line argument, and keep it only in the user's `~/.pgpass`. Never in the repo, the
  chat, a commit or a launch file.
- `pg_read_all_data` also reads the account tables and encrypted credentials. Say so, and offer to
  narrow the grant to the tables the prototype needs.
- Verify by logging in as the role over TCP: a `SELECT` works, an `UPDATE` on a real table and a
  `CREATE TABLE public.x` are refused, a `CREATE TABLE` in the scratch schema works.

## 3. The tunnel

The database port is usually not published. Forward it over SSH to a local port, in a loop
that reconnects and looks the container's IP up again each time, because the IP changes when the
container is recreated. Save it outside the repo as `tunnel.sh` and start it with
`nohup bash tunnel.sh > tunnel.log 2>&1 &`:

```bash
while true; do
  ip=$(ssh -o BatchMode=yes -o ConnectTimeout=20 <host> \
    "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <db-container>")
  if [ -z "$ip" ]; then echo "$(date) no ip, retrying"; sleep 5; continue; fi
  ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
      -o ServerAliveCountMax=3 -N -L 5433:"$ip":5432 <host>
  echo "$(date) tunnel exited $?"; sleep 5
done
```

- A lone `ssh -N` dies when the link stalls ("server not responding"), and every query fails
  after it. The loop keeps a long session up, and `nohup` keeps it past the agent's
  background-command limit. Where the agent has a preview tool, a launch configuration
  (`.claude/launch.json`, gitignored) running the same loop works too.
- **A wedged tunnel stays up.** Over a relayed Tailscale link the `-L` ssh can live on while every
  connection through it times out, and `ServerAlive` never notices. The sign is `psql` failing
  with "timeout expired" while the ssh process runs. Kill the `-L` ssh (`pkill -f "ssh .*-L
  5433:"`), and the loop reconnects; then restart the prototype API, whose pooled connections
  hang on the dead link (a pre-ping hangs with them). The IP lookup can hang too, behind
  Tailscale SSH's check; the guard above keeps a killed lookup from forwarding to no host.
  `tailscale ping <host>` saying "via peer-relay" at hundreds of milliseconds explains a slow
  session.
- `~/.pgpass` gets a line for `localhost:5433:<database>:<role>:<password>`, so nothing else needs
  the password. Connect with `-h localhost`, as the line says: `-h 127.0.0.1` matches no line and
  asks for a password.
- **Ad-hoc queries** go through `psql`, which on macOS comes from Homebrew's `libpq`. It is
  keg-only, so call it by its full path (or add its `bin` to `PATH`), and pass the parallel-workers
  setting (see the next section) through the environment:
  `PGOPTIONS='-c max_parallel_workers_per_gather=0' /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5433 -U <role> <database> -c "…"`.
  A millisecond timestamp span past 2^31 needs a `::bigint` literal, or the query fails with
  "integer out of range".

## 4. The prototype API

One file, `backend/scripts/proto_<name>_api.py`, started **from `backend/`**
(`cd backend && uv run python scripts/proto_<name>_api.py`): the settings read `.env` relative
to that directory, and from the repo root the import fails on missing fields before it serves.
In a worktree, which has no `.env`, start it as the `.env` pitfall below says.

- **Configuration only from the environment, with no defaults that name a deployment**:
  `PROTO_DSN` (a libpq connection string), the deployment's API base for identity, `PROTO_PORT`.
  Adding environment variables makes the env-catalog hook regenerate `.env.example`; commit that.
- **Identity**: forward the caller's `Authorization` header to `<api-base>/api/v1/users/me` and
  cache the answer per token. The script then knows the account without holding any secret.
- **Writes go only to the scratch schema.** Precomputed tables the prototype needs are built
  there on first start, in resumable batches. A batch cursor must compare handles in the same
  order Postgres sorts them: use `COLLATE "C"` in SQL, which is the order Python's string
  comparison uses.
- **Every connection runs `SET max_parallel_workers_per_gather = 0`.** A container on Docker's
  default 64 MB `/dev/shm` fails parallel hash joins with "could not resize shared memory
  segment", and so does any parallel query of the app's running at the same moment. Check the
  database log after a heavy query.
- **A small connection pool**, well under the role's connection limit across every prototype API
  you run at once: `DB_POOL_SIZE=5` and `DB_MAX_OVERFLOW=0`. Three ran out when a page fired
  several prototype reads at once during a slow spell.
- **One statement per request.** Over a tunnel each round trip costs ~0.2 s or more, and a large
  response costs more than the query: fold counts, facets and snippets into one statement, and
  keep heavy fields (bios, Post text) out of list responses.
- Measure with `EXPLAIN (ANALYZE, BUFFERS)` on the deployment before optimising; the network, not
  the database, was most of the time here.

**When the prototype changes routes the app already has** (a new filter on the feed, a new
count), serve this branch's real router instead of rewriting it, so the change being prototyped
is the code that folds in later. The script sets `POSTGRES_*` to the tunnel (the password read
from `~/.pgpass`) and a small `DB_POOL_SIZE` **before** importing the app, mounts only the
changed router under the real prefix, overrides `get_current_user` with the forwarding identity
above, and registers a connect listener on the engine that runs the parallel-workers `SET`. The
frontend then proxies just those paths to it (next section). The posts-tab improvements
prototype (`prototype/posts-tab-improvements`, `backend/scripts/proto_posts_api.py`) is a worked
example.

## 5. The frontend

- Run the app's dev server with `/api` proxied to the deployment:
  `cd frontend && PLAYWRIGHT_API_URL=<api-base> bun run dev --port <port>`. Use
  `PLAYWRIGHT_API_URL`, not `VITE_API_URL`: the second becomes a cross-origin base in the browser
  and the deployment's CORS list refuses it.
- Add a `/proto` proxy entry to `vite.config.ts` that strips the prefix and targets
  `127.0.0.1:${process.env.PROTO_API_PORT}`. The browser then sees one origin, and the prototype's
  fetches reuse the app's auth headers.
- For changed routes the app already has, add a regex key **ahead of** `/api` in `server.proxy`
  (`"^/api/v1/data/posts": { target: "http://127.0.0.1:" + process.env.PROTO_API_PORT }`), so
  those paths reach the local copy and everything else the deployment.
- **Sharing with the user's other devices over Tailscale.** Add `allowedHosts: [".ts.net"]` to
  `server` (Vite refuses an unknown `Host` otherwise), start the dev server on
  `127.0.0.1:<port>`, then `tailscale serve --bg --https=<port> http://127.0.0.1:<port>`. The
  prototype is at `https://<machine>.<tailnet>.ts.net:<port>/`, tailnet only, hot reload
  included. `tailscale serve status` lists the ports already taken.
- Mount the prototype as a workspace tab: an entry in `WORKSPACE_TABS`, its view in `App.tsx`, its
  icon, and `variant` in the workspace search. Put the code in
  `frontend/src/components/<name>-prototype/` and switch variants with `?variant=` and the shared
  `PrototypeSwitcher`, which hides itself outside dev builds.
- Keep state the user should not lose (filters, the open panel) through `scopedStorage`, never
  `localStorage` directly; the architecture guard fails on the second. A filter view that should
  be shareable goes in the URL as a validated search parameter.
- Each dev-server port is its own origin with its own login. The user logs in; never type a
  password.
- The user shares the browser pane. Check your work in a tab of your own, save the prototype's
  stored state before a test and restore it after, and never type into the user's tab.
- **Click by element reference while `resize_window` emulates a size.** The emulated page is
  scaled into the pane, so a coordinate read off a screenshot lands on another control; take
  refs from `find` or `read_page` instead.
- A second prototype at the same time needs its own worktree, its own frontend and API ports
  (`PROTO_API_PORT`), and room under the role's connection limit.

### Checking keyboard features in the browser pane

- **Send keys from a script, as a keyboard sends them.** The pane's own key action turns
  `shift+t` into a plain `t` with no Shift keydown, so it cannot reproduce a bug that lives in
  the Shift. Dispatch `keydown` events from the page's script instead, and precede every
  capital with its own `Shift` keydown (`{ key: "Shift", shiftKey: true }`, then
  `{ key: "T", shiftKey: true }`). Four keyboard-mode bugs (`gT`, `23G`, `gg`, `?` leaving a
  `g` waiting) passed tests that sent the capital alone.
- **Keep each script under the tool's 45-second limit**: one call per tab or per check. A
  script that times out keeps running in the page and changes it under the next call; check
  where the page is before running again.
- **Intercept clicks on anything that writes.** Against a deployment's real API, wrap
  `HTMLElement.prototype.click` to log instead of press while a key could hit Follow,
  Dismiss, Freeze, a selection or a delete, and restore it afterwards. A key that opens,
  moves or filters can run for real.
- **A dialog left open swallows every key.** Before trusting "nothing happened", check for a
  `[role="dialog"]` a previous step left open.

## 6. Keeping it safe to share

- **Never push a prototype branch whose history names the deployment** (its domain, host, IPs,
  role or tunnel recipe). Once pushed, history keeps it even if a later commit removes it.
- To keep a prototype for reference, publish a **sanitized snapshot**: one commit on top of
  `origin/main` built with a temporary index (`GIT_INDEX_FILE`, `read-tree`, `apply --cached`,
  `commit-tree`), with placeholders in place of anything deployment-specific, pushed as
  `prototype/<name>`. Then scan every added line for hosts, IPs, account ids, emails and keys
  before pushing.
- Never commit data from the deployment: exports, fixtures, dumps or JSON captured from it.
- Commit on the prototype branch with `--no-verify`: mypy and ty reject throwaway code, and the
  env-catalog hook rewrites `.env.example` for every `PROTO_*` variable. Every commit bound for
  `main` keeps the hooks.
- Write the design down (glossary, ADRs, spec, tickets) and send it to `main` as a docs PR. The
  prototype code is never promoted as is. Push the snapshot **before** opening that PR, so the
  docs link it from their first commit; a docs PR that merges first needs a second PR for the link.
- **Write the docs in the prototype's own worktree**, even while it serves the prototype: the
  dev server and the prototype API never read `GLOSSARY.md`, `docs/` or `.scratch/`. Commit them
  there with `--no-verify` like the rest, then build the docs commit the way the snapshot is
  built, on `origin/main` from a temporary index and the diff of those paths alone
  (`git diff --binary origin/main HEAD -- GLOSSARY.md docs .scratch/<feature>`). Run the repo's
  hooks on those files (`cd backend && uv run prek run --files <paths>`), scan the added lines
  as for the snapshot, push the commit as its own branch and open the PR from it. A second
  worktree is the wrong tool here: the session's worktree hook refuses writes into it.

## 7. Cleaning up

Stop the prototype servers, the tunnel loop and its `ssh`, and each
`tailscale serve --https=<port> off`. Drop scratch tables nobody needs; they are the
prototype's, not the app's. Leave the role unless the user asks to remove it, and note in the
handoff that it exists.

## Pitfalls met here

- Count distinct Channels or Posts, never Reference rows: one Channel citing another in twenty
  Posts is twenty rows. (Until 2026-10-14 a plain @mention was also stored twice; ADR-019's
  amendment removed that.)
- A Follow's channel id keeps its case while the Directory and References store handles lowercase:
  lower both sides of every join.
- `timeout(1)` does not exist on macOS; use ssh's own `-o ConnectTimeout`.
- The typos hook rejects SQL keywords with a verb ending (joined with AND reads better anyway),
  short abbreviations such as the one for Telegram's link domain, and some hyphenated prefixes;
  reword them and check the commit landed.
- The biome pre-commit hook passes repo-root paths to a command run inside `frontend/`; run biome
  there yourself, then commit with `SKIP=local-biome-check`.
- A worktree has no `.env`, and symlinking the root one into it breaks a frontend proxied to a
  deployment: its `VITE_API_URL` becomes the browser's cross-origin base (section 5). Start the
  prototype API from an empty scratch directory whose parent holds a `.env` symlink to the main
  checkout's (the settings read `../.env`), with `PYTHONPATH` set to the worktree's `backend/`
  and the main checkout's `.venv` Python. The worktree stays without one.
