# 21: Enable enforcement and prove isolation (integrate)

**What to build:** Two real accounts genuinely cannot see each other. This is the acceptance gate for the whole tenancy programme.

**Blocked by:** 15, 16, 17, 18, 19, 20, 30, 32, 34, 35

**Status:** ready-for-agent

- [ ] Owner columns are non-null with real cascading keys, added without exclusive locks on large tables
- [ ] An isolation test parametrised over the whole mounted route inventory passes for two accounts
- [ ] Another account's row returns not-found on read, update, and delete
- [ ] Deleting an account cascades its rows while shared Channels and Posts survive
- [ ] The single-operator helper and its null-owner fallback are deleted
- [ ] Two existing tests encoding single-operator behaviour are inverted, not deleted
- [ ] The suite is green with enforcement both off and on

## Note added by ticket 16

**30 is a real blocker, not a nice-to-have.** `tg_discover_ignored` is keyed by
`handle` alone, so dismissals are deployment-wide. While the flag is off that is
invisible; the moment it flips, `isIgnored` on every account's Discover
candidates and saved reports reflects everyone's dismissals — the same
cross-account leak this programme closed for `isFollowed`. Ticket 16 left it
deliberately rather than half-scoping it, because scoping only the read makes a
handle permanently undismissable by a second account. See ticket 30 for the full
argument.

Also from ticket 16, for the fifth checkbox above: `services/operator.py`'s
`select_operator_channels` (the `Channel.user_id == operator OR NULL` filter) is
still live and still reached by `routes/rag.py` via
`channels.channel_names_for_operator`. Ticket 16 did not convert it, because it
is shared with the scheduler and sync paths; deleting it here means giving RAG's
vector search the seam instead.
