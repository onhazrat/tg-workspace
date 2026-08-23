# 14: Adaptive per-proxy wait

**What to build:** The scraper widens its wait after rejections and narrows it again on sustained success, per proxy, so we stop provoking rate limits without staying permanently slow.

**Blocked by:** 13

**Status:** ready-for-agent

- [ ] Wait state is held per proxy and survives across requests
- [ ] Explicit rejection or soft block widens it multiplicatively; sustained success narrows it gradually
- [ ] Latency drift contributes as a weak signal
- [ ] Behaviour is observable in telemetry
