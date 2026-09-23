# LANG-04: Translation skips Posts that need none

**What to build:** The Operator Key stops paying to translate English Posts into English and to
translate a captionless photo's placeholder text. The scheduled translation job and the on-demand
Translate button both skip Posts already in the Translation language and Posts with no words,
and both keep translating undetermined Posts, which is where Finglish and very short Posts land.
See `.scratch/language-detection/spec.md` and ADR-021.

Until LANG-03 lands, Posts stored before LANG-01 are unread, so the job waits on them. New Posts
are read on write and are unaffected.

**Blocked by:** LANG-01.

**Status:** ready-for-agent

- [ ] The translation job considers only Posts that have been read, skips `zxx` and Posts whose Language equals the Translation language's code, and keeps `und`
- [ ] The Translation language setting stays a name; a backend map from the offered names to codes serves the comparison, and a name missing from the map disables the skip rather than skipping everything
- [ ] A backend guard holds the backend map equal to the frontend's list of offered Translation languages, in both directions, and is mutation-tested
- [ ] The Translate button is hidden when a Post's Language is `zxx` or equals the Translation language's code, and shown otherwise, including for `und` and unread Posts
- [ ] Tests with a fake Provider cover: same-language and no-words Posts never reach it; undetermined Posts do; unread Posts wait; an unmapped Translation language translates as before
- [ ] Frontend unit tests cover the button's visibility rule for `zxx`, the same Language, `und` and unread
