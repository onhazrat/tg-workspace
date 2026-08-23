# 02: Clear the browser on logout

**What to build:** Logging out leaves nothing behind on a shared machine. Stored preferences are namespaced per account, so signing in as someone else never inherits the previous person's selection, filters, or settings.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Logging out clears the cached server state as well as the token
- [ ] Stored preferences are namespaced by the account identifier taken from the session token
- [ ] The token and the theme preference remain device-scoped, with the reason recorded
- [ ] Existing unnamespaced values migrate once on first read under a new namespace
- [ ] A guard asserts only the storage module, theme provider, transport, and auth hook touch browser storage
