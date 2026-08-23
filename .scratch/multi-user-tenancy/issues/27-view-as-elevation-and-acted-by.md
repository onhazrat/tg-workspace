# 27: View-as elevation and acted-by

**What to build:** An Owner can elevate a session to make a change on someone's behalf, and the record never claims that person asked for it.

**Blocked by:** 26

**Status:** ready-for-agent

- [ ] Elevation is explicit, separately recorded, and shorter-lived than the read-only session
- [ ] Elevation is refused when the target is an Admin
- [ ] Artifacts written during elevation record the acting Owner alongside the User
- [ ] The acting Owner is visible in that User's History
- [ ] A guard covers the refusal and the attribution
