# 04: The harvest sweep

**What to build:** Handles referenced by stored Posts enter the Directory on their own, without anybody generating a Discovery report — and the Operator can see what that cost.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] A periodic job walks stored Posts for referenced handles not yet in the Directory and enqueues them, reusing the existing signal extractor for forwards, mentions and links
- [ ] It is a sweep, not a write on the sync path, so it never slows a path an Account waits on
- [ ] Batch size is configurable and is the throttle
- [ ] Work drains through the existing probe queue lane, strictly after every sync lane
- [ ] The sweep skips any handle somebody follows, since sync covers those better and more often
- [ ] One Account's corpus does not starve another's handles out of the queue
- [ ] Probe-lane requests are counted at deployment level and visible to the Operator
- [ ] No Account's quota ledger is charged and no fourth Budget is introduced
- [ ] A Discovery report still scans the Posts in its Scope and joins Directory rows for metadata — what it means is unchanged

## Notes

No daily ceiling. The adaptive per-proxy wait plus the refresh window are the rate control; the known gap is that pacing reacts after the fact and syncs share the widened wait. The Operator's lever is ticket 03's window.

The three Budgets derive totally from sync mode, so a fourth would break that; charging an Account for corpus work is what the three exist to prevent.
