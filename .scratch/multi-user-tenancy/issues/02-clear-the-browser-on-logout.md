# 02: Clear the browser on logout

**What to build:** Logging out leaves nothing behind on a shared machine. Stored preferences are namespaced per account, so signing in as someone else never inherits the previous person's selection, filters, or settings.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Logging out clears the cached server state as well as the token
- [x] Stored preferences are namespaced by the account identifier taken from the session token
- [x] The token and the theme preference remain device-scoped, with the reason recorded
- [x] Existing unnamespaced values migrate once on first read under a new namespace
- [x] A guard asserts only the storage module, theme provider, transport, and auth hook touch browser storage

## Comments

**Delivered.** `frontend/src/lib/storage/scoped.ts` is the new storage module; every
key now lives under `u:<userId>:`, with the id decoded from the JWT `sub` claim
client-side and unverified (needed synchronously at first render, and a forged
token buys a prefix rather than data).

Sixteen non-test modules touched `localStorage`, not the ten the plan listed —
`SettingsTocNav`, `sort-channels-for-grid`, `extended-commands` and
`rank-commands` were not in it. Thirteen were converted to `scopedStorage`; the
four that remain are the declared owners.

Two things came out differently from the plan:

- **The migration is a sweep, not per-key.** Adopting values key by key at each
  call site only covers the keys someone remembered, which is the same failure
  that produced the leak. One marker-guarded pass moves every unscoped key into
  the account's namespace on first access, and refuses to run for a signed-out
  browser — filing the existing operator's settings under `u:anon:` would lose
  them.
- **`clearStaleSession` needed the same fix as `logout`.** The plan called it
  safe by accident via the hard `window.location.href`. It is, on the branch
  that takes it: a session expiring while the operator was already on `/login`
  left the entire query cache intact. Both now call `queryClient.clear()`.

Preferences are deliberately *not* cleared on logout. They are already
unreachable to another account, and dropping them would mean signing back in to
a reset app; "leaves nothing behind" is satisfied by the namespace plus the
cache clear.

No provider remount key was added (`TgProviders key={currentUserId()}` in the
plan). `/_tg` redirects when signed out, so logging out unmounts the whole
subtree and logging back in mounts it fresh against the new namespace. It
becomes necessary at ticket 26 (View as), where the effective account changes
without a route change.

Seven mutations were watched go red: three against the module (stop
namespacing, copy instead of move, drop the run-once marker) and four against
the guards (a stray `localStorage` read in a hook, `logout` without
`queryClient.clear()`, `clearStaleSession` without it, and a third key smuggled
onto `DEVICE_SCOPED_KEYS`).

Two existing tests failed on the first run — `DataContext` "persists the
selection" and `usePostFilters` "reads back what was stored". Both were
asserting the unscoped keys, which is to say they were pinning the bug. They now
read through `scopedStorage`; the namespacing itself is covered once, in
`lib/storage/scoped.test.ts`, rather than again in every hook.

### Review round

A `/code-review high` pass found seven issues. Five were real and are fixed;
one was wrong about its own mechanism; one is a documented trade-off.

**The Playwright suite was broken and I had missed it entirely** — I grepped
`src/` and never `frontend/tests/`. `auth.setup.ts` seeded bare `hasSeenTour`
and `selectedChannels`, so the guided tour would have opened over the UI in
every authenticated spec, and `summarizer.spec.ts` both seeded and asserted bare
`postFilter_*`, `startDateTs`, `channelGrid_*` and `selectedChannels`. Worse,
the migration marker was being written into `playwright/.auth/user.json` during
setup and restored by every later spec, so the sweep could never adopt anything
seeded afterwards. `tests/utils/scoped-storage.ts` now computes the prefix by
calling the app's own `scopedKey` with the subject decoded from the page's
token — a helper that rebuilt `u:<id>:` by hand would be a second declaration of
the format.

**The guard regex only matched member access,** so `f(localStorage)`,
`Object.keys(localStorage)` and — pointedly — the exact line this ticket deleted
from `SettingsContext` all slipped through. It now matches the identifier, after
stripping comments and string literals. Watched go red against the reviewer's
own mutation.

**A read could throw.** The sweep writes from inside `getItem`, which is called
from `useState` initialisers, so a quota error or Safari with site data blocked
would have white-screened `/summarizer` — something a read could not do before
this module existed. Every accessor is guarded now, with a memory-only
`sweepFailed` set so a broken sweep is not retried on every key access.

**Finding 6 was wrong about its mechanism.** The claim was that `atob`'s Latin-1
output makes `JSON.parse` throw on a non-ASCII claim, dropping the account into
the shared anonymous namespace. It does not throw: UTF-8 lead and continuation
bytes are all legal JSON string characters, so the payload parses and only the
mangled claim is wrong — and `sub` is an ASCII UUID. I checked this directly
rather than taking it at face value, and the first test I wrote for it passed
under mutation, which is what gave it away. The UTF-8 decode is kept anyway,
retargeted at the property that *is* real: the day `sub` stops being a UUID, a
Latin-1 decode would hand that account a different namespace and lose its
preferences silently. That version does fail under mutation.

**Findings 6b and 7 are noted, not changed.** Clearing the query cache *before*
removing the token would let the resulting refetches succeed and repopulate what
was just cleared, which is worse than the narrow window it closes; the one
concrete write path in that window (`DataContext`'s reconcile effect)
early-returns on `!channelsQuery.data`. And `clearStaleSession` on the `/login`
branch has no mounted observers to refetch, because `TgProviders` lives under
`/_tg`.

**Finding 4 — first account after the upgrade claims the unscoped values — is a
documented trade-off,** now argued in the module docstring. Copying instead of
moving leaves the bare keys in place, which is the leak; skipping the migration
loses the operator's settings for certain.

Nine mutations were watched go red in total.
