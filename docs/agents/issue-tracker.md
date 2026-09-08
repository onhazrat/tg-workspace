# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

This repo has a GitHub remote and GitHub Issues is enabled, but issues are **not** tracked there.
Do not create GitHub issues; write files under `.scratch/` instead.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Ticket ids are prefixed, because bare numbers already collide

The filename keeps its `<NN>-<slug>.md` shape, so a directory listing still reads in dependency
order. The ticket's **id** is `<PREFIX>-<NN>`, where the prefix is a short uppercase tag for the
effort: `BYOK-01`, not `01`. Use that id in the ticket heading, in every `Blocked by` line, and in
any code comment or doc that cites the ticket.

This is not tidiness. Numbering restarts at `01` per effort, so four efforts currently own a
ticket `03` and the codebase carries roughly 1,400 bare `ticket NN` citations. Two of them sit in
adjacent modules: `settings_registry.py` says "Ticket 03's Directory refresh window", meaning
channel-directory, while `tenancy.py` says "ticket 03, plan step A2", meaning multi-user-tenancy.
Nothing in either comment says which.

Those existing citations are **not** being renumbered; there are too many and they resolve by
context. The rule applies to new efforts, so the ambiguity stops growing.

When citing another effort's ticket from new prose, spell the effort out — "multi-user-tenancy
ticket 33" — rather than inventing a retroactive prefix for an effort that never had one.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
