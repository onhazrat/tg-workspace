# CTB-05: Follow many into a Setting group, and tag completion

**What to build:** Two input features for the new bar. **Follow** becomes a paste box: an Account
pastes any number of handles or t.me links, sees each marked "will follow", "already following" or
"not a handle", picks the Setting group the new Follows land in, and follows them in one click,
with progress. The bulk toolbar's add-tag and remove-tag fields complete an existing tag in ghost
text, so a typo stops creating a near-duplicate tag. They share a ticket because each is small and
both are input on the new bar; they touch different code. See
`.scratch/channels-top-bar/spec.md`, "Follow" and "Tags", and user stories 88 to 100.

**Blocked by:** CTB-04 (tag suggestions draw from the set the action limit gives)

**Status:** ready-for-agent

### Follow into a Setting group (backend)

- [ ] The bulk-follow request gains an optional `settingGroupId`. When present, every Follow the
      job creates lands in that Setting group; when absent, behaviour is exactly today's (the
      default Setting group), so Discover is unaffected
- [ ] It is checked against the caller's own Setting groups before the job starts: another
      Account's Setting group answers the same 404 an absent one does, and no Follow is created.
      This is a write door, so the ownership check is the ungated one
- [ ] `PUT /data/channels/{id}` keeps refusing a setting group, as it deliberately does today
- [ ] The generated client is regenerated

### The paste box

- [ ] Follow at the start of row 1 opens a box that takes handles and links separated by lines,
      spaces or commas. `@handle`, `t.me/handle` and `t.me/s/handle` all resolve through the
      existing handle normalizer, and duplicates collapse
- [ ] Each handle is marked "will follow", "already following" or "not a handle" (4 to 32
      letters, digits or underscores; a shape check only, the follow still asks Telegram)
- [ ] A Setting group picker defaults to the Account's default Setting group
- [ ] The button reads "Follow N" and is disabled at zero. Every follow from the box, one handle or
      many, goes through the bulk-follow job and its progress events, shown while it runs
- [ ] Today's single-handle field is gone

### Tag completion

- [ ] Add suggestions: every tag on the Account's Channels, most used first, without the tags
      every Channel in the action set already has. Remove suggestions: the tags on the action set,
      most common there first. The action set is what CTB-04's limit gives
- [ ] The best suggestion starting with what was typed (case-insensitive) is drawn in grey after
      the caret. Tab, or → with the caret at the end, accepts it; Enter submits what was typed
- [ ] A hint under the field says how many Channels carry the suggestion ("on 12 Channels, 3 of
      these"), or "no existing tag starts like this" when none does

### Tests

- [ ] Backend route tests: bulk follow with a `settingGroupId` lands every new Follow in it;
      another Account's Setting group answers 404 and creates nothing; no `settingGroupId` keeps
      today's behaviour. The account-isolation guard's probe for the route covers the new field.
      Prior art: the bulk-follow route tests and `test_account_isolation.py`
- [ ] Handle parsing: the three link forms, duplicates, the shape check, already-followed
      detection. Tag suggestions: ordering, skipping tags the whole action set has, remove drawn
      only from the action set
- [ ] Component tests: the paste box's statuses and count; the ghost completion accepting on Tab
      and on → at the end, and Enter submitting the typed text
- [ ] The Channels end-to-end spec gains following two Channels from a paste into a chosen
      Setting group, completing the spec's journey
- [ ] Every new test is watched failing before it is trusted
