# DIR-03: Read a Channel in the Directory

**What to build:** Clicking a row opens a detail panel where the Account judges a Channel without
leaving the tab: its header, bio and counters, its recent Posts with their View counts and links,
and why it is in the list. See `.scratch/directory-tab/spec.md`: user stories 57 to 66, 87 and the panel half of 17, and the
implementation decision on the detail.

**Blocked by:** DIR-02

**Status:** ready-for-agent

The prototype's panel (variant E on `prototype/directory-tab`) shows the behaviour: the newest three
Posts with "Show N more", long Posts clamped to six lines with "Read more", links rendered as on
the Posts tab, hidden links as chips. Rewrite it rather than copying.

- [ ] Clicking a row opens a panel with the Channel's avatar, name, handle, counters, bio, Follow and a link to its public web view; the bio is read from the entry, never from the list
- [ ] The panel opens when its Channel is not on the current page (a remembered or shared panel), reading what it needs by handle
- [ ] The existing route that returns a Directory entry's samples also returns each sample's Links, the time it was captured, and whether it carries media, read from its media kinds rather than from the presence of a media block; the projection's own explanation of why it left those out is rewritten to say why they are in
- [ ] The panel lists the Channel's stored samples newest first: the newest three until "Show N more", with "Show fewer" back; each long Post clamped until expanded; another Channel opens collapsed
- [ ] Each Post shows its View count, and on hover when it was counted; Posts with media are marked; Posts with no text show as media only
- [ ] Handles and addresses in a Post's text are links, through the same renderer the Posts tab uses; Links the text does not show are listed under the Post as links
- [ ] Every link to a Channel or Post opens Telegram's public web view
- [ ] "Why it's here" lists the Posts of the selected Channels that cite this Channel, newest first, each with its Channel, kinds, age and text
- [ ] The open panel is remembered in this browser
- [ ] On a narrow screen the panel takes the whole screen
- [ ] The Directory HTTP test module covers the samples route's new fields and "why it's here" for two Accounts with different selections
- [ ] Component render tests cover the sample list (collapsed, expanded, clamped, media only, hidden links), as the CRAP ratchet requires
- [ ] The samples route's projection test asserts the new fields and still no field the panel does not use
