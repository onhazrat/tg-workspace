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

**Candidate**:
A Directory entry that a Discovery report's scan surfaced. The distinction is
the Scope: every Candidate is a Directory entry, but a Directory entry only
becomes a Candidate by turning up in the Posts somebody actually reads.
_Avoid_: suggestion, recommendation, discovered channel

**Reference**:
The Post in a followed Channel that surfaced a Candidate, by forwarding it,
linking to it or mentioning it. The arrow points the opposite way to a Directory
entry's sample, which is a Post by the Channel itself, so the two never share a
word.
_Avoid_: sample post, source post, evidence

**Follow**:
The relation between an Account and a Channel, carrying everything private
about watching it. Following is what makes a Channel's Posts visible to an
Account; unfollowing removes the relation and nothing else.
_Avoid_: subscription, watch, membership

**Post**:
One message scraped from a Channel.
_Avoid_: message, item, entry

**Scope**:
The slice of Posts an operation runs over: selected Channels × a date range ×
the active post filters. Every Artifact freezes a snapshot of the Scope it was
made from, so reopening one restores that selection rather than reinterpreting
it against today's.
_Avoid_: selection, range, filter set, context

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
