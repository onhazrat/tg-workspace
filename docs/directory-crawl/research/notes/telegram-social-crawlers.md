# Telegram directories, Telegram/social crawlers, and graph sampling under budget

Research date 2026-10-15. Scope: how existing Telegram directories and research crawlers discover channels and choose what to fetch or refresh, plus graph-crawling methods that can be adapted to a ~1M-handle Directory with ~80k t.me/s fetches/day whose users mostly follow Persian and English channels.

## 1. Commercial Telegram directories and analytics (TGStat, Telemetr, others): discovery, refresh, scoping

### Takeaway
Almost nothing about TGStat's or Telemetr's crawl frontier is publicly documented. What is documented is a submission-plus-moderation path into TGStat's catalog, owner-editable category, geo and language attributes per channel, and a forwards/mentions graph exposed through the API, so those are the only mechanisms I can state as fact. Everything else about their discovery or refresh tiers is speculation.

### Cited Findings
- TGStat has a public "add channel/chat" submission form (`/ru/add/channel`) and help articles titled "How to add a channel to TGStat?", "How to find a channel on TGStat?" and "How to change a channel's category, geo and language?" — [TGStat Academy index](https://tgstat.com/ru/academy). The help article itself returned HTTP 403 to my fetcher, so its text is unverified — [tgstat.ru help 1064](https://tgstat.ru/ru/help/1064-add-channel-to-tgstat).
- Submitted channels are checked against TGStat's rules and, if compliant, added to the public catalog, after which they appear in collections and search (secondary Russian-language reviews, not TGStat itself) — [Unisender blog](https://www.unisender.com/ru/blog/tgstat-chto-ehto-za-servis-i-chem-on-polezen/); [Callibri blog](https://callibri.ru/blog/kak-analizirovat-telegram-kanaly-v-tgstat).
- TGStat's site language menu offers Russian, English and Uzbek only — [TGStat Academy index](https://tgstat.com/ru/academy).
- TGStat's API addresses a channel by @username, t.me link, joinchat invite link, or TGStat's internal channel id — [rtgstat CRAN manual](https://cran.rstudio.com/web/packages/rtgstat/refman/rtgstat.html).
- TGStat's API exposes subscriber history at hourly, daily, weekly or monthly granularity, plus separate datasets for channel-to-channel forwards and for mentions (backlinks) of any username across all indexed channels — [rtgstat CRAN manual](https://cran.rstudio.com/web/packages/rtgstat/refman/rtgstat.html); [Databar TGStat mentions](https://databar.ai/explore/tgstat/telegram-channel-mentions); [Databar TGStat forwards](https://databar.ai/explore/tgstat/telegram-post-forwardsreposts-across-channels).
- An undated Russian review lists as a TGStat drawback that statistics update "no more than once a day" — [vc.ru](https://vc.ru/28969-servisy-dlya-analitiki-telegram-kanalov). Treat as stale: it conflicts with the hourly granularity the API now exposes.
- Researchers describe TGStat as indexing "over 150K Telegram channels" and used its top-100 lists by subscribers, citations and reach as seeds — [TeleScope, arXiv 2504.19536](https://arxiv.org/html/2504.19536v1). A competitor calls TGStat the largest Russian-language channel-statistics aggregator (competitor claim) — [telegramadsanalytics.com](https://telegramadsanalytics.com/vs/tgstat).
- Telemetr's own LLM description says only "Full access to channel database (millions of channels)" on Pro and "TOP 100" on Free, with "real-time monitoring" and event tracking for mentions, keywords and channels; it gives no discovery method or refresh interval — [telemetr.io/llms-ai.txt](https://telemetr.io/llms-ai.txt).
- Telemetr publishes per-country dashboards, including an Iran "channels development trends" dashboard — [tlmtr.io Iran dashboard](https://tlmtr.io/en/dashboards/iran/channels-development-trends).

### Inferences
- TGStat's catalog has two entry doors, owner submission and something automatic, and the existence of a citations/mentions index over "all channels" implies they mine references from posts of channels they already track. This is a reasonable inference, not documented.
- TGStat and Telemetr both scope by country/language as an attribute on the channel (geo + language editable by owners, per-country dashboards), not by running separate crawls. The equivalent for us is a per-handle language/geo label that drives priority, not separate frontiers.
- The forwards-plus-mentions split in TGStat's API matches our Reference kinds. They keep the edge types separate, which supports weighting edge kinds differently in our frontier score.

### Gaps
- No primary source on TGStat/Telemetr/Combot discovery algorithms, refresh tiers, or subscriber thresholds for indexing. Their help pages either 403'd or were not found. Any claim that they "refresh big channels hourly and small ones daily" would be speculation.
- Combot and other catalogs were not covered; I found no public crawl documentation for them.

## 2. Open-source and research Telegram crawlers: seeds, frontier ordering, depth, stopping, language

### Takeaway
Every published large Telegram dataset uses the same recipe: a small seed list taken from TGStat top lists or a topic, then snowball expansion over forwarded-message origins only. Only one (TeraGram, 2026) documents frontier ordering, a priority queue keyed on how many times a candidate was forwarded into already-downloaded chats. None uses a depth limit or a language filter during the crawl. They stop by date or exhaustion, and they label language after the fact. Seeded from political channels, all of them drift heavily Russian.

### Cited Findings
- Pushshift (Baumgartner et al., ICWSM 2020): ~250 seed channels, mostly English, 124 right-wing extremist politics and 137 cryptocurrency; when a forward came from an unseen channel, the channel was added, collected, and followed. Reached 27,801 channels, 317M messages, 2.2M users; source code was published — [arXiv 2001.08438](https://arxiv.org/pdf/2001.08438); [ICWSM](https://ojs.aaai.org/index.php/ICWSM/article/view/7348).
- TGDataset (La Morgia, Mei, Mongardini; Sapienza): 180 seeds, the ten most-subscribed channels in each of 18 TGStat categories (Politics, Crypto, Religion, Adults, ...). Expansion via forward origins only; forwards authored by users or groups are ignored; adding link-referenced channels is listed as future work. No frontier ordering or depth limit described; iteration stopped on a date (31 July 2022). Five seconds between message-download calls. Collection ran 4 Jan 2021 to 31 Jul 2022 — [arXiv 2303.05345v3](https://arxiv.org/html/2303.05345v3).
- TGDataset language labelling is post hoc: a channel gets a language if over 50% of its messages (ignoring messages under 15 characters) are in it. Result over 120,979 channels: Russian 35.52%, English 16.34%, Farsi 13.86%, German 4.09%, Arabic 2.08% — [arXiv 2303.05345v3](https://arxiv.org/html/2303.05345v3).
- TeleScope (arXiv 2504.19536): 251 unique seeds from TGStat's top 100 by subscribers, citations and reach; forwards-only snowball, recursive. Discovered 1,210,272 channels, metadata for 534,137, full messages for 71,048 public ones; discovery ran at ~200K new channels/month and slowed in the last month. Language of downloaded public channels: Russian 82.29%, Ukrainian 4.6%, English 4.2%, Persian 2.2%. No prioritisation, depth limit or recrawl cadence described; snapshots planned yearly — [arXiv 2504.19536](https://arxiv.org/html/2504.19536v1).
- TeraGram (Golovin et al., Max Planck, arXiv 2605.15956, 2026): seeds are the 100 largest political channels by subscribers. "We assigned a download priority to queued chats equal to their observed out-degree, i.e., the number of times the crawler encountered forwards from the chat in already downloaded chats. The crawler always downloaded the chat with the highest priority of all discovered and not yet downloaded chats." Also crawled each channel's linked discussion group. Ran on 200 authenticated accounts across three worker machines because of per-account rate limits. Language from the first 100 messages, confidence threshold 0.8: Russian 56%, Farsi 15%; 83.3% of forwards stay within one language. Self-declared limitations: biased toward popular chats and cannot reach chats outside the seeds' connected component — [arXiv 2605.15956](https://arxiv.org/pdf/2605.15956).
- TeraGram also found that Telegram message ids shift when messages are deleted, so it matched replies and forward origins by timestamp — [arXiv 2605.15956](https://arxiv.org/pdf/2605.15956).
- An earlier Iran-only crawl (Hashemi and Chahooki) collected Iranian channels and groups to separate high- from low-quality groups; cited in TGDataset — [arXiv 2303.05345](https://arxiv.org/pdf/2303.05345).
- I found no maintained GitHub snowball crawler with a documented frontier or language filter. Search turned up forwarding bots and per-channel exporters (e.g. `tgc`, which exports configured chat ids and does not follow links) — [pypi tgc](https://pypi.org/project/tgc); [GESIS Telegram data collection](https://methodshub.gesis.org/library/methods/Telegram-Data-Collection/1/).

### Inferences
- The Russian drift we see is the expected outcome, not a bug. Every forward-snowball from mixed seeds converges on the Russian graph (36% to 82% Russian), because that graph is the largest and densest and in-degree-greedy ordering rewards density. TeraGram's 83.3% same-language forwards figure is the lever: the Reference graph is strongly language-assortative, so a language-weighted priority keeps the crawl inside the Persian/English component cheaply once seeds are there.
- TeraGram's "observed in-references from already-fetched chats" score is exactly the MOD heuristic (section 3) applied to Telegram, and is the closest published precedent for our frontier. Our extension is to count only references from fetched channels in the target languages, or to weight by the source's language.
- Research crawlers ignore user/group forward authors and links/mentions; we already mine more edge kinds (mentions, t.me links, cross-channel replies) than any of them, which raises recall but also raises the share of non-channel handles (users, bots) in the frontier.
- Nobody published a refresh policy. Research datasets are one-shot or annual snapshots, so refresh tiers have to come from web-crawling literature rather than Telegram precedent.

### Gaps
- Urman & Katz and the "Hoseini et al." Persian study named in the brief: not found. The only Hoseini et al. 2021 Telegram work I found is a 151-channel QAnon dataset, per TGDataset's related work.
- telepathy, Tosint, snscrape's telegram module, TeleScrape, telegram-tracker: not reviewed within budget; I could not confirm a repo matching "telegram-tracker" with snowball logic.

## 3. Social-graph crawling and sampling under a budget

### Takeaway
BFS and plain random walks over-sample high-degree nodes. MHRW or re-weighted walks fix that for unbiased estimation, which is not our goal. For "find the important nodes of a graph cheaply", greedy Maximum Observed Degree (MOD) wins most often, but it stalls inside a dense community and fails to cross thin bridges. For a Directory that wants coverage of a target-language community, that failure mode becomes the feature: greedy-by-observed-in-references, restricted to references from in-community sources, is a focused crawler.

### Cited Findings
- Gjoka et al. (INFOCOM 2010, "Walking in Facebook"): BFS and unadjusted random walks give substantially biased samples; BFS bias toward high-degree nodes is hard to characterise or correct; RW bias can be corrected by re-weighting (RWRW); MHRW yields a uniform stationary distribution directly. They added online convergence diagnostics to decide when a walk has enough samples — [arXiv 0906.0060](https://arxiv.org/pdf/0906.0060).
- Kurant, Markopoulou, Thiran ("On the bias of BFS"): an incomplete BFS is biased toward high-degree nodes; their Facebook BFS crawl overestimated average degree by about 3.5x — [arXiv 1004.1729](https://www.arxiv.org/pdf/1004.1729).
- Leskovec & Faloutsos (KDD 2006): random-walk and forest-fire sampling best preserve static and temporal graph patterns, down to ~15% sample size; edge-based selection does poorly; uniform random node selection does surprisingly well. Forest fire follows each neighbour with probability p (0.7 in follow-up comparisons, ~2.33 links per step) — [Leskovec & Faloutsos PDF](https://www.cs.upc.edu/~CSN/bib/LeskovecFaloutsos2006.pdf); [Empirical comparison, arXiv 1506.02449](https://arxiv.org/pdf/1506.02449).
- Comparison of six crawlers (RC, RW, BFS, DFS, MOD, Densification-Expansion; arXiv 2403.14351): no crawler wins overall and the winner changes with budget; for top-degree and top-k-core targets MOD and DE lead and random crawling is worst; MOD wins 16 AUC comparisons, about twice DE. MOD and BFS stall at 80-90% coverage on a graph of two communities joined by a small bridge, where random and DFS crawling escape better. Seed choice matters little above ~50K nodes. Lim et al. (cited there) found 5% of sampled nodes already held over 80% of the top-10 nodes — [arXiv 2403.14351](https://arxiv.org/html/2403.14351v1).
- Ye & Wu ("Crawling Online Social Graphs", APWeb 2010) compare crawlers on efficiency, sensitivity to protected users, and bias of graph properties; only the abstract was reachable — [Google Research](https://research.google/pubs/crawling-online-social-graphs/).
- A Facebook BFS study stopped on "at least three sub-levels of friendships" and a 240-hour run time — [arXiv 1105.6307](https://arxiv.org/pdf/1105.6307).

### Inferences
- Our goal is a coverage-and-usefulness crawl for one or two language communities, which maps onto MOD's target ("find the important nodes") rather than Gjoka's ("estimate a property without bias"). MHRW and RDS are the wrong tools here except for a small audit sample that estimates how much of the language community we are missing.
- MOD's community trap is what we want for Persian/English, and it is what pulled us into Russian: once a few Russian hubs were fetched, their in-references dominated observed degree. The fix is to score a candidate by references from fetched channels weighted by the source's language match (or by whether a user follows the source), not by raw count.
- Keep a small exploration share (random or forest-fire picks from unfetched candidates, say 5-10% of the budget) so the crawl can cross bridges into Persian/English sub-communities that the greedy score has not seen yet. 2403.14351's bridge result is the argument for it.
- Seed choice matters little on large graphs for global coverage, but it matters for which component greedy enters first. Seeding from what the deployment's users actually Follow is the cheapest focus signal available.

### Gaps
- No paper found that studies "crawl to cover a target language community" on Telegram specifically; focused web crawling and community-focused social crawling were not reviewed within budget.
- Respondent-driven sampling was not researched; it targets hidden-population estimation and does not apply to a public-handle crawl.

## 4. Refresh tiers in social analytics tools

### Takeaway
I found no public documentation of refresh tiers (daily for big channels, weekly for small) from any Telegram analytics service. The only numbers are an undated "at most daily" complaint about TGStat, TGStat's API offering hourly subscriber granularity, and a fediverse stats bot refreshing every 6 hours.

### Cited Findings
- TGStat statistics update "no more than once a day" (undated review) — [vc.ru](https://vc.ru/28969-servisy-dlya-analitiki-telegram-kanalov).
- TGStat API returns subscriber dynamics by hour, day, week or month — [rtgstat CRAN manual](https://cran.rstudio.com/web/packages/rtgstat/refman/rtgstat.html).
- Telemetr claims "real-time monitoring" with no interval — [telemetr.io/llms-ai.txt](https://telemetr.io/llms-ai.txt).
- A third-party fediverse bot that pulls fediverse.observer and instance APIs refreshes every 6 hours; fediverse.observer's own interval is undocumented — [discuss.jacen.moe thread](https://discuss.jacen.moe/post/144).
- TeleScope plans yearly snapshots; TGDataset is a single snapshot — [arXiv 2504.19536](https://arxiv.org/html/2504.19536v1); [arXiv 2303.05345v3](https://arxiv.org/html/2303.05345v3).

### Inferences
- Since no Telegram service documents tiers, a refresh policy has to be derived from our own observed change rates: post frequency from the ~13 posts on one t.me/s page gives an inter-post interval, and that interval is the natural refresh period (a channel posting weekly gains nothing from daily refetch). Subscriber-count change is a second, slower signal.

### Gaps
- No primary source for tier boundaries at TGStat, Telemetr, Combot or similar. The report should not present "1k/10k/100k subscriber tiers" as industry practice.

## 5. Operator-tunable controls and admin UI patterns

### Takeaway
The only documented operator-facing controls are TGStat's moderation of submitted channels and owner-editable category, geo and language. Research crawlers expose only a seed list. Fediverse crawlers show the main defensive control any reference-driven crawler needs, distrust of discovered names, because peer lists get polluted with fake entries.

### Cited Findings
- TGStat: submission form with rule-based moderation; channel owners can change category, geo and language, update avatar/info, and add channels to curated collections — [TGStat Academy index](https://tgstat.com/ru/academy); [Unisender blog](https://www.unisender.com/ru/blog/tgstat-chto-ehto-za-servis-i-chem-on-polezen/).
- Research crawlers' only knob is the seed list (TGStat top-N per category, or top political channels) — [arXiv 2303.05345v3](https://arxiv.org/html/2303.05345v3); [arXiv 2605.15956](https://arxiv.org/pdf/2605.15956).
- Fediverse crawlers recurse over `/api/v1/instance/peers` from a seed; isolated instances never appear; one developer saw tens of thousands of fake instances on random subdomains of one host injected into peer lists and advises treating all API data as untrusted — [nodes.fediverse.party](https://nodes.fediverse.party); [gist: recursive peers crawler](https://gist.github.com/jamesrashford/a9e58dfad0d3bbc0e27f00807567c441); [Simon Willison, 2024-01-12](https://simonwillison.net/2024/Jan/12).
- Fediverse hubs see different pictures of the network because of crawl fragmentation, which leads to differing stats — [dafr README](https://git.vvvvvvaria.org/rra/dafr).

### Inferences
- Controls worth exposing, adapted from the above: a seed list (default: what users Follow), a language allow/boost list, a blocklist by handle and by pattern, and a per-handle manual boost. TGStat's owner-editable language/geo suggests letting an admin correct a misdetected language, since a wrong label would misroute priority.
- The fediverse pollution case maps to spam bursts of @mentions or t.me links in one channel. Cap how much a single source channel can raise any one candidate's score.

### Gaps
- I found no public screenshots or docs of an admin UI that exposes crawl priority in any of these tools.

## 6. Telegram-specific constraints

### Takeaway
Bot usernames must end in "bot" (official), so a suffix test is a cheap pre-fetch filter. Usernames are a mutable, recallable, and (with collectibles) many-to-one alias for a peer, so the stable identity is the peer id, not the handle. On t.me/s, non-channels are visible from the response itself: a bot or user handle redirects to t.me/<handle>, and a bot page shows "Start Bot".

### Cited Findings
- "Usernames are 5-32 characters long and not case sensitive – but may only include Latin characters, numbers, and underscores." "Your bot's username must end in 'bot'" — [Telegram Bot features](https://core.telegram.org/bots/features).
- Basic usernames are first-come, first-served, case-insensitive (a-z, 0-9, underscore); Telegram reserves "the right to recall usernames assigned to unused bots and channels, as well as openly squatted usernames"; removing a username stops search discovery — [Telegram FAQ](https://telegram.org/faq).
- Accounts, bots, channels and supergroups can hold several collectible usernames (Fragment, TON-secured); when one is attached, the single `username` field is cleared and a `usernames` list is used; a new collectible starts inactive; a channel can go private by clearing its basic username and deactivating all usernames — [Telegram API: Fragment](https://core.telegram.org/api/fragment).
- Telegram imposes per-account API rate limits; TeraGram spread crawling over 200 accounts, TGDataset waited 5 s between history calls — [arXiv 2605.15956](https://arxiv.org/pdf/2605.15956); [arXiv 2303.05345v3](https://arxiv.org/html/2303.05345v3).
- Telegram message ids shift when messages are deleted (per TeraGram), so ids are not stable join keys for replies or forward origins — [arXiv 2605.15956](https://arxiv.org/pdf/2605.15956).
- My own probe of the web preview on 2026-10-15 (one request each, no proxy): `t.me/s/durov` and `t.me/s/telegram` returned 200 with channel counters and 20 message blocks each; `t.me/s/BotFather` redirected to `t.me/BotFather` with a "Start Bot" button and "7 560 507 monthly users"; a nonexistent handle redirected to `t.me/<handle>` with "Telegram: Contact @handle" and a "Send Message" button — direct probe of https://t.me/s/ (no external source).

### Inferences
- Pre-fetch filter: drop any candidate ending in `bot` (case-insensitive) and any outside 5-32 `[a-z0-9_]`. That costs zero fetches. The probe shows a redirect away from `/s/` already marks a non-channel, so one fetch is enough to classify and permanently down-rank users and missing handles. Nonexistent handles and real users look alike on the preview, so both belong in one "not a channel" state.
- Handle recycling (recall, Fragment sales, deactivation) means a handle seen in an old Reference may point to a different peer today. The t.me/s page does not expose the numeric channel id directly, so renames need a heuristic (matching title/avatar/post continuity) unless the id is obtained another way.
- The probe returned 20 message blocks rather than ~13 for two big channels; the number per page may vary by channel or post size, which matters if refresh intervals are derived from posts-per-page.

### Gaps
- No official documentation of t.me/s rate limits or flood behaviour; nothing found on how the web preview signals throttling.
- No official statement on whether user, channel and bot basic usernames share one namespace, though first-come-first-served uniqueness implies it.
