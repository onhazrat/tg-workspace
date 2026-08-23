# 26: View as, read-only

**What to build:** An Owner can look at the app exactly as a given User sees it, to reproduce a reported problem, without being able to change anything.

**Blocked by:** 07, 21

**Status:** ready-for-agent

- [ ] An exchange returns a short-lived session naming both the target and the acting Owner
- [ ] Every write is refused during the session
- [ ] An unmissable ribbon names the account being viewed and survives a reload
- [ ] The session expires on its own
- [ ] Sessions are recorded with who, whom, and when
- [ ] Viewing as another holder of the permission is refused
- [ ] A deleted target produces a clear error and returns the Owner to their own account
