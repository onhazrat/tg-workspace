# PROTOTYPE: complete window (ADR-043). Never merge.

Question: what should ADR-043's Incomplete Channels look like on the five
surfaces it names? One design left, D, switched against main with `?variant=`
and the bottom bar (arrow keys too). Variant 0 is main. The gate syncs by itself
after 30 s unless the person chooses first or edits its list.

| Variant | Before any Action | Action and Posts tabs | History | Summary, Chat, Tag and Discover tabs |
| --- | --- | --- | --- | --- |
| D | Centered dialog, Enter syncs, rows grouped by what a sync fixes | The Artifact banner itself, on the live window; Details opens with routine lag switched off (green line when Complete) | Pill, slate when no sync could help; hover or tap shows the breakdown | One-line banner: what is unproven, today's re-check, Regenerate, Details |

Everything is real. The check runs against the deployment's data through
`backend/scripts/proto_complete_window_api.py`. Every Action row button that
freezes a Scope goes through the gate (Generate summary, Copy summary prompt,
Start a chat, Generate tags, Copy tag prompt, Generate report), then the action
runs for real on your account: syncs spend your Budget, and Summary, Chat and
Tags spend your AI Key. Each pass is written to the scratch schema's
`complete_window_runs`, and main's own pre-Summary and pre-Chat syncs stand
down while a gated action runs, so a skip stays a skip. The gate offers a third
way on: "Continue with N complete only" drops the Incomplete Channels from the
Channel selection (Undo in the toast) and runs on the rest, so the Artifact's
window is Complete and its panel names what was left out. Every Artifact kind (Summary, Chat, Tag run, Discovery report) shows
its panel on its own tab and its mark in History. One made through the gate
shows the gate's record: the latest run of its kind before it, with no other
of that kind between. Older ones are reconstructed from Posts' `retrieved_at`,
gaps' `confirmed_at` and the sync logs, up to their creation.

Every surface measures an Incomplete window in what it lacks ("6 failed · 18
holes · last 17 h on 323"), not in Channels. A Channel only behind (not synced
to the end, syncable, and within two of its own sync intervals) is routine:
the chip counts it apart; past that it is overdue. One Telegram will not
serve on the web view is one no sync can fix. A skip of a Channel only behind
reads as lag ("last 9 min on 3, all skipped"). The chip counts routine lag apart, the gate folds
it into one line, and every list groups the rest by whether a sync can fix
it. With nothing fixable the gate asks nothing. An Artifact's banner checks its
window again now and offers "Regenerate on this window", which restores that
Scope and runs the same action through the gate.

The timeline has a tab of its own, Coverage (offered by "+"): "Open in a tab"
in any banner's Details opens it for the current Scope or
for that Artifact as it froze.

Run: the `cw-proto-api` and `cw-frontend` entries in `.claude/launch.json`,
the tunnel loop, and `tailscale serve --bg --https=5207 http://127.0.0.1:5207`.

Dropped on 2026-10-29: C (side sheet, footnotes), then B (inline preflight,
coverage bars); A took B's reason breakdown and timeline first. Dropped on
2026-10-30: A (a chip with a popover list on the Action and Posts tabs), in
favour of D, which puts the Artifact banner there.

Verdict: D (2026-10-30), grilled into ADR-043 and
`.scratch/complete-window/spec.md`; this prototype matches the grilled
decisions except where the spec says otherwise.
