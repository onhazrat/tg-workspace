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

The database port is usually not published. Forward it over SSH to a local port:

```
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    -N -L 5433:<db-container-ip>:5432 <host>
```

- Get the container's IP with `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <db-container>`;
  it changes when the container is recreated.
- Run the tunnel as a **launch configuration** (`.claude/launch.json`, which is gitignored) and
  start it with the preview tool. A backgrounded shell command is killed at the 30-minute
  background limit, and every query fails after that.
- `~/.pgpass` gets a line for `localhost:5433:<database>:<role>:<password>`, so nothing else needs
  the password.

## 4. The prototype API

One file, `backend/scripts/proto_<name>_api.py`, run with `uv run python …`.

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
  you run at once.
- **One statement per request.** Over a tunnel each round trip costs ~0.2 s or more, and a large
  response costs more than the query: fold counts, facets and snippets into one statement, and
  keep heavy fields (bios, Post text) out of list responses.
- Measure with `EXPLAIN (ANALYZE, BUFFERS)` on the deployment before optimising; the network, not
  the database, was most of the time here.

## 5. The frontend

- Run the app's dev server with `/api` proxied to the deployment:
  `cd frontend && PLAYWRIGHT_API_URL=<api-base> bun run dev --port <port>`. Use
  `PLAYWRIGHT_API_URL`, not `VITE_API_URL`: the second becomes a cross-origin base in the browser
  and the deployment's CORS list refuses it.
- Add a `/proto` proxy entry to `vite.config.ts` that strips the prefix and targets
  `127.0.0.1:${process.env.PROTO_API_PORT}`. The browser then sees one origin, and the prototype's
  fetches reuse the app's auth headers.
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
- A second prototype at the same time needs its own worktree, its own frontend and API ports
  (`PROTO_API_PORT`), and room under the role's connection limit.

## 6. Keeping it safe to share

- **Never push a prototype branch whose history names the deployment** (its domain, host, IPs,
  role or tunnel recipe). Once pushed, history keeps it even if a later commit removes it.
- To keep a prototype for reference, publish a **sanitized snapshot**: one commit on top of
  `origin/main` built with a temporary index (`GIT_INDEX_FILE`, `read-tree`, `apply --cached`,
  `commit-tree`), with placeholders in place of anything deployment-specific, pushed as
  `prototype/<name>`. Then scan every added line for hosts, IPs, account ids, emails and keys
  before pushing.
- Never commit data from the deployment: exports, fixtures, dumps or JSON captured from it.
- Write the design down (glossary, ADRs, spec, tickets) and send it to `main` as a docs PR. The
  prototype code is never promoted as is.

## 7. Cleaning up

Stop the prototype servers and the tunnel. Drop scratch tables nobody needs; they are the
prototype's, not the app's. Leave the role unless the user asks to remove it, and note in the
handoff that it exists.

## Pitfalls met here

- A plain @mention is stored as both a mention and a link Reference: count distinct Channels or
  Posts, never Reference rows.
- A Follow's channel id keeps its case while the Directory and References store handles lowercase:
  lower both sides of every join.
- `timeout(1)` does not exist on macOS; use ssh's own `-o ConnectTimeout`.
- The typos hook rejects SQL keywords with a verb ending (joined with AND reads better anyway),
  short abbreviations such as the one for Telegram's link domain, and some hyphenated prefixes;
  reword them and check the commit landed.
- The biome pre-commit hook passes repo-root paths to a command run inside `frontend/`; run biome
  there yourself, then commit with `SKIP=local-biome-check`.
- A worktree has no `.env`; symlink it before anything reads settings.
