# Directory: add pasted handles for a fetch

Status: ready-for-agent

Ticket prefix: `DADD`.

Settled in one grilling session on 2026-10-18. The decision record is
`docs/directory-add-handles-plan.md`; this spec is written from it. The
**Directory** definition in `CONTEXT.md` was widened in the same session to
include Channels an Operator has named.

## Problem Statement

The Operator finds Channels outside the app: a list someone posted, a
directory site, a thread of t.me links. The only way to get one of them into
the Directory today is to follow it, which adds Posts, syncs and a Setting
group the Operator never wanted, or to wait until some followed Channel
happens to reference it. The Directory fills only from Discovery reports and
the harvest sweep, so a list of 3,000 handles the Operator already holds can
never be fetched and compared with the rest of the Directory without
following all 3,000.

## Solution

The Directory tab gets an **Add to Directory** pill at the start of its bar,
shown only to an Operator holding `DATA_ADMIN`. It opens the same paste box
the Channels tab's Follow uses: handles or t.me links separated by lines,
spaces or commas, one row per handle, a row that is not a handle marked as
such. There is no Setting group to pick, because nothing is followed. One
click queues every handle for a fetch in its own band of the Directory's queue,
behind harvested handles and ahead of scheduled refreshes. The box answers
with three counts: how many were added, how many the Directory already held,
and how many were not handles. The new entries show in the Directory as
pending, which the Operator finds with the existing `status == unknown`
filter, and they fill in as the fetches land.

## User Stories

1. As the Operator holding `DATA_ADMIN`, I want an Add to Directory pill at the start of the Directory bar, so that adding handles sits where Follow sits on the Channels tab.
2. As an Account without `DATA_ADMIN`, I want no Add to Directory pill, so that I am not offered a button the server would refuse.
3. As the Operator, I want to paste handles separated by lines, spaces or commas, so that a list copied from anywhere works without editing.
4. As the Operator, I want `@handle`, `t.me/handle`, `https://t.me/handle` and `t.me/s/handle` all accepted, so that I can paste links as they appear on the web.
5. As the Operator, I want a handle repeated in the paste to count once, keeping its first spelling, so that a messy list does not inflate the counts.
6. As the Operator, I want each pasted handle listed with its fate before I click, so that I can see what the box understood.
7. As the Operator, I want a row that cannot be a public handle marked "not a handle", so that I can fix a typo before submitting.
8. As the Operator, I want the box to apply the same shape rule the server applies (a leading letter, 5 to 32 characters), so that the box and the result agree for every handle except a reserved path.
9. As the Operator, I want the submit button to name how many handles it will send and to be off when there are none, so that I never submit an empty paste.
10. As the Operator, I want to paste up to 100,000 handles in one go, so that a large external list takes one click.
11. As the Operator, I want a paste over 100,000 refused with a clear message, so that I know to split it.
12. As the Operator, I want added handles queued behind harvested handles and ahead of scheduled refreshes, so that my paste does not jump ahead of the Directory's own discoveries but beats re-fetching answers it already holds.
13. As the Operator, I want every handle in one paste to share one place in the queue, so that the order within a paste is predictable and alphabetical, as it is for harvested handles.
14. As the Operator, I want to raise or lower a paste's place with the existing Priority boost, so that I have one tool for reordering the queue rather than two.
15. As the Operator, I want a handle the Directory already has a verdict for left as it is, so that pasting a familiar list does not re-fetch thousands of answers.
16. As the Operator, I want a pending handle that is already queued to keep its better place, so that pasting it again never pushes it back.
17. As the Operator, I want to see "N added, M already in the Directory, K not handles" after the click, so that I know what happened without counting rows.
18. As the Operator, I want the server's count of "not handles" to include reserved paths such as `joinchat` or `addstickers`, so that a link to one of those is reported rather than queued.
19. As the Operator, I want the Directory list and its count to refresh after the add, so that the new pending entries appear without a reload.
20. As the Operator, I want to find what I added through the existing `status == unknown` filter, so that I need no new view.
21. As the Operator, I want an added entry to fill in with metadata, a followability verdict and a sample once its fetch lands, as any Directory entry does.
22. As the Operator, I want a failed add (offline, refused) to keep my paste in the box, so that I do not lose a long list.
23. As the Operator, I want nothing I add to be followed, so that adding to the Directory never costs Posts, syncs or a Setting group.
24. As an Owner in a View-as session, I want the add refused, as every other Directory write is, so that a View-as session cannot spend the deployment's proxies.
25. As an Account using the Channels tab's Follow box, I want it to behave exactly as before, except that a handle Telegram cannot have (a leading digit, four characters) is now marked "not a handle" instead of "will follow".
26. As the Operator, I want added handles fetched on the deployment's proxies and charged to no Account's Telegram Budget, as every other Directory fetch is.
27. As a mobile Operator, I want the paste box to fit the phone layout the Follow box already fits.

## Implementation Decisions

- **Permission.** The add is gated on `DATA_ADMIN`, the same gate as the Priority boost and the column defaults. It is a write, so View-as refuses it with no inventory entry.
- **A new queue band.** A new constant, `NAMED_PRIORITY = 1_750_000`, sits between the harvest band (1,500,000) and the refresh band (2,000,000), with the argument for its place written beside the other bands. The whole paste gets that one value rather than a rank by paste order, so the drain falls through to the handle tiebreak.
- **The Directory queue's enqueue must hold 100,000 handles.** The existing function filters with one bind parameter per handle and fails past Postgres's 65,535 limit, and it builds one ORM object per new row. It moves to an array comparison (the pattern the Directory reads already use) and one `INSERT ... ON CONFLICT DO NOTHING` for new rows. Its contract is unchanged for the report and harvest callers: the same return value (how many were queued), a conclusive verdict skipped, a pending row's rank only ever improved.
- **A new route**, `POST /data/directory/add`, in the Directory route module. Request: `handles`, a list of strings, at most 100,000. Response: `added`, `alreadyInDirectory`, `invalid`. The server normalises each handle and checks it with the existing public-handle check (shape plus reserved paths), which is the authority; the client check is a hint. Invalid handles never reach the queue.
- **The client follows the generated-client rule.** The response is a closed model with required fields, so the call goes through the generated client; regenerate it.
- **Paste parsing is shared.** The parser takes a generic set of known handles and marks a member `"known"` rather than `"following"`. Its handle rule becomes the server's (a leading letter, 5 to 32 characters). Reserved paths stay server-only, because a second copy of that list would drift; they come back in `invalid`.
- **The paste box is shared.** A `HandlePasteBox` is extracted from the Follow box: the textarea, the parsed rows, the submit button, and a slot for extra controls. The Follow box becomes a wrapper that fills the slot with its Setting group select. The Directory's box passes no known set, so its rows read only "will add" or "not a handle".
- **No lookup while typing.** The Directory holds close to a million entries, so the box cannot know which are already there; the server's counts answer that after the click.
- **After a successful add**, the Directory list and count queries are invalidated and the box shows the three counts. A failed add keeps the paste.

## Testing Decisions

- A good test asserts what an Operator or a caller can observe: the rows the Directory holds, the order the queue would drain them in, the counts the route answers, the rows the box shows. Not which SQL statement ran or which helper was called.
- **Backend, one seam: the route.** Through the test client: a paste of new, known, pending and invalid handles answers the right three counts and stores only the new ones as pending; a held verdict is unchanged; a pending handle's rank only improves; the new band drains after a harvested handle and before a refresh-due one; a 70,000-handle paste succeeds (past the bind limit); 100,001 is refused; reserved paths count as invalid; an Account without `DATA_ADMIN` is refused. Prior art: the Priority boost route test and the probe-queue route test in `backend/tests/api/`.
- The guards that inventory routes (route inventory, account isolation, View-as, permission checks) must accept the new route; update their inventories rather than excusing it.
- **Frontend.** The paste parser's existing unit test gains the tightened rule (leading digit, four characters, the 32-character edge) and the known status. A render test for the Directory's Add box with the request mocked covers the counts, the disabled empty state and a failed add keeping the paste; the CRAP ratchet requires it. Prior art: the Directory boost component test. The Follow box's existing tests must stay green unchanged, apart from cases the tightened rule now marks invalid.

## Out of Scope

- Following any added handle. The Directory's bulk Follow already acts on ticked entries.
- Labelling each row "already in the Directory" while typing.
- Recording that an entry was added by an Operator, or a "just added" view.
- Re-fetching entries the Directory already holds; Refresh does that.
- Opening the add to Accounts without `DATA_ADMIN`.
- Copying the reserved-path list to the client.

## Further Notes

- Pending and unfetched entries are already listed only to a `DATA_ADMIN` reader (DPF), which is the same reader who can add them, so no visibility rule changes.
- On staging the first harvest pass is long finished and a caught-up harvest tick queues almost nothing, so in practice nothing waits ahead of a paste.
