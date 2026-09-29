# PFB-01: The Scope takes its new shape, nothing changes for the Account

**What to build:** The Scope's filter half moves to the shape the filter bar needs, and every
reader and writer of it moves with it, without any change an Account can see. Media becomes a set
of kinds, the order and grouping become two fields, the per-channel cap mode is renamed to say it
follows the order, and the Scope gains an empty Language set. Every Artifact and scheduled Summary
stored before the change reads exactly as it did. Today's filter panel keeps working on the new
shape. This is the prefactor that makes PFB-02 and PFB-03 easy: it is the only ticket that changes
the one shape shared by the feed, the counts, every Action, every frozen Scope and the generated
client, so it lands alone and green. See `.scratch/post-filter-bar/spec.md`, "Scope fields",
"Persistence and commands", and user stories 61, 62 and 64.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

### The shape

- [ ] The Scope's filter half, and so the feed request, the Action submission and the frozen Scope, carries these fields (shape settled in the prototype and the grilling):

  ```
  languages:            string[]              # empty = any Language; no filter yet
  media:                MediaKind[]           # empty = any; a Post matches ANY kind
  sort:                 "newest" | "oldest"
  group_by_channel:     bool
  max_per_channel_mode: "ordered" | "random"  # was "latest" | "random"
  ```

- [ ] A value this server does not implement is still refused with a 422 rather than dropped, for every one of these fields
- [ ] Values stored in the old shape are mapped when read: `media: "all"` reads as `[]`, a single kind as `[kind]`, `"latest"` as `"ordered"`, `sort: "time"` as `"newest"`, and `sort: "channel_time"` as `"newest"` with `group_by_channel: true`
- [ ] The old shape is also accepted on the way in for one release, mapped the same way, so a browser still running the previous bundle keeps working until it reloads

### Behaviour preserved

- [ ] With `sort: "newest"` and no grouping the feed returns exactly what `sort: "time"` returned; grouped, exactly what `channel_time` returned (channels alphabetical, newest first inside). Grouping's new block placement is PFB-02's, not this ticket's
- [ ] `ordered` keeps each channel's newest N under `newest`, exactly as `latest` did; `random` is unchanged, pages without repeats and keeps its seed
- [ ] A media set of one kind filters exactly as that single value did; the empty set filters nothing. A set of several kinds matches a Post matching any of them (the panel cannot send one yet; the server already answers it)
- [ ] `oldest` orders oldest first with the same stable tiebreak; nothing in today's panel sends it yet
- [ ] The per-channel counts, the prompt path's selection-size check and its assembled Posts, Discover's candidates and every scheduled Summary give the same answers as before for the same choices
- [ ] Semantic results pass through the browser pipeline under the new shape with the same results as before

### Everything that reads or writes the Scope

- [ ] The feed, the counts, the prompt path, Discover, scheduled Summaries, restoring an Artifact's Scope, the History list's Scope display and the palette's post-filter commands all speak the new shape
- [ ] The browser keeps post filters where it keeps them today, the per-account scoped storage, one key each. A stored single media value or old sort value is read into the new shape once
- [ ] The generated client is regenerated and the hand-written types still conform
- [ ] Today's panel writes the new shape: its media chip writes a one-kind set, "By channel" writes `newest` with grouping on

### Tests

- [ ] The feed over HTTP: each old wire value and its new equivalent return the same Posts; unknown values are 422s. Prior art: the existing feed, pagination and tenancy-scoping tests
- [ ] The Scope record: an Action submitted with every field comes back with the same values on its Artifact's frozen Scope, for every Artifact family; a row stored in the old shape reads back mapped. Prior art: the frozen-scope tests, including "every filter a caller can submit survives into the record"
- [ ] The prompt path assembles the same Posts in the same order under the new shape. Prior art: the prompt-assembly tests
- [ ] The browser pipeline gives the same semantic results under the new shape. Prior art: the post-view pipeline tests
- [ ] Every new or changed test is watched failing before it is trusted
