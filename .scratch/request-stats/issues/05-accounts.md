# RQS-05: Accounts and their comparison

**What to build:** The Operator picks Accounts to narrow the tab and, with two or more, compares them side by side. Spec: "The Requests tab".

**Prototype:** variant A on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d), the working reference for this behaviour; its README says how to run it. Port the behaviour, not the code: the prototype's data layer is synthetic (spec, Further Notes).

**Blocked by:** RQS-03

**Status:** ready-for-agent

- [x] An Accounts facet in the filter bar with each Account's charged Requests; picking any hides Uncharged Requests, and the footer says so.
- [x] Two or more Accounts show a comparison table in the violet ramp that doesn't clash with the kinds.
- [x] The Breakdown endpoint takes the Accounts.
- [x] Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
