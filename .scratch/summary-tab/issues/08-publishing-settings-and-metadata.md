# SUMTAB-08: Publishing settings and one metadata generator

**What to build:** Three new per-Account settings appear under Publishing in Settings: citation
style (as written, by Channel name, or numbered), link previews (off by default), and time zone
(filled from the browser's zone the first time, then only changed in Settings). Every send applies
them, scheduled ones included: Citations take the chosen style (numbered ones share one numbering
across metadata and prose), each Part goes out with link previews disabled unless the Account turned
them on, and the default metadata, now generated only by the backend, names the time range in the
Account's zone ("Oct 7, 2026, 9:27 AM – 12:27 PM (Asia/Tehran, GMT+3:30) · 3h"). See
`.scratch/summary-tab/spec.md`, user stories 57-61, 67-68 and 77-78, "Publications (backend)" and
"Per-Account settings" under Implementation Decisions.

**Blocked by:** SUMTAB-07 (the Part builder these options feed).

**Status:** done

- [ ] Citation style, link previews and time zone are personal settings, each classified in the settings registry, and editable in Settings
- [ ] The time zone is filled from the browser's IANA zone only while it is empty
- [ ] The Part builder applies the citation style; links use the deployment's Telegram web base URL; numbered Citations share one numbering across metadata and prose
- [ ] Each Part is sent with `link_preview_options.is_disabled` unless the Account's link-preview setting is on
- [ ] The backend is the only generator of the default metadata (time range in the Account's zone with the zone named, Channels used, Channel list, AI model, Posts analyzed as the Covered Post count); the scheduler uses it
- [ ] Route-level tests cover each citation style, link previews off and on, and the metadata in the Account's zone; the settings guard passes for the three new keys
