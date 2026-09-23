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
How many times a Post was seen, as a number rounded the way Channel counters
are. Reactions are counted per chip, never as one flattened line.
_Avoid_: views string, impressions

**Candidate**:
A Directory entry that a Discovery report's scan surfaced. The distinction is
the Scope: every Candidate is a Directory entry, but a Directory entry only
becomes a Candidate by turning up in the Posts somebody actually reads.
_Avoid_: suggestion, recommendation, discovered channel

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
The slice of Posts an operation runs over: selected Channels × an Analysis
window × the active post filters. Every Artifact freezes a snapshot of the
Scope it was made from, so it can be inspected or explicitly restored without
reinterpreting it against today's.
_Avoid_: selection, range, filter set, context

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

### Chat modes

**Full scope**:
The Chat mode that sends every Post in the Scope to the model.
_Avoid_: summary mode, direct, standard

**Semantic**:
The Chat mode that sends only the Posts a vector search retrieved for the
question. It still has a Scope, which it optionally respects.
_Avoid_: history mode, RAG mode, retrieval

Note: `LLMLog.log_type` carries `chat_full_scope` and `chat_semantic` to match.
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
