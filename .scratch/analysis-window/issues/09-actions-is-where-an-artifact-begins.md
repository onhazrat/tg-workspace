# AW-09: Actions is where an Artifact begins

**What to build:** Give Artifact creation one entry point. Actions shows the
current Analysis window compactly and can hand off to the Posts editor and back
without losing an unfinished draft. Finish the effort with the one browser
journey that proves the pieces work together.

**Blocked by:** AW-04, AW-08

**Status:** ready-for-agent

## The rule this ticket makes true

Every UI-created Summary, Chat, Tag run and Discovery report starts in Actions,
and checking or changing the window from there is not destructive navigation.

## Acceptance criteria

- [ ] Posts, History and the four result tabs no longer create Artifacts.
- [ ] Actions shows the current Analysis-window summary as a compact control.
- [ ] Activating that control navigates to Posts and opens the canonical editor.
- [ ] The complete unfinished Action draft survives that navigation, and there is a direct path back.
- [ ] One Playwright journey covers the integration rather than duplicating the temporal matrix: open the Posts summary, edit the four fields, switch modes, cross to Actions without losing the draft, create an Artifact, read its exact Start, End and Duration, confirm workspace Scope did not change, then Use this Scope and observe a Fixed restoration.
- [ ] The same journey exercises keyboard closure and focus return on desktop and the bottom sheet at a mobile viewport.
- [ ] It queries by role and label rather than styling classes.

## Notes

The browser seam is deliberately one journey. The temporal matrix belongs to the
controller tests in AW-03 and the backend contract tests in AW-05 and AW-06;
duplicating it here buys nothing and costs minutes on every run.
