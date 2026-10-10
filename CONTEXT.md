# TG Summarizer

Self-hosted Telegram channel summarizer: it syncs posts from public `t.me`
channels into PostgreSQL, then runs AI operations over a chosen slice of them.
This file is the glossary. It holds no implementation detail — see `CLAUDE.md`
for architecture and `docs/migration/` for decisions.

## Language

### People

**Account**:
The thing that owns rows. Every user-owned row names exactly one, and an
Account sees its own rows and no others. This is the unit of tenancy,
quota and retention.
_Avoid_: user, tenant, profile

**Operator**:
Whoever runs a deployment. An Operator sets deployment-wide policy (retention
windows, quota ceilings, whether registration is open) and is not a role the
data model knows about: authorisation names a Permission, never "the Operator".
One person is usually both the Operator and an Account, and those are still two
different hats.
_Avoid_: admin, owner, superuser, host

**Owner**:
An Account acting on another Account's behalf through a View-as session. The
word is deliberately narrow: an Account that merely owns its own rows is not an
"Owner", it is just the Account those rows name.
_Avoid_: admin, impersonator, delegate

### The corpus

**Channel**:
A public Telegram channel, identified by its handle, whether or not anyone
follows it. Its Posts and its sync state live only while somebody follows it;
what we know *about* it is its Directory entry, which outlives every Follow.
The definition names no role on purpose, because who watches a Channel is the
Follow's business, not the Channel's.
_Avoid_: feed, source, subscription

**Directory**:
The corpus-wide map of every Channel anyone has seen referenced, followed or
not. It outlives Follows and Posts deliberately, because it records what exists
on Telegram rather than what anybody reads.
_Avoid_: probe table, channel map, index, registry

**Directory entry**:
One Channel's row in the Directory: its metadata, its followability verdict, a
sample of its recent Posts, and the statistics derived from that sample. The
sample is a snapshot of one preview page, replaced wholesale and never promoted
into the corpus; the statistics are kept once computed, so an entry that stops
being probed still describes the Channel after its sample is collected.
_Avoid_: probe, probe row, map row

**Channel counters**:
The five counts Telegram shows on a Channel's page: subscribers, photos,
videos, files and links. Each is a number, exact below 1,000 and rounded to
three significant digits above it, because that is all the page reveals. A
counter the page does not show is absent, which is not the same as zero.
_Avoid_: stats, metadata, subscriber string

**View count**:
How many times a Post was seen as of one observation, as a number rounded the
way Channel counters are. A View count without the time it was observed says
little, because a young Post's count keeps climbing. Reactions are counted per
chip, as of the same observation, never as one flattened line.
_Avoid_: views string, impressions

**Settled View count**:
A View count observed at least the deployment's settling age (24 hours unless
changed) after its Post was published, by which point it has stopped climbing
in any way that matters.
_Avoid_: final views, mature views

**Estimated View count**:
The Settled View count a Post is expected to reach, judged from its own View
count and its age. A Post already past the settling age is its View count; a
younger one is its View count read through the Settling curve. A Post younger
than the estimation floor is too new to judge and has none, which is not the
same as a low one. Posts are filtered and ordered by it, or by their View count,
never by their Channel's Reach.
_Avoid_: projected views, predicted views, reach (of a Post)

**Reach**:
The median Settled View count of a Channel's recent Posts: how many people a
Post from that Channel typically gets in front of. It says nothing about
whether they should believe it. When too few of those Posts are Settled, Reach
is estimated from younger View counts through the Settling curve, and is shown
as an estimate.
_Avoid_: median views, average views, popularity

**Settling curve**:
How far along its climb a View count typically is at a given age, measured
across the corpus. It is what turns a young View count into an estimate of the
Settled one.
_Avoid_: decay curve, growth model

**View observation**:
One View count of one Post, recorded with the Post's age at that moment. Kept
for a sample of Posts and only for a fixed window after publication, because
its one use is fitting the Settling curve.
_Avoid_: view snapshot, view history, view log

**Candidate**:
A Directory entry that a Discovery report's scan surfaced. The distinction is
the Scope: every Candidate is a Directory entry, but a Directory entry only
becomes a Candidate by turning up in the Posts somebody actually reads.
_Avoid_: suggestion, recommendation, discovered channel

**Dismissal**:
An Account's decision that a Channel is not for it. One Dismissal hides the
Channel everywhere that Account looks for Channels to follow, Discovery reports
and the Directory alike, until the Account takes it back. It is the Account's
alone and says nothing about the Channel.
_Avoid_: ignore, not interested, hide, block, reject

**Reference**:
One Post naming one Channel, once, in one way: a forward, a mention, a link or a
reply that crosses channels. A Post naming two Channels makes two References, and
a Post that both forwards from and mentions the same Channel makes two more. The
naming Post need not be in a followed Channel, because a Directory entry's
samples are read for References too. The arrow points the opposite way to a
Directory entry's sample, which is a Post by the Channel itself, so the two never
share a word. A Discovery report surfaces the newest Reference to each Candidate;
the deployment keeps every one of them, for good.
_Avoid_: edge, link, connection, sample post, source post, evidence

**Citing Channel**:
A Channel with at least one Post that makes a Reference to another Channel; it
*cites* that Channel, which is *cited by* it. "Cited by N" counts distinct Citing
Channels, never References, so a Post that both mentions and links a Channel, or
twenty Posts from one Channel, count once.
_Avoid_: referrer, source channel, inbound link

**Shared parent**:
A Citing Channel that cites both a Channel the Account picked and the Channel
being judged. Many Shared parents mean the two are read by the same people.
_Avoid_: co-citer, common source

**Shared child**:
A Channel that both a picked Channel and the Channel being judged cite. Many
Shared children mean the two point their readers at the same places.
_Avoid_: common target, shared link

**Follow**:
The relation between an Account and a Channel, carrying everything private
about watching it. Following is what makes a Channel's Posts visible to an
Account; unfollowing removes the relation and nothing else.
_Avoid_: subscription, watch, membership

**First sync**:
The sync queued for a Channel when an Account creates a Follow on it, whether
or not another Account already follows it.
It comes after the Follow and is not part of it: the Follow is complete when
the relation exists, whether or not the first sync has finished.
_Avoid_: initial sync, backfill

**Last sync**:
When a Channel's most recent successful sync finished. It belongs to the
Channel, not to a Follow, so every Follower sees the same one. A Channel that
has never synced has no Last sync, which is not the same as an old one.
_Avoid_: last updated, freshness, last scraped

**Post**:
One message scraped from a Channel.
_Avoid_: message, item, entry

**Link**:
A stretch of a Post's own words that points somewhere, exactly as Telegram
marked it: a phrase masking an address, a bare address, a mention or a hashtag.
A mention is the Link whose words are a Channel's handle. A Link to a Channel
makes a Reference, most Links point elsewhere and make none, and a forward or a
reply is a Reference with no Link at all. The quoted excerpt of a replied-to
Post is not the Post's own words, so it carries no Links.
_Avoid_: hyperlink, URL, entity, anchor, text link

**Language**:
The human language a Post is written in, read from the Post's own words by the
deployment rather than chosen by anybody. A Post with no words has no Language;
a Post whose words cannot be placed has an undetermined one, which is a
different claim. A Channel's Language is the most common among its own recent
Posts, counting forwards only when it has nothing of its own, and a Directory
entry's is derived the same way from its sample. Neither is ever set directly.
_Avoid_: locale, lang, script, channel language (as something set)

**Translation language**:
The one Language the deployment translates Posts into. Deployment policy, not an
Account's preference.
_Avoid_: target language, translation target

**Scope**:
The slice of Posts an operation runs over: selected Channels (the Hidden
selection included) × an Analysis window × the Post selection, read in the
Posts tab's order, optionally grouped by Channel. The Post filter is not part of
it: what the Posts tab shows and what an operation covers are separate
questions. Every Artifact freezes a snapshot of the Scope it was made from,
including the Selection rules and Picks and the exact Posts they reached, so it
can be inspected or explicitly restored without reinterpreting it against
today's.
_Avoid_: selection (the Post selection is one part of it), range, filter set,
context

**Analysis window**:
The temporal part of the current Scope. It is explicitly either Live or Fixed,
and the choice applies everywhere the Scope is used rather than only to the
visible Posts feed.
_Avoid_: date range, time range, range

**Live window**:
An Analysis window whose boundaries remain fixed offsets from the current time.
It may end now or deliberately exclude the newest period; either way, both
boundaries advance together without another choice from the Account. Its
Duration and End gap remain fixed while its Start and End advance.
_Avoid_: quick range, relative range, rolling range

**Fixed window**:
An Analysis window whose two boundaries are exact timestamp instants that do
not advance with the current time. A displayed boundary of 02:00 means exactly
02:00:00, not the whole 02:00 minute. Its Start, End and Duration remain fixed
while its End gap grows. An Artifact always carries this form, resolved from
the current Analysis window when the Artifact is created.
_Avoid_: absolute range, custom range, snapshot range

**Duration**:
The positive exact elapsed time from an Analysis window's Start to its End. Its
minimum value is one minute.
_Avoid_: length, span

**End gap**:
The exact elapsed time from an Analysis window's End to the current time. Zero
means the window ends now; a positive value deliberately excludes the newest
period.
_Avoid_: padding, lag, delay, end offset

### Choosing Channels

**Setting group**:
A named set of sync settings an Account's Follows share. Every Follow belongs
to exactly one, and one of an Account's Setting groups is its default.
_Avoid_: group (unqualified, where parentheses could be meant), profile, preset

**Channel filter**:
An expression that decides which followed Channels are shown: Conditions joined
by AND and OR, negated with NOT, and nested in parentheses to any depth. It is
not part of the Scope and never changes which Channels are selected. The Post
filter is its counterpart on the Posts tab.
_Avoid_: channel query, channel search, facet

**Directory filter**:
The same kind of expression over the Directory: it decides which Directory
entries are shown, followed or not. Its Conditions test what a Directory entry
records and the References around it.
_Avoid_: directory query, directory search, browse filter

**Condition**:
One test in a Channel filter, a Directory filter or a Post filter. In a Channel filter: a tag, a
Setting group, a Language, or a bound on a number such as Reach or
subscribers. In a Post filter: a Type, a media kind, a Language, a Channel, or
a bound on a View count or an Estimated View count. In a Directory filter: a
Language, part of the handle or name, the followability verdict, being followed
or dismissed, a citation, or a bound on a number such as Reach or subscribers. Anything with no value for
that number fails a bound on it, and a separate Condition asks whether it has
one.
_Avoid_: rule (a Selection rule is something else), clause, criterion, filter
chip

**Shown Channels**:
The followed Channels that pass the Channel filter and the search box.
_Avoid_: visible, filtered, matching

**Hidden selection**:
The selected Channels that are not Shown Channels. They stay selected, and the
Scope includes them. The Channels tab can limit its own actions (edits, sync,
trim, rank) to the Shown Channels, so that nothing changes on a Channel the
Account cannot see; that limit reaches no other tab.
_Avoid_: invisible selection, filtered-out selection

### Choosing Posts

**Post filter**:
An expression that decides which Posts the Posts tab shows: Conditions joined by
AND and OR, negated with NOT, nested in parentheses, together with the keyword
search and a per-Channel cap. It is not part of the Scope. It decides what is
shown, and so what a select-all or deselect-all reaches.
_Avoid_: post filters (as part of the Scope), query, facet

**Post selection**:
Which Posts of the selected Channels and the Analysis window an operation
covers: an ordered list of Selection rules and Picks, read top to bottom, where
the last one to reach a Post decides it. It starts as one Selection rule,
select all, so an Account that never touches it covers every Post. It lasts for
the browser session, across reloads and tab switches.
_Avoid_: exclusions, checked posts, Selected posts (that is a Chat mode)

**Selection rule**:
A step of the Post selection that selects or deselects every Post matching a
Post filter, kept as the filter was when the rule was made. It is applied again
whenever the Analysis window or the selected Channels change, so it reaches
Posts that did not exist when it was made. Selecting all the results of a
meaning search makes Picks instead, because a ranking cannot be applied again.
_Avoid_: saved filter, auto-selection, rule (unqualified)

**Pick**:
A step of the Post selection that selects or deselects one exact Post. It
follows that Post into any Analysis window and never reaches another.
_Avoid_: exception, override, manual selection

**Channel spotlight**:
Showing one Channel's Posts alone in the Posts tab for a moment, as a Post
filter with a single Channel Condition. Like any Post filter it changes what is
shown, never the Scope.
_Avoid_: focus mode (that is the collapsed workspace), channel focus, channel
view

### Scraping

**Lane**:
One proxy, with a limit on how many requests may pass through it at once. Every
request to Telegram leaves through a Lane, whatever kind of work made it.
_Avoid_: proxy pool, channel, connection

**Queue lane**:
One queue the Sync worker drains, ranked against the others by priority. Always
qualified, never bare "lane": the code spells both this and the proxy sense
`lane`, and the two are unrelated — a Queue lane decides what happens next, a
Lane decides where it leaves from.
_Avoid_: lane (unqualified), queue, tier, pipe

**Slot**:
One permit to scrape a Channel, pinned to a Lane for as long as it is held.
Holding a Slot is what makes a Channel's whole page walk leave from one proxy.
_Avoid_: worker, permit, gate

**Partition**:
Every Slot in one process, dealt across the Lanes. Its size comes from the
proxies, not from a number somebody chose.
_Avoid_: pool, gate, semaphore

**Sync worker**:
The process that runs the scheduler and drains the queue. It is never a Slot —
unqualified "worker" has meant both, and that ambiguity is why these four
entries exist.
_Avoid_: worker (on its own), consumer, background job

### Artifacts

**Artifact**:
A durable output a person deliberately asked for, carrying a frozen snapshot of
the Scope it was made from. There are exactly four kinds: Summary, Chat, Tag
run, Discovery report. The "deliberately asked for" clause is load-bearing — it
is what excludes Logs, Sync jobs and Embeddings, which are also durable rows
with timestamps but which nobody requested individually.
_Avoid_: record, output, item, entity

**Summary**:
An Artifact holding AI-generated prose about the Posts in its Scope.
_Avoid_: summary report, digest, report

**Chat**:
An Artifact holding a conversation about the Posts in its Scope. A Chat depends
on its Scope, never on a Summary — a conversation held while a Summary happened
to be open is still just a conversation about those Posts.
_Avoid_: chat session, conversation log, thread

**Tag run**:
An Artifact holding a set of AI-proposed Channel tags and whether they were
applied. Called a *run*, not a report, because it genuinely has execution state:
it can be pending, and it can fail.
_Avoid_: tag report, tagging, tag job

**Discovery report**:
An Artifact holding the candidate Channels found by scanning the Posts in its
Scope for outward references.
_Avoid_: discover report, discovery run, candidates list

**Pending**:
The state of an Artifact whose prompt was copied for an external AI but whose
response has not been pasted back. Applies to Summary and Tag run only.
_Avoid_: draft, incomplete, awaiting

**Output language**:
The Language an Artifact is written in, chosen by the Account that asks for it.
Unrelated to the Languages of the Posts in its Scope: a Summary of Persian Posts
may be written in English.
_Avoid_: AI language, summary language, target language

**Covered Post**:
A Post in an Artifact's frozen Scope: one the Artifact was made from. A Summary
of 679 Covered Posts was written from those 679 and no others. A Summary frozen
before its Scope recorded them has none on record, which is not the same as
having none.
_Avoid_: used post, input post, source post

**Citation**:
A reference in a Summary's prose to one exact Post, by Channel and Post number.
The same Post may be cited several times; each is a Citation.
_Avoid_: source, footnote, link (a Link is something else)

**Cited Post**:
A Post that at least one Citation in a Summary points to. Usually a Covered
Post too, but nothing guarantees it: the prose is AI-written and may cite a Post
outside its Scope.
_Avoid_: source post, referenced post

### Publishing

**Publication**:
One act of sending a Summary to a Telegram chat through a bot: its prose and,
when asked for, its metadata, as one or more Parts. Manual or scheduled, it is
the same act. A Publication that stops partway is partial: the Parts already
sent stay sent, and finishing it sends only the rest.
_Avoid_: publish (as a noun), post (a Post is something else), send

**Part**:
One Telegram message of a Publication. A Summary longer than Telegram allows in
one message becomes several Parts, cut between paragraphs.
_Avoid_: message (a Post is the message the corpus holds), chunk, piece

### Chat modes

**Selected posts**:
The Chat mode that sends every Post in the Scope to the model, and nothing
outside it. Stored as `full_scope`.
_Avoid_: full scope (reads as "everything", when it is only what the Scope
selects), summary mode, direct, standard

**Semantic**:
The Chat mode that sends only the Posts a vector search retrieved for the
question. It still has a Scope, which it optionally respects.
_Avoid_: history mode, RAG mode, retrieval

Note: `LLMLog.log_type` carries `chat_full_scope` and `chat_semantic` to match;
the stored values kept the old name when the label changed.
That field classifies *what kind of model call was made* (alongside `summary`
and `analysis`) — a different axis from the Chat's own mode, which is why they
are separate fields that happen to agree.

### Workspace

**Action**:
The workspace tab where every Artifact is created. The one entry point.
_Avoid_: create, new, studio, workbench

**History**:
The workspace tab listing every Artifact of every kind, newest first.
_Avoid_: archive, library, past runs

**Fixed tab**:
A workspace tab that is always open and cannot be closed. There are exactly
three: Channels, Posts and Action.
_Avoid_: pinned tab, permanent tab, core tab

**Closable tab**:
A workspace tab the Account can close and reopen, like a browser tab: History,
Settings, Directory, and every Artifact tab. History, Settings and Directory are
open at most once.
_Avoid_: hidden tab, optional tab, compact tabs

**Artifact tab**:
A closable tab showing at most one Artifact of one kind. Any number can be open
at once, but never two for the same Artifact and never two empty ones of the
same kind. A newly opened one shows no Artifact until one is opened in it.
_Avoid_: result tab, feature tab, summary tab (for the general case)

**Focus mode**:
The workspace with its chrome collapsed — no title block, no stats strip, no
width cap. Independent of native browser fullscreen, which is requested at the
same time but cannot be restored on reload.
_Avoid_: zen mode, fullscreen, distraction-free

### AI access

**Provider**:
An external AI vendor and the API surface it speaks. There are exactly two
kinds: Gemini, and anything OpenAI-compatible reachable at a base URL. The
second kind is one thing, not a family — OpenRouter, Groq, Together, DeepSeek,
Ollama and vLLM are all the same Provider pointed at different addresses.
_Avoid_: vendor, model provider, backend, LLM

**AI Key**:
An Account's stored, encrypted access to one Provider. It carries a label, a
Provider kind and a base URL; it does **not** carry a model, because one Key
can reach hundreds. An AI Key is what pays for that Account's Artifacts, and
nobody but the Account ever reads it back.
_Avoid_: API key, token, credential, secret

**Selected AI Key**:
The one of an Account's AI Keys that pays for its next Artifact, remembered per
device under the acting Account. Distinct from *holding* a Key: the run controls
that spend one are unavailable until a Key is selected. A Key is selected
automatically whenever the Account has one and has not chosen otherwise, so in
practice "no Key selected" means "no Key at all".
_Avoid_: active key, current key, default key, chosen provider

**Operator Key**:
The deployment's own AI access, configured in the environment. It pays for
every AI call that is not an Artifact, which is exactly the corpus-wide work:
Embeddings and Translations. It never pays for an Artifact.
_Avoid_: default key, fallback key, system key, shared key

Note: the split between the two Keys is the Artifact definition above, used
unchanged. An Artifact is a durable output somebody deliberately asked for, so
it is charged to the Account that asked. Everything excluded from that
definition is corpus-wide, shared between Accounts, and charged to the
deployment. There is no third case and no fallback in either direction.

**Spend session**:
A View-as session in which an Owner may consume the target Account's paid
resources: its AI Key, its bot credentials and its Telegram Budget. It is the
third and narrowest tier, above read-only and elevated, and it grants *use*
without ever granting *sight* — no tier reads key material back.
_Avoid_: full access, impersonation, delegated session, admin mode
