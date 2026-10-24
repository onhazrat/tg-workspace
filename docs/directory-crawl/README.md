# Directory crawl

What we know about the crawler that fills the Channel Directory, what it costs,
and how to decide what it fetches first. Written 2026-10-15 as a starting
point for deeper work, not as a spec.

| Document | What it holds |
|---|---|
| [how-the-crawl-works.md](how-the-crawl-works.md) | The pipeline traced through the code: extraction, harvest, dispatch, probe, verdict, the priority bands, every knob, and what nothing bounds |
| [staging-measurements-2026-10.md](staging-measurements-2026-10.md) | Staging numbers from 2026-10-14/15 (size, refresh backlog, live rates by signal, language mix, disk) and the SQL to re-run them |
| [priority-design.md](priority-design.md) | Current thinking: discovery score, refresh schedule, capacity split, exploration, Owner controls, build order, open questions |
| [research/report.md](research/report.md) | Research report on how open-source crawlers and the crawl-scheduling literature prioritise discovery and refresh, with a recommended design |
| [research/notes/](research/notes/) | The five sourced notes behind the report |

## Research notes

| Note | Covers |
|---|---|
| [nutch-stormcrawler-urlfrontier.md](research/notes/nutch-stormcrawler-urlfrontier.md) | Nutch Generator, scoring plugins, OPIC flaws, AdaptiveFetchSchedule; StormCrawler schedulers and spouts; URLFrontier API, read from code at pinned commits |
| [heritrix-bubing-frontera-commoncrawl.md](research/notes/heritrix-bubing-frontera-commoncrawl.md) | Heritrix precedence, budgets and sheets; BUbiNG; Frontera and Scrapy queues; Common Crawl harmonic-centrality budgets; ManifoldCF priority bins |
| [recrawl-scheduling-algorithms.md](research/notes/recrawl-scheduling-algorithms.md) | Cho & Garcia-Molina, change-rate estimators, Azar, Kolobov (harmonic penalty, LambdaCrawl), Olston & Pandey, Yandex ECHO, Google's argmax score |
| [discovery-ordering-algorithms.md](research/notes/discovery-ordering-algorithms.md) | OPIC, crawl-ordering studies, focused crawling (Aggarwal, Shark-search), bandits, discovery vs refresh split, fairness |
| [telegram-social-crawlers.md](research/notes/telegram-social-crawlers.md) | TGStat and Telemetr (little public), Telegram dataset crawlers (Pushshift, TGDataset, TeleScope, TeraGram), graph sampling, username rules |

The research was done on 2026-10-15 by parallel research agents and a report
writer, each told to cite primary sources. The notes mark which sources were
read in full and which only from abstracts. Treat formulas labelled "my
derivation" or "inference" as untested.

## Related

- ADRs: [ADR-014](../adr/ADR-014-channel-directory.md) (the Directory),
  [ADR-019](../adr/ADR-019-channel-reference-graph.md) (reference graph),
  [ADR-020](../adr/ADR-020-references-feed-the-directory.md) (References feed the Directory)
- Specs: `.scratch/discover-deep-scrape/spec.md` (DDS), `.scratch/channel-directory/`,
  `.scratch/channel-reference-graph/`, `.scratch/directory-tab/`
- [IDEA-012](../ideas-log/IDEAS-LOG.md) in the ideas log
