# DSM-03: The Directory list request is built by one pure function

**What to build:** What the Directory tab asks the server for is built in one
place from the view, the filter and the Directory selection: the Seed sets,
"your channels", the view request and the list body. The Directory hook runs
the query that function describes. Every request sent is the one sent today.

Spec: `.scratch/directory-selection-module/spec.md` (user stories 16 to 18,
28, 32). Glossary: Directory selection, Seed. Prior art: the Posts read
module's read builder (ADR-036).

**Blocked by:** DSM-01. It does not need DSM-02, but both rewrite parts of
the Directory hook, so run them one after the other.

**Status:** ready-for-agent

- [ ] One pure function, in the module DSM-01 made, builds the Seed sets, "your channels", the view request and the list body from the view, the filter, the Directory selection, the Channel selection, the followed Channels and Selected first. It imports no React, router, storage or query code.
- [ ] The Directory hook builds none of these itself and runs the query the function describes. The column resend rule stays in the hook and adds the columns to the body as it does today.
- [ ] A Shared parent or Shared child Condition that reads the Directory selection is re-resolved from the current selection on every read.
- [ ] Selected first is sent with the current Directory selection, and Show matches only while searching.
- [ ] A Follow from the Directory still records the view's "your channels" and Reference kinds as its source.
- [ ] `bun test` covers Seeds re-resolved after a selection change, Selected first with and without a selection, Show matches with and without a search, and Follow's source.
- [ ] The Directory Playwright spec keeps every case. The selected-Seed case loses its request-body assertions to `bun test` and keeps one assertion that selecting a Seed sends a new list read. No request body the spec records changes.
- [ ] Frontend unit tests, typecheck, biome and the Directory Playwright spec pass; no backend, schema or generated-client file changes.
