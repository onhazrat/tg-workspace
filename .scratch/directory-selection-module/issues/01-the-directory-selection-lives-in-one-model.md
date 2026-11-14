# DSM-01: The Directory selection lives in one model

**What to build:** A React-free model holds the Directory selection and what
Tick all became, and answers what the table shows as selected and what the
bulk bar says. The Directory hook becomes its adapter. The model exports a
read and a restore of the Directory selection for the Timeline. Nothing an
Account or an Operator sees or sends changes, and components still choose a
bulk action's target as they do today; that moves in DSM-02.

Spec: `.scratch/directory-selection-module/spec.md` (user stories 1 to 9, 12
to 15, 22, 23, 25, 26, 31). Glossary: Directory selection, All matching.
ADR-031 keeps every rule. Prior art: the Posts read module (ADR-036).

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A reducer and selectors live in their own file beside the Directory's view helpers and import no React, router, storage or query code. State is the selected entries and what Tick all became on which view (nothing, a snapshot, All matching).
- [ ] Events: a hand-made change (ends All matching); take all, which answers "hold the view" above 10,000 or "fetch the handles" below, then takes the fetched snapshot as a second event; the view changed; entries dismissed; restore.
- [ ] All matching ends on any view change and any hand-made change, and not on paging or the Show matches switch. A snapshot is added to the selection, and replaces it when adding would pass 10,000.
- [ ] Selectors answer what the table shows as selected (every row on the page under All matching) and what the bulk bar says: the offer, a snapshot or All matching, with the total.
- [ ] The five Tick all helpers move into the module and are no longer exported where a selector replaces them.
- [ ] The Directory hook holds the model in a reducer and stores the selected entries under the key used today. It keeps the URL and remembered view, the queries, toasts, the follow-in-progress set, the open panel, the unreadable-filter reset and the column resend rule.
- [ ] Restore puts back selected entries only and never holds All matching. A read sits beside it; both are exported for TML-01's Directory selection provider.
- [ ] `bun test` covers each event, both ending rules and both non-ending changes, the snapshot added and replacing, dismissed entries leaving, both selectors, and restore.
- [ ] The existing unit tests of the five helpers are rewritten against the model and the originals deleted.
- [ ] The Directory Playwright spec passes without an edit.
- [ ] Frontend unit tests, typecheck and biome pass; no backend, schema or generated-client file changes.
