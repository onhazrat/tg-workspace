# DIR-03: Read a Channel in the Directory

**What to build:** Clicking a row opens a detail panel where the Account judges a Channel without
leaving the tab: its header, bio and counters, its recent Posts with their View counts and links,
and why it is in the list. See `.scratch/directory-tab/spec.md`: user stories 70 to 79, 100 and the panel half of 20, and
the implementation decisions on the detail and "Your channels".

**Blocked by:** DIR-02

**Status:** done

The prototype's panel (variant E on `prototype/directory-tab`, unchanged in variant T on
`prototype/directory-tab-bars`) shows the behaviour: the newest three
Posts with "Show N more", long Posts clamped to six lines with "Read more", links rendered as on
the Posts tab, hidden links as chips. Rewrite it rather than copying.

- [x] Clicking a row opens a panel (a click on the row's handle link opens Telegram instead) with the Channel's avatar, name, handle, counters, bio, Follow and a link to its public web view; the bio is read from the entry, never from the list
- [x] The panel opens when its Channel is not on the current page (a remembered or shared panel), reading what it needs by handle
- [x] The existing route that returns a Directory entry's samples also returns each sample's Links, the time it was captured, and whether it carries media, read from its media kinds rather than from the presence of a media block; the projection's own explanation of why it left those out is rewritten to say why they are in
- [x] The panel lists the Channel's stored samples newest first: the newest three until "Show N more", with "Show fewer" back; each long Post clamped until expanded; another Channel opens collapsed
- [x] Each Post shows its View count, and on hover when it was counted; Posts with media are marked; Posts with no text show as media only
- [x] Handles and addresses in a Post's text are links, through the same renderer the Posts tab uses; Links the text does not show are listed under the Post as links
- [x] Every link to a Channel or Post opens Telegram's public web view
- [x] "Why it's here" lists the Posts of the chosen "your channels" (every follow, the Channels tab selection, or the Channels ticked in the list) that cite this Channel, newest first, each with its Channel, kinds, age and text, inside the "Cited by your channels" Condition's window when one is set
- [x] The open panel is remembered in this browser
- [x] On a narrow screen the panel takes the whole screen
- [x] The Directory HTTP test module covers the samples route's new fields and "why it's here" for two Accounts with different selections, under each "your channels" value
- [x] Component render tests cover the sample list (collapsed, expanded, clamped, media only, hidden links), as the CRAP ratchet requires
- [x] The samples route's projection test asserts the new fields and still no field the panel does not use

## Comments

- 2026-10-06, implementer. Two routes beside the samples one: `GET /data/directory/{handle}/entry` (the row's measures plus the bio, 404 with the samples route's detail for anything the Directory does not list) and `POST /data/directory/why` (handle in the body, because View-as's read-only inventory matches literal paths only). "Why it's here" quotes the 20 newest citing Posts and returns the total. A citing Post's words come through the Follow seam (`posts.lookup_posts`), falling back to the probe's sample; a selection that names a Channel the Account does not follow lists the Reference with no words, rather than leaking another Account's corpus read.
- The "Cited by your channels" window now goes through one helper for the Condition and "Why it's here"; the Condition used to read the naive `now` through `.timestamp()`, which is off by the host's offset outside UTC.
- Measured on `app_staging_proto` (282 follows, the most-cited target, 5,672 citing Posts): entry 2 ms, "Why it's here" 18 ms (8 ms with a 14-day window), samples 1 ms.
- Not built here: the neighbours lists ("Cited most by", "Cites most") are DIR-05's; Dismiss in the panel is DIR-06's.
