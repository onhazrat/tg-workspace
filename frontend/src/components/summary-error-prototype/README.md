# Summary error and retry prototype (throwaway)

Question: when Generate fails and the Summary tab stays on the pending "Paste AI
Response" panel, how should it show the error and offer Retry?

Run: `cd frontend && PLAYWRIGHT_API_URL=<api-base> bun run dev --port 5193`, log in,
open a pending Summary, and add `&variant=A` (or B, C) to the URL. The floating bar
and the left/right keys cycle variants.

- `0` today's panel, unchanged (the reference).
- `A` today's panel with a red error banner and Retry above it.
- `B` the header says "Generation failed", Retry is primary, Paste secondary, prompt folded.
- `C` the error, then "Try again here" and "Use another AI" side by side.

Retry is stubbed: no request, no spend, no write. "Simulate failure" in the bar shows
a fake error on every pending Summary; "Next retry" picks the stub's outcome. A real
failed Generate in this session records its real reason and shows that instead.
Everything is in memory; a reload forgets it.

Not answered here, and the real build has to: persisting the error across reloads
(the failed LLM log row has it), telling a failed Generate from a Copy Prompt item,
and streaming the stored prompt back into the same pending Summary on Retry.

## Start failures (no pending Summary)

A Generate can fail before its pending Summary is kept: the server refuses to build
the prompt (413, too many posts or tokens), a sync fails, the network drops. The
provisional row is deleted, so the pending panel never exists and today only a toast
says why. Variants A-C show it on the empty Summary tab instead ("Summary not
started"), with Change selection as the primary way out. "Fake start failure" in
the bar triggers it; a real one from Generate in this tab is recorded too. Its
"Generate again" is stubbed.
