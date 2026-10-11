# Settings redesign prototype

Status: needs-triage

Verdict (2026-10-11): **A wins.** B (scope-first tabs) and C (overview + drawer)
were dropped and deleted from the branch; the earlier commit 3bfbaa14 still has them.

Question: what should the workspace Settings tab look like once scope (browser /
account / deployment) is first-class, tools leave it, and every plain setting
uses one row?

Code: `frontend/src/components/settings-prototype/` (throwaway), mounted on the
existing `?tab=settings` route through `App.tsx`; `?variant=` is a workspace
search param.

| Variant | Idea | Borrowed from |
|---|---|---|
| 0 | main, unchanged | |
| A | one scrolling list, scroll-spy tree, search + scope chips + "Modified only" | VS Code |
| B, C | dropped, see verdict | |

Shared: `model.ts` derives each setting's scope from where it is stored
(`schema.ts` section + the backend's SYNC_PREF_FIELDS / RETENTION_PREF_FIELDS);
`ProtoRow.tsx` is the one row (scope badge, "Managed by Admin" when the account
cannot write, modified bar, menu with reset / copy link / copy id, numbers commit
600ms after typing stops); `panels.tsx` frames the hand-written panels.

Admin is read from `useCanManageJobs()`, the client's only permission signal.

Writes are real: every variant saves through `SettingsContext`.

## Run

```
cd frontend
PLAYWRIGHT_API_URL=<deployment api base> \
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<tailnet host> \
bunx vite --port 5180 --strictPort --host 127.0.0.1
tailscale serve --bg --https=5180 http://127.0.0.1:5180
```

Open `/workspace?tab=settings&variant=A` and log in; the pink bar (or ← →) switches variants.

## Not covered

- `payloadRetentionDays` and the bulk re-sync button have no row in A/B/C.
- The "moved to System" tools are listed, not mounted anywhere new.

## Round 3: one home (2026-10-11)

Variant A's tree now also holds everything `/settings` and `/admin` had:
Account (Profile, Password, Usage, Activity logs, Delete account) and, for
Admins, Admin (Users, Quotas, Configuration, Network telemetry, Database,
Query console, Import / export). Quick message joined Publishing. Bodies are the
production components, unchanged (`pages.tsx`).

Not prototyped, because routing is app-wide and variant 0 must stay main.
This is the work left to fold in:

- `/` serves the workspace; `/workspace`, `/settings`, `/admin` redirect into
  it (`/settings` → Account → Profile, `/admin` → Admin → Users). Keep the old
  paths as redirects: bookmarks, e2e specs, emails.
- Delete the template shell (`routes/_layout.tsx`, `AppSidebar`, the Dashboard,
  the "FastAPI Template" titles).
- Its `beforeLoad` does two things `_tg` does not: the **approval redirect**
  (a pending account on `/workspace` gets 403s today, not the pending page)
  and the awaited `syncServerClock`. Move both into `_tg`.
- `QuotaWarning` renders only in the template shell, so it never shows in the
  workspace today. Give it a place in the workspace header.
- The Admin section must use a real permission read, not `useCanManageJobs()`.
- e2e: `admin.spec.ts`, `user-settings.spec.ts` navigate to the old paths.
