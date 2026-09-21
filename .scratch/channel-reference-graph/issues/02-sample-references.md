# CRG-02: Directory samples contribute References

**Status:** ready-for-agent

**Blocked by:** CRG-01

## What to build

Probing an unfollowed channel writes References from the Posts that probe already
fetched, so the graph grows to cover channels nobody follows, at no additional
Telegram cost.

This is the tier that was free all along and never collected. A Discovery probe
stores a snapshot of a channel's recent Posts as Directory samples, and those
Posts carry forwards, mentions, links and replies exactly as corpus Posts do.
Nothing has ever read them for References.

## Where it happens

Inside the probe-result path, immediately after the snapshot is replaced, in the
same transaction. The entry's chat id is already in hand there, from the page
metadata applied just above.

Check the live-to-unavailable downgrade case: that path deliberately does not
apply the page metadata, so the entry keeps its previously remembered chat id.
That is the correct value to use, and CRG-01's recheck fix is what keeps it
present.

## Samples get no deferral

A sample carries no per-row flag and the whole snapshot is replaced on the next
probe, so there is nothing to defer with. An entry with no chat id is skipped
outright, and the next probe re-mines the same Posts anyway, with the uniqueness
constraint absorbing the overlap. The retry is already built in.

This is deliberately a different rule from the one Posts get in CRG-01. Say so in
the module rather than leaving the asymmetry looking like an oversight.

## Acceptance criteria

- [ ] A conclusive probe of an unfollowed channel writes References from its
      samples
- [ ] Re-probing the same channel writes zero additional rows
- [ ] A sample-derived Reference survives the snapshot being replaced
- [ ] An entry with no chat id is skipped, not deferred, and a later probe that
      does yield one writes the References
- [ ] A live-to-unavailable downgrade uses the remembered chat id rather than
      skipping
- [ ] Sample-derived References are asserted where the probe's behaviour is
      already tested, not in a new file
- [ ] Every new assertion mutation-tested
