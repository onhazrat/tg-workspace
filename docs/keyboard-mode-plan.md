# One Keyboard mode: plan

Decision record: `docs/migration/ADR-034-one-keyboard-mode.md`. Spec:
`.scratch/keyboard-mode/spec.md`. Prototype: variant H on
[`prototype/directory-photo-viewer` @ a6aa1eb6](https://github.com/onhazrat/tg-workspace/tree/a6aa1eb6ecbef4886a48817d6228344d6ed64778). Glossary: **Keyboard mode**,
**Highlight** and the widened **Tick** in `CONTEXT.md`.

## Three tickets, in order

The five PRs first planned became three tickets, to keep implementation and
testing overhead low (`.scratch/keyboard-mode/issues/`): KM-01 is PR 1 below;
KM-02 is PRs 2 and 3 with the announcer and Esc in Posts from PR 5; KM-03 is
PR 4 with the rest of PR 5. The PR descriptions are kept as the inventory.

1. **The Directory photo viewer.** The Directory's avatars (rows and panel)
   open the photo viewer, the panel's photo as a gallery of its own. Carries
   the viewer's keys for every viewer (`p` opens and closes it, `h` / `l` step
   photos) and the three fixes the prototype found: the viewer starts at the
   photo clicked, not the first with its address (a row and its panel share
   one); the photo button never shrinks in a flex row; a key a dialog already
   took (Escape closing it) is the dialog's.
2. **One Keyboard mode.** The one key list and one engine every list plugs
   into (Posts, Channels, the Directory), keys read by position, the header
   switch and `\`, the three steps of `?` and of the shortcuts button, the
   Highlight kept across a tab switch, `-` / `+`, `c` (the Channel spotlight,
   from Channels too), `m` / `M`, `/` to search and Esc to leave a field, and
   each control's key in its tooltip.
3. **Go-to.** `g` then a letter from every tab, `gt` / `gT` with vim counts,
   `gx` / `gX`, counts on moves (`5j`, `37G`), and the keys a waiting `g` or
   count leads to, shown just above the corner.
4. **Discover and History.** Both plug into the engine: a Discovery report's
   Candidates (`x` `f` `d` `o`, Enter for Details) and History's Artifacts
   (Enter opens, `*` stars, `n` notes; delete stays on the mouse).
5. **Acting on many.** `J` / `K` tick, select or Pick while moving, following
   the last `x`; `F` / `D` act on everything ticked through the bulk bar's own
   buttons; a toast with Undo for `d` and `*`; Esc drops the Posts Highlight;
   each move said to a screen reader through a polite live region; one look
   for a ticked entry, a ticked Candidate and a selected Channel.

## Settled

| # | Decision |
|---|---|
| 1 | Five PRs, then (2026-10-22) three tickets, as above |
| 2 | ADR-034, before PR 2 |
| 3 | `x` says each tab's word: Tick (Directory, Discovery report), select (Channels), Pick (Posts) |
| 4 | Keyboard mode and Highlight join the glossary |
| 5 | Keys by physical position, so a Persian layout works |
| 6 | Keyboard mode lasts the browser session; the old per-tab flags are dropped |
| 7 | Screen readers: a polite live region, not `aria-activedescendant` |
| 8 | Toasts only for `d` and `*` |
| 9 | Discover's Details panel stays modal; a side panel is a follow-up |
| 10 | Tests: one table of key sequences (the Shift keydown included) for the engine, a render test per new component, one Playwright spec for the Directory viewer |
| 11 | A Discovery report's marked Candidates are Ticks |
| 12 | `/to-spec`, then `/to-tickets`, one ticket per PR |
| 13 | One keyboard engine, built in PR 2 |
| 14 | The viewer's keys ship in PR 1 |
| 15 | Each control's key shows in its tooltip in Keyboard mode |
| 16 | No feature flag: Keyboard mode starts off |
| 17 | The prototype is kept as a sanitized single commit on `prototype/directory-photo-viewer` |
| 18 | The photo viewer is its own context: `h` / `l` / `p` there |
| 19 | Every printable key by position; Esc, Enter and the arrows as they are |

## Follow-ups, not in these PRs

- Discover's Details panel as a side panel that follows the Highlight.
- The Highlight coming back for an item not loaded yet (Channels sorted by
  Last updated).
- `aria-activedescendant`, if the live region proves too little.
