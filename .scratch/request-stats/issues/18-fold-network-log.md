# RQS-18: Fold the network log into the Request record

**What to build:** Follow-up, not part of the spec's build. `tg_network_logs` keeps about one row per sync page fetch with attempts telemetry, per User, for 30 days. Once the Request record has proved itself, fold what the network log still adds into it and retire the log.

**Blocked by:** RQS-14

**Status:** needs-triage

- [ ] Decide what the network log shows that the Request record doesn't, and move or drop it.
- [ ] Retire the table, its writer and its retention, with the guards updated.
