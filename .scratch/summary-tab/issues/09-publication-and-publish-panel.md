# SUMTAB-09: Publication plan, send and the publish panel

**What to build:** Publishing from a Summary becomes a Publication planned and sent by the server.
The new publish panel, at the end of the Summary, puts the bot and destination pickers and the
Publish button first ("Publish 2 messages to News Desk"), then the send-metadata switch (saved per
Summary, off by default) with its row checklist showing each row's value, the "in the first Part
when it fits" option and edit-as-text with reset to generated, then a preview of the exact Parts the
server's plan returns, each with its length against Telegram's limit. The panel shows the Account's
citation style and link-preview choice with a link to Settings. The header's old publish controls,
the old metadata panel, the character-count hint and the browser's metadata generator are removed.
See `.scratch/summary-tab/spec.md`, user stories 45-48, 62-66, 72 and 74-75, "Publications
(backend)" and "The publish panel" under Implementation Decisions.

**Blocked by:** SUMTAB-08 (the settings and metadata generator the plan uses).

**Status:** done

### Routes

- [ ] `POST /summaries/{id}/publication/plan` returns the Parts (kind, text, parsed length, cut flag) and the generated default metadata, given whether to include metadata and whether to put it in the first Part; it is declared a view-as read-only path
- [ ] `POST /summaries/{id}/publication` plans and sends to the chosen bot and destination, one Telegram request per Part in order; it is a view-as spend path
- [ ] Both are owner-scoped by Summary id with their family's own 404 detail, and the bot credential is checked against the caller before it is decrypted
- [ ] One publish-log row per Publication, recording every Part's planned text
- [ ] Send metadata defaults to off for every Summary, existing ones included; the scheduler follows it
- [ ] The account-isolation probe and the view-as inventories list both routes; the generated client is regenerated

### Panel

- [ ] Pickers and the Publish button first; the button names the Part count and destination
- [ ] The metadata switch, row checklist with values, first-Part option, and edit-as-text with reset to generated, all saving as today's metadata does
- [ ] The preview renders the plan's Parts as Telegram shows them, refreshing when the options or metadata change
- [ ] The old header publish controls, metadata panel, length hint and browser metadata generator are gone

### Tests

- [ ] Route-level tests cover planning, sending, the publish-log row, refusing a foreign Summary or bot as absent before any decrypt, and the metadata default
- [ ] A rendered Summary test covers a panel that renders whatever Parts the plan returns and sends with the chosen options
- [ ] Any Playwright mocks of the publish routes are updated
