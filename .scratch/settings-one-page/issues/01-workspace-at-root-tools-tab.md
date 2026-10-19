# SET-01: Workspace at `/`, a Tools tab, one segmented control

**What to build:** The prefactor that makes the Settings work easy. Before
SET-01 the workspace lives at `/workspace` inside a template shell, the
Settings tab mixes tools in with Settings, and two segmented-control looks
compete. After it:

- An Account opens the app at `/` and lands in the workspace.
- `/workspace` and `/summarizer` redirect there keeping their query string.
  For now, `/settings` and `/admin` redirect to the workspace's Settings tab;
  SET-02 points them at their topics.
- A pending Account opening the app sees the pending-approval page, not a wall
  of refusals.
- The quota warning shows inside the workspace.
- A Tools tab (closable, open at most once) holds Logs and Quick message for
  every Account. It also holds Network telemetry, Table sizes, Import / export
  and Query console for Accounts with the Permission each one needs. These
  leave the Settings tab's tree.
- The workspace has one quiet, sentence-case segmented control and one table
  look, both taken from the Directory.

Spec: `.scratch/settings-one-page/spec.md` (stories 71–76, 78–79). Plan:
`docs/settings-registry-plan.md` (decisions 8, 9). Reference implementation:
branch [`prototype/settings-one-page` @ 2b81adbd](https://github.com/onhazrat/tg-workspace/tree/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af). Its routing commit and its shared
primitives are production-ready; its `settings-prototype` folder is not part of
this ticket.

**Context pointers:**

- Prototype routing, port as is: [_tg.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/routes/_tg.tsx) (clock sync and approval redirect), the redirect routes [workspace.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/routes/_tg/workspace.tsx), [settings.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/routes/_tg/settings.tsx), [admin.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/routes/_tg/admin.tsx), [summarizer.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/routes/_tg/summarizer.tsx), and [__root.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/routes/__root.tsx). Every `/_tg/workspace` route id and `to: "/workspace"` became `/`.
- Prototype Tools tab: [ToolsTab.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/components/settings-prototype/ToolsTab.tsx), and the tab entry it needs in the workspace tab list.
- Shared primitives, port as is with their test: [tg-inline-segments.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/components/ui/tg-inline-segments.tsx), [tg-inline-segments.test.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/components/ui/tg-inline-segments.test.tsx), [tg-table-card.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/components/ui/tg-table-card.tsx); their use in the Directory bar and table, the Action tab's Chat and Tag rows, the Posts filter and the Analysis window control on the same commit. Discover's filter bar and Summary's reading controls are not done there.
- The guards this ticket trips: the View-as ribbon test in the architecture invariants (it read the deleted layout route) and the CSS and focus-reveal invariants.
- Prior art for the e2e: the workspace-tabs and settings-sections specs.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] The workspace route is `/`; `/workspace` and `/summarizer` redirect with the query string kept; `/settings` and `/admin` redirect into the Settings tab.
- [ ] The template shell is deleted: its layout route, sidebar, dashboard and the template's own `/settings` and `/admin` pages. Profile, Password, Usage, Delete account, Users and Quotas stay reachable from the Settings tab as they are today until SET-03, mounted there if they were only on the deleted pages.
- [ ] The workspace's route guard awaits the server-clock sync and sends a pending Account to the pending-approval page, as the deleted shell did.
- [ ] The quota warning renders in the workspace.
- [ ] Sign out is reachable from the workspace, since the template sidebar that held it is gone.
- [ ] A Tools tab exists with Logs and Quick message for everyone and the four data tools behind their Permissions; the Settings tab no longer lists them.
- [ ] Shared inline segments (multi-select and single choice, disabled options supported) and a shared table card exist as workspace UI primitives. The Directory search fields and table, the Action tab's mode switches, the Posts search mode, the Analysis window's two switches, Discover's filter bar and Summary's reading controls use them. The Action-only switch class is deleted.
- [ ] The View-as ribbon still subtracts its height from the full-viewport root (its architecture guard updated, not removed).
- [ ] Playwright specs that navigate to the old paths are updated; a spec covers the four redirects and the Tools tab.
- [ ] Unit suite, both typechecks, lint, the backend suite and the CRAP ratchet pass; the new primitives have their small render tests.

## Comments

- 2026-10-19: implemented on `set-01-workspace-root` and merged into the integration branch `settings-one-page` in c79e4670.
  Open: gated tools appear when their first read succeeds (one 403 per gated read for a plain Account), because `/users/me` carries no permission set; old `?section=<tool>` links fall back to Commonly Used instead of opening Tools.
