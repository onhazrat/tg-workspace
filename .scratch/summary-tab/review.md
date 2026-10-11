# SUMTAB code review (SUMTAB-01 to 09, 2026-10-11)

Diff: `1f9e17d3...t3code/implement-sumtab-spec` at e7b42224. SUMTAB-10 was not merged yet and is not covered.

## Standards

Hard violations:

- `backend/app/services/publications.py::send_publication` holds a session open across `await send_parts(...)` (reads `ChatDestination`, publishing and network settings, then awaits Telegram). CLAUDE.md: "Never hold a session open across awaited work." The scheduler reaches it every tick. `send_parts` adds a settings read after decrypt too. Project to plain values and close before sending.
- `frontend/src/components/summary-view/publish-panel-model.ts` `MARKUP` hand-copies `network.py::TELEGRAM_MARKUP` with no guard. CLAUDE.md: "A fix applied to one of two twin modules is half a fix … guard the pair." Prefer the plan route returning parsed segments; otherwise guard the pair.

Correctness:

- `jobs/auto_summary.py::_auto_publish` logs `chat_id=""`, `chat_name=""` on the generic `except Exception` and on a refused foreign/absent bot, even when the destination resolved. The old code logged `dest.chat_id`, which publish-log search covers.
- `SummaryView.tsx` passes the browser zone to the header while published metadata uses the Account's `timeZone`; the two can disagree.
- `PublishPanel.tsx::PublishTarget` preselects a lone bot only on first render (`useState(p.bots.length === 1 ? …)`); a bots query answering after mount never preselects.
- `SummaryCitation.tsx::useCitationSheet` passes an inline `subscribe` to `useSyncExternalStore`, resubscribing every render, once per paragraph.

Smells (judgement calls):

- Duplicated Code: `cited-posts.ts` `refKey` equals `find-citation.ts` `citationKey`. "Narrow" is defined three times (`NARROW` 767px, `HOVER_WIDE` 768px, `useIsMobile`). The two publication route handlers repeat get-Summary-404-assert. Publishing settings load twice per send.
- Primitive Obsession: strip key `${c}_${id}` and Citation key `c#id` name the same Post, so `CoverageWall.channelOf` regex-parses both. `metadataRows` regex-parses the server's metadata string back into rows; the plan response could carry rows as data.
- Data Clumps: `include_metadata`/`metadata_in_first_part` travel separately though `PublicationOptions` exists. The four network values repeat across `publish_summary_text`, `send_parts` and callers.
- Divergent Change: `publish.py` owns `load_publishing_settings` while `PublishingSettings` lives in `publication_parts.py`.
- Mysterious Name: `GeneratingOverlay({...})` is PascalCase but called as a plain function in `App.tsx`.
- Duplicated work: `useCitationRenderer` runs the detail query, `useCitedPosts`, the media query and the workspace memo once per `<p>`/`<li>`; a context provider would do it once.

## Spec

Missing or partial:

- Tickets 06-09 say `Status: done` but their checkboxes are all `[ ]`.
- Spec line 319: the publish-log row should record how many Parts were sent; `send_publication` stores no sent count (SUMTAB-10's first box re-asks for this).

Implemented but wrong:

1. Stories 64 and 77, spec line 342: unticking a metadata row saves a frozen copy of the generated text into `metadataText` (`withRowToggled`), and `_regenerate_one` (`auto_summary.py:464`) copies `metadataText` onto every regenerated Summary, so scheduled Publications send the first Summary's range, Channels and count forever. The text also flips to "custom" whenever generated text changes. Fix: store row choices as a per-Summary list of row keys the backend applies to freshly generated metadata.
2. Spec lines 321-322 ("Citation style has nothing to act on there"): `publish_summary_text` applies the Account's `citation_style` to the quick message.
3. Spec line 306: `plan_publication` uses `extra.postCount or summary.post_count`, the header uses `scope.scopedPostCount`. Low confidence they differ.
4. Spec line 332 ("then only changed by the Account in Settings"): `hydrateAppSettings` refills from the browser whenever the saved zone is `""`, and the time-zone input saves every keystroke, so a half-typed zone falls back to UTC on the server.
5. Same as the `chat_id=""` regression above.

Scope creep:

- `PublishRequest` lost its raw `token` field and validator (defensible, nothing sent it; an API change).
- `deps.py` View-as inventories accept `{param}` templates, widening matching for every inventory; needs its own guard test.
- The quick message picked up link-preview suppression and the citation style; check the spec on whether link previews apply to it.

# SUMTAB-10 review (572fa333...b3e1605d)

## Standards

- Extends the session finding: `_deliver` holds the request session across `await send_parts(...)` (network settings before, `BotCredential` after), and `resume_publication` adds the `PublishLog` read before it. Both manual and scheduled sends go through it.
- Correctness: two concurrent resumes send the same Parts twice. `resume_publication` reads `partsSent` and sends with no claim. Claim the row first with a conditional `UPDATE ... WHERE partsSent = n RETURNING` and add a concurrent-resume test.
- Correctness: `PartFailed` carries only `sent` and drops the responses of the Parts that went out, so after a resume `full_response` holds 3 responses against 5 Parts.
- Smells: `partsSent` in untyped `full_request` JSON (acceptable, no migration); `_deliver` takes 10 keyword arguments; the service raises `HTTPException` 404/409 where its sibling raises domain exceptions the route maps; the route validates with a bare `assert` (stripped by `-O`); a JSDoc in `queryKeys.ts` sits above the wrong key.

## Spec

- The scheduler test runs `_auto_publish` once; nothing asserts that a second tick leaves the partial alone.
- A stop at Part 1 is plain `failed`, not partial (`0 < sent`). Decision: keep it; nothing was delivered, so a fresh Publish is the same act.
- Ticket 10's boxes are unticked too.

# Decisions for the fixer (lead, 2026-10-11)

- The header's range uses the Account's `timeZone` setting, falling back to the browser zone while it is empty, so the header and the published metadata agree.
- The quick message takes neither the citation style (spec lines 321-322); check the spec for link previews and follow it.
- Keep the `PublishRequest` token removal and the JSON `partsSent`.
- Tick the checkboxes of every ticket whose behaviour is implemented.
