# ADR-026: The post filters leave the Scope; a Post selection replaces them

**Status:** Accepted (2026-10-01). Supersedes the post-filter half of the Scope as ADR-010 and
ADR-025 describe it. Spec: `.scratch/posts-tab-redesign/spec.md`.

## Context

Until now the Scope was selected Channels × Analysis window × the active post filters: keyword,
Type, media kinds, Languages and one views threshold, in a chosen order, with an optional
per-Channel cap. The filters on the Posts tab therefore did two jobs at once. They decided what
the Account was reading, and they decided what every Summary, Chat, Tag run and Discovery report
covered.

The Posts tab redesign (prototype on `claude/mattpocock-skills-post-card-4f5186`) gives the Posts
tab the Channels tab's filter: Conditions with AND, OR, NOT and parentheses. An expression that
rich makes the double job untenable. Reading "Persian posts that are not forwards, or anything
over 10K views" to look around would silently narrow the next Summary to exactly that, and the
only way to read wider without changing the Summary would be to remember to undo it.

It also gives the Account a way to say which Posts count that no filter can: "not this one",
"all of these but those three". A filter is a rule over every Post; a judgement about one Post is
not a rule.

Three shapes were considered:

1. **Keep the filters in the Scope**, richer. Every view change keeps changing the Summary, the
   problem above, now with NOT and OR.
2. **An exclusion list**: everything in the window counts except the Posts the Account removed.
   Simple, but "remove every Arabic Post" either becomes thousands of ids that miss tomorrow's
   Arabic Posts, or a filter by another name.
3. **A Post selection of Selection rules and Picks**, ordered, last step wins. Chosen.

## Decision

**The Post filter decides only what the Posts tab shows. What an operation covers is the Post
selection: an ordered list of Selection rules and Picks, starting as one rule, select all.**

- A **Selection rule** selects or deselects every Post matching a Post filter, kept as the filter
  was when the rule was made (with its random seed, when the filter has a random cap). It is
  applied again whenever the Analysis window or the selected Channels change, so "deselect all
  Arabic Posts" reaches Arabic Posts that did not exist when it was made.
- A **Pick** selects or deselects one exact Post. It follows that Post into any window and never
  reaches another.
- Steps apply in order and the last one to reach a Post decides it. A select-all or deselect-all
  over an empty Post filter reaches every Post, so it replaces every step before it.
- Selecting all the results of a meaning search or "find related" records Picks, because a
  ranking cannot be applied again.
- The Scope is selected Channels × Analysis window × Post selection, read in the Posts tab's order
  and grouping. An Artifact freezes the rules, the Picks, and a reference (Channel and Post id,
  never the text) to every Post they reached, so it can be inspected without re-applying anything
  against today's corpus.
- The Post selection lasts for the browser session, namespaced per Account. An Account that never
  touches it has one step, select all, and covers every Post in the window, as an Account with no
  filters did before.

## Consequences

- **A Summary no longer follows the visible filter.** That is the point, and it is the change most
  likely to be "fixed" by someone who has not read this. An Account who wants a Summary of what
  they see selects all of it, which records a rule.
- **The old flat filters become view-only on upgrade.** An Account with "Language = Persian"
  active gets a Summary over every Language afterwards. Accepted because the deployment has no
  users outside the team; the alternative, migrating each Account's filters into a first rule,
  was judged not worth its complexity.
- **The server evaluates the Post selection, not the browser.** The feed marks each Post as
  selected or not, the counts count selected Posts, and an Action resolves the selection itself
  (ADR-009). The prototype's browser evaluator over loaded pages is not carried forward.
- **Picks are bounded** at 5,000, the existing limit on explicitly named Posts; past it a
  Selection rule is the tool. The list of references an Artifact freezes is not bounded by it.
- The Channels tab's "Posts in scope" counts selected Posts, since the Scope now includes the
  Post selection.
