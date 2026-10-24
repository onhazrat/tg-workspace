# Spec: One resolved Posts view

Status: ready-for-agent

Decisions: `docs/adr/ADR-036-one-resolved-posts-view.md` and
`docs/posts-view-plan.md` (22 settled decisions and the no-behaviour-change
checks). No prototype: the change is behaviour-preserving and the existing
suites are its proof. Vocabulary (Posts view, Scope, Post filter, Post
selection, Selection rule, Pick, Analysis window, Estimated View count,
Settling curve, Channel spotlight, Discovery report, Action) is `CONTEXT.md`'s.
Ticket ids carry the prefix `PV`.

## Tickets

Two tickets in `issues/` beside this file, one per PR. Neither blocks the
other, because the wire does not change; PV-01 merges first.

| Id | Ticket | Blocked by |
|---|---|---|
| PV-01 | Every Posts read on the server compiles from one resolved Posts view (`issues/01-server-posts-view.md`) | None |
| PV-02 | The browser builds each Posts read's key and body together (`issues/02-browser-posts-reads.md`) | None |

A ticket closes as `docs/agents/issue-tracker.md` says.

## Problem Statement

Nothing an Account sees is wrong. The friction is for whoever changes the
Posts tab next.

The Posts tab asks the server six questions about one Posts view (the feed,
the counts, the facets, two histograms and a lookup), and Discover asks a
seventh. Every route resolves that view itself: the Analysis window, the
Channels, the Post filter, the Settling curve when a bound or the views order
reads it, the followed set when a Selection rule needs it, and the Post
selection's predicate. It then hands the service the Channels and the window
a second time as loose arguments. The feed read takes 16 parameters. Whether
the curve is loaded depends on the caller passing the right sort, and reading
an estimate that was not loaded raises. The followed-set precondition is
spelled three ways. The per-Channel cap is built twice, once for the feed and
once for the Post selection.

The browser has the same shape. Seven hooks each build a query key and a
request body from one Posts view by hand. The rules that keep the two in step
(key on the window, not its boundaries; key the Post selection by its
revision, not its Picks; key the Post filter by its printed text) live only
in comments at each site. Four timers debounce one keyword that is already
debounced. The command that trims the Channel selection asks for the same
counts outside the query cache. None of the key/body pairing has a unit test,
so a stale-cache bug is found by Playwright or by an Account.

The Directory already solved this with one resolved view that every
Directory read compiles from.

## Solution

Every Posts read compiles from one **Posts view**, resolved once per request.
On the server, a request is read into a frozen Posts view that holds
everything the reads are evaluated under, with the curve and the followed set
already loaded when anything needs them. Each read takes the whole view and
says which parts it ignores. In the browser, one pure function turns a Posts
view and a read kind into a matching key and body, and the hooks call it.

An Account sees no difference: the same Posts, counts, bars, order and
timings. The wire and the generated client do not change.

## User Stories

1. As an Account, I want the Posts tab to show exactly the Posts it shows today, so that a refactor costs me nothing.
2. As an Account, I want the per-Channel counts, the too-new-to-judge count and the Adjust selection numbers unchanged, so that my decisions rest on the same numbers.
3. As an Account, I want the Type, media and Language dropdown counts unchanged, so that the facets read as before.
4. As an Account, I want the number editors' bars and the Analysis window editor's chart unchanged, so that a bound I set means what it meant.
5. As an Account, I want a random per-Channel cap to keep the same Posts across pages and reloads, so that the feed does not reshuffle.
6. As an Account, I want a Selection rule with a cap to reach the same Posts the feed's cap keeps, so that select-all reaches what I see.
7. As an Account, I want a Discovery report over a Scope to aggregate the Posts the Posts tab covers, so that the report and the tab agree.
8. As an Account, I want a Summary, a Chat and a Discovery report to cover the same Posts they cover today, so that an Action's output does not move.
9. As an Account, I want the keyword search to update the feed and the counts 300 ms after I stop typing, as it does now, so that typing feels the same.
10. As an Account, I want Trim selection to act on fresh in-scope counts, so that it never trims by a number that is out of date.
11. As an Account viewing another Account, I want every Posts read scoped to the Account I am viewing, so that View-as still shows nobody else's Posts.
12. As an Account, I want a capped feed to rank only the Posts I may see, so that another Account's Posts never use up my cap.
13. As a developer adding a Posts read, I want to receive a resolved Posts view, so that I resolve nothing myself.
14. As a developer adding a Posts read, I want the view to tell me which parts exist, so that I state which parts my read ignores instead of rediscovering it.
15. As a developer, I want an unloaded estimate to be impossible to reach, so that a views sort or an estimate bound cannot raise at read time.
16. As a developer, I want the followed set present whenever a read or a Selection rule needs it, so that the precondition is spelled once.
17. As a developer, I want the Settling curve read once per request however many Selection rules there are, so that a selection with many rules does not re-read it per rule.
18. As a developer, I want one builder for "the Posts this view covers, capped and ordered", so that the feed and the Post selection cannot rank a Channel differently.
19. As a developer, I want the feed's read model out of the module that writes Posts, so that the service kinds stay true and nothing imports ordering helpers from an aggregate.
20. As a developer on the Action path, I want to build a Posts view from plain values, so that Summary generation, Chat and Discovery reports use the same reads without an HTTP body.
21. As a developer, I want the Discover route to build its view the same way the Action path does, so that its narrower body needs no special case in the request adapter.
22. As a developer, I want paging and histogram inputs to stay arguments of the read that uses them, so that the counts' interface does not carry a page.
23. As a developer, I want a route that builds a Post scope, parses a Post filter or compiles a Post selection by hand to fail a guard, so that an eighth read cannot reopen the drift.
24. As a reviewer, I want the guard's commit to say what was broken to watch it go red, so that I can trust a guard I cannot see fail in the diff.
25. As a reviewer, I want every existing HTTP test to pass unchanged, so that "no behaviour change" is proven, not claimed.
26. As a reviewer, I want the generated client to show no diff, so that I know the wire did not move.
27. As a frontend developer adding a Posts read, I want one function that returns the key and the body together, so that I cannot change one without the other.
28. As a frontend developer, I want the key's three deliberate departures from the body listed in one test, so that the rules stop living in comments.
29. As a frontend developer, I want a test that fails when a body field changes and the key does not, so that a stale cache is caught before Playwright.
30. As a frontend developer, I want one debounced keyword in the context, so that the feed and what an Action covers wait on the same timer.
31. As a frontend developer, I want the Channel spotlight applied once when the view is gathered, so that the read function stays two arguments.
32. As a frontend developer, I want the meaning-search fallback to stay where it is, so that the module covers server reads only.
33. As a frontend developer, I want the client-side pipeline module named for what it is, so that "post view" does not mean two things beside "Posts view".
34. As a frontend developer, I want the command registry to read in-scope counts through the query cache with a fresh fetch, so that it fills the cache the Channels tab reads without acting on stale numbers.
35. As an agent picking up a ticket, I want the Posts view in the glossary and an ADR, so that I use the right word and do not propose per-route resolution again.
36. As the operator, I want the two halves to ship as separate PRs, so that each one is reviewable and revertible alone.

## Implementation Decisions

- **Two PRs, backend first.** They do not depend on each other because the wire is unchanged.
- **The wire and the generated client stay byte-identical.** No request or response schema changes.
- **The backend mirrors the Directory.** A request adapter beside the dependency module reads a Posts request into a view. A resolve function builds a frozen `PostsView` from plain values. Every read takes the session, the view, and only its own inputs.
- **`PostsView` holds**: the Account, the Channels, the Analysis window's resolved boundaries, the Post filter's tree and keyword, the loaded readings, the followed set when needed, the cap and its mode, the sort, the seed, and the Post selection compiled to its predicate.
- **Paging** (limit, offset, grouping by Channel, only selected, selected first) and **histogram inputs** (measure, zoom, log, extent, buckets, unfiltered) are arguments of the read that uses them.
- **Each read takes the whole view and says which parts it ignores**, as part of its interface: the facets ignore the Post filter; the value histogram applies it only for the filtered Channel-posts measure; the window histogram ignores the cap and, when unfiltered, the Post filter; the lookup ignores the keyword and the cap.
- **Loads happen at resolve time and only when needed**: the curve when the tree, the sort or a Selection rule reads an estimate; the followed set when the tree or a Selection rule reads Unfollowed forwards, and always for the facets, which count them. Each Selection rule keeps its own filter, sort and measure, read through the one curve.
- **One per-Channel cap builder** serves the feed and the Post selection. It applies the Account's scope before ranking and ends every order in the unique Channel-and-Post tiebreak.
- **The view and its reads move to a new read-model module**, declared as a read model in the service-kinds inventory. The module that writes Posts keeps the writes and stays an aggregate.
- **Joins**: the feed, the counts, the facets, both histograms, the lookup and the Discover route. The Posts routes use the request adapter; the Discover route and the Action path (prompt assembly, freezing a selection, creating a Discovery report) use the resolve function with plain values.
- **The shared Posts parsing helpers fold into the request adapter.** The shared-helpers module goes if nothing is left in it.
- **An AST guard** fails any Posts or Discover route module that names the Post scope type, the Post filter parser or the selection compiler. It gets a row in the guard table.
- **The browser gets one pure function**, `postsRead(view, kind)`, returning `{ queryKey, body }` for the feed, the shown counts, the Scope counts, the facets, the value histogram, the window histogram and the uncapped view. One hook gathers the view from the contexts and applies the Channel spotlight. The existing body builders are what it calls for the body.
- **The key departs from the body in exactly three ways**: the window by its key, not its resolved boundaries; the Post selection by its revision, not its Picks; the Post filter by its printed text, not its tree.
- **One debounce.** The post-filters hook exposes its debounced keyword and debounced meaning query through the context; the hooks' own timers go.
- **The command registry's in-scope counts** go through the query client's fetch with the same key as the Scope counts and a stale time of zero.
- **The client-side pipeline module is renamed** to say it is a pipeline; the new module takes the Posts view name.
- **Not changed**: the Posts view stays in the scraper context; the meaning-search fallback stays in the hooks.

## Testing Decisions

- **A good test checks behaviour through an interface**: what a read returns for a view, what a request answers, what key and body a view produces. Never which helper ran or in what order.
- **Proof of no behaviour change**: every Posts and Discover HTTP test, the Action-path scope parity test, the tenancy and isolation probes, and the Posts Playwright specs (`--workers=1`) pass **without edits**. The client generator shows no diff. A test that has to change is a behaviour change and stops the PR.
- **New backend tests at the `PostsView` interface**, written against a test database as the Directory's browse tests are:
  - an estimate bound or a views sort reads a loaded estimate
  - a Selection rule reading Unfollowed forwards finds the followed set, and a view with none does not load it
  - the curve is read once per request across many Selection rules
  - each read ignores the parts it says it ignores and no others
  - a capped Selection rule reaches the Posts the feed's cap keeps
- **Delete tests that only covered the shared Posts parsing helpers**, once the request adapter's tests and the HTTP tests cover the same behaviour.
- **The AST guard is mutation-checked**: add a hand-built Post scope to a Posts route and watch it go red. The commit body records it as `Mutation-checked: <what was broken> went red`.
- **One frontend table test** at `postsRead`: for every kind, change each field of the view in turn and assert the key changes exactly when the body changes, except for the three listed departures. Mutation-check it by dropping one field from one kind's key. The prior art is the pure tests beside the Posts library modules.
- **No new hook tests.** The hooks become thin; Playwright covers them.

## Out of Scope

- Collapsing the six Scope types into the frozen Scope (candidate 7 of the 2026-10-25 architecture review). The Action path only switches to the resolve function here.
- Moving the Posts view out of the scraper context.
- Unifying the Spread pipeline or the median and log rules (review candidate 3).
- Any change to what a read returns, its performance profile beyond loading less, or the wire.

## Further Notes

- **Checked before this spec** (recorded in the plan): every keyword timer is 300 ms, so one timer fires on the same keystroke the four did. The two cap builders rank with the same order and tiebreak and both scope before ranking. The command registry and the Scope counts hook read the same selected-count map of the same request.
- The tenancy rule that the scope applies before the cap's ranking must stay inside the cap builder. `test_post_tenancy_scoping` guards both query shapes.
- Run the route guards script before the full backend suite. A worktree needs `scripts/worktree-setup.sh` for its `.env` and a private pytest database.
