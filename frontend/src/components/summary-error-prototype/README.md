# Summary error and retry prototype (throwaway)

Question: when Generate fails and the Summary tab stays on the pending "Paste AI
Response" panel, how should it show the error and offer Retry?

Run: `cd frontend && PLAYWRIGHT_API_URL=<api-base> bun run dev --port 5193`, log in,
open a pending Summary, and add `&variant=C` to the URL. The floating bar
and the left/right keys cycle variants.

- `0` today's panel, unchanged (the reference).
- `C` the finished report's layout: "Analysis Report" header with a Failed chip and a
  Copy prompt icon, the Scope and provenance lines, the latest error with earlier
  attempts folded, then "Try again" (model + Retry) and "Use another AI" (Copy prompt,
  Paste response) cards, side by side on desktop and stacked full-width on phones.

A (banner over today's panel) and B (one Try again card, Paste as a header icon) were
dropped after review; they are in this branch's history.

C reuses the report's patterns on purpose: `summaryScopeLine`, the icon-action header,
chevron folds like its sections, cards like Publish to Telegram, and the Scope line
with "Use this Scope" at the bottom.

Every Retry has Key and Model chips like the Action tab's "Run with" bar. The model
list is the chosen Key's own catalogue (`useAiModels(keyId)` and a `keyId` prop on
`ModelCombo`, both prototype additions), so another Key's models are reachable.
Switching Key restores the model last run on it. Both start at the last attempt's
Key and model and never change the Action tab's selection or a Key's remembered model.
Each failure is kept with its attempt number, model, Key and time.

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
says why. Variant C shows it on the empty Summary tab instead ("Summary not
started"), with Change selection as the primary way out. "Fake start failure" in
the bar triggers it; a real one from Generate in this tab is recorded too. Its
"Generate again" is stubbed.
