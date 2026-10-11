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
