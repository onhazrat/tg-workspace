# RQS-08: The trend's switches, shades and scale

**What to build:** The Operator stacks or separates kinds and outcomes, reads outcome as a shade of each kind's colour, and never has one burst flatten the rest. Spec: "Zoomable trend".

**Blocked by:** RQS-07

**Status:** ready-for-agent

- [ ] Four switches: Separate by kind and Separate by outcome, each with Stacked | Separate. Stacked splits the area in a row; separate gives a row per value on its own scale; both give a row per kind × outcome, with row names level beside each row.
- [ ] Shades: each kind's colour stepped toward the surface, opaque, Useful 100%, Idle 55%, Wasted 30%, with a surface-coloured hairline between layers; the outcome chips show the shade beside each when both are shown.
- [ ] Each row's y range comes from the buckets in view; above 1.5 times the 99th percentile the scale stops at 1.15 times it, with a notch on each bucket above, whose hover gives the real value.
- [ ] A legend click is the kind table's Show checkbox (or the outcome chip when the legend lists outcomes); a double click isolates one, or shows all again; the scale follows.
- [ ] Unit tests for the cap, notches, shades and split; tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
