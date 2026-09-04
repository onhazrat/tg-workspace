# #123 🔒 Namespace browser storage per account (ticket 02)

**State:** merged 2026-08-24 · **Branch:** `ticket-02-scoped-browser-storage` into `main` · **Diff:** +1047 / -158 across 30 files · **Opened:** 2026-08-24

---

Closes ticket 02 (`.scratch/multi-user-tenancy/issues/02-clear-the-browser-on-logout.md`).

Roughly thirty `localStorage` keys — `selectedChannels`, `postFilter_*`, `channelGrid_*`, `hasSeenTour`, every schema-driven setting — were written under a bare name. Correct while the deployment had one operator; on a shared machine the second person to sign in inherited the first person's channel selection, filters and settings, with nothing on screen saying where any of it came from.

`frontend/src/lib/storage/scoped.ts` puts every key under `u:<userId>:`, with the id taken from the JWT `sub` claim decoded client-side and unverified — it is needed synchronously at first render, before `usersReadUserMe()` could resolve, and a forged token buys a prefix rather than data.

Sixteen non-test modules touched `localStorage`, not the ten the plan listed. Thirteen now go through `scopedStorage`; the four that remain are declared owners with a recorded reason: the storage module, `theme-provider` and `api/base.ts` (device-scoped keys), and `useAuth` (the token every namespace comes from).

## Two departures from the plan

**The migration is one marker-guarded sweep, not per-key adoption at each call site.** A per-key migration only covers the keys somebody remembered, which is the same failure that produced the leak. It moves rather than copies, and refuses to run for a signed-out browser — filing the operator's settings under `u:anon:` would lose them. The first account to sign in after the upgrade therefore claims the unscoped values; that trade-off is argued in the module docstring.

**`clearStaleSession` needed the same fix as `logout`.** The plan called it safe by accident via the hard `window.location.href`, and it is — on the branch that takes it. A session expiring while the operator was already on `/login` left the whole query cache intact. Both now call `queryClient.clear()`.

Stored preferences are deliberately **not** cleared on sign-out: they are already unreachable to another account, and dropping them means signing back in to a reset app.

## The guard

The rule is "do not name `localStorage`" rather than "namespace your keys", because only the first can be checked — one forgotten `setItem` in a new hook re-opens the leak silently and looks exactly like the twelve lines around it. It matches the identifier rather than `localStorage.`, since `f(localStorage)`, `Object.keys(localStorage)` and the exact line this ticket deleted from `SettingsContext` are all member-access-free.

## Second commit: what the first one broke

A `/code-review high` pass caught that **the Playwright suite was broken and I had missed it** — the first pass grepped `src/` and never `frontend/tests/`. `auth.setup.ts` seeded bare `hasSeenTour`, so the guided tour would have opened over the UI in every authenticated spec, and the migration marker was being captured into `playwright/.auth/user.json` and restored by every later spec. `tests/utils/scoped-storage.ts` fixes it by calling the app's own `scopedKey`, so the namespace format stays declared once.

The same pass found the guard regex too narrow, and that a read could now throw during render (the sweep writes from inside `getItem`, which runs in `useState` initialisers — a quota error or Safari with site data blocked would white-screen the app). Both fixed.

One review finding did not hold: `atob`'s Latin-1 output does **not** make `JSON.parse` throw on a non-ASCII claim, because UTF-8 lead and continuation bytes are legal JSON string characters. The first test written for it passed under mutation, which is what gave it away. The UTF-8 decode is kept, retargeted at the property that is real.

## Verification

- 869 frontend unit tests pass; `tsc -p tsconfig.build.json --noEmit` clean; biome clean (3 remaining warnings are pre-existing, in files this branch does not touch).
- `bunx playwright test --list` loads all 142 tests across 11 files. The e2e suite was **not** executed — it needs a live backend.
- Nine mutations watched go red: three against the storage module, six against the guards.
- Backend untouched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
