# Requests tab prototype (request stats)

A throwaway prototype of the Operator's **Requests** tab: where a deployment's Requests to
Telegram go, by kind of work, Account, Channel and outcome. It settled the design recorded in
`docs/request-stats-prototype-plan.md`, ADR-035 and the `RQS` spec. Never merge it; the build
follows the spec.

## What it shows

Open the workspace with `?tab=requests`. `?variant=` switches between:

- **0 Current**: today's per-Account quota usage table, unchanged, as the reference.
- **A Ranked tables** (the one chosen):
  - the filter bar: range, Charged/Uncharged, Accounts, and a spread with full screen;
  - an Account comparison and the stat strip;
  - the daily bar trend, and the zoomable Plotly trend with its four switches, outcome
    shades and capped scale;
  - By kind of work, and Channels by Requests with search, measure filters, New Posts per
    Request and Channel picking;
  - each Channel's Requests in a sheet.

`?bench=sparklines` opens the chart-library sparkline bench (Recharts, ECharts, Plotly).

## Data

The numbers are **synthetic**, scaled from a deployment's real daily totals:

- **Real inputs:** the quota ledger per Budget, probe totals and verdicts, and sync logs per
  Channel.
- **Invented:**
  - the split across Channels and hours, and every outcome;
  - handle checks and the Lane of each Request;
  - two extra Accounts, when the deployment has one.

So the totals are right, and the breakdowns are illustrative.

## Running it

1. A read-only database role on the deployment, reachable on a local port (see
   `docs/agents/prototyping-with-live-data.md`), with its password in `~/.pgpass`.
2. The prototype API, which needs an Operator's token to answer:

   ```bash
   PROTO_API_BASE=https://<api-base> PROTO_PG_USER=<role> PROTO_PORT=8131 \
     python backend/scripts/proto_request_stats_api.py
   ```

3. The frontend against the deployment's API, proxying `/proto` to that port:

   ```bash
   PROTO_API_PORT=8131 PLAYWRIGHT_API_URL=https://<api-base> bun run dev
   ```

Log in as the Operator and open the Requests tab.
