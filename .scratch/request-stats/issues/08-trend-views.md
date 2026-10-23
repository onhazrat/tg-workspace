# RQS-08: The trend's switches, shades and scale

**What to build:** The Operator stacks or separates kinds and outcomes, reads outcome as a shade of each kind's colour, and never has one burst flatten the rest. Spec: "Zoomable trend".

**Prototype:** variant A on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d), the working reference for this behaviour; its README says how to run it. Port the behaviour, not the code: the prototype's data layer is synthetic (spec, Further Notes).

**Blocked by:** RQS-07

**Status:** done

- [x] Four switches: Separate by kind and Separate by outcome, each with Stacked | Separate. Stacked splits the area in a row; separate gives a row per value on its own scale; both give a row per kind × outcome, with row names level beside each row.
- [x] Shades: each kind's colour stepped toward the surface, opaque, Useful 100%, Idle 55%, Wasted 30%, with a surface-coloured hairline between layers; the outcome chips show the shade beside each when both are shown.
- [x] Each row's y range comes from the buckets in view; above 1.5 times the 99th percentile the scale stops at 1.15 times it, with a notch on each bucket above, whose hover gives the real value.
- [x] A legend click is the kind table's Show checkbox (or the outcome chip when the legend lists outcomes); a double click isolates one, or shows all again; the scale follows.
- [x] Unit tests for the cap, notches, shades and split; tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23: implemented on `claude/rqs-08` and merged into the integration branch in d906d6776f6eb668e2056998e4047edf18daf73c (fast-forward). A single legend click waits 300 ms so a double click can cancel it (Plotly 3 fires both).
