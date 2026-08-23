# 28: Admin-scoped export

**What to build:** An Admin can export one User's data or everyone's, and an exported Summary still cites Posts the export contains.

**Blocked by:** 21

**Status:** ready-for-agent

- [ ] Export is Admin-only and takes a subject
- [ ] It covers the subject's Follows, Artifacts, and settings
- [ ] It includes the Posts of Channels the subject Follows
- [ ] It streams, and reports the row count before starting
- [ ] Import routes Channel creation through the Follow path
