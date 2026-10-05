"""PROTOTYPE, throwaway: the API behind the workspace's Find tab.

Ways to find a Channel to follow, one endpoint family each:
  /feed/{handle}/posts  the Posts of yours that pointed at a Channel
  /browse   filter and sort on every Directory column, references and search
  /graph    the reference graph around a Channel; /edge-posts the Posts behind an edge

It is deliberately NOT mounted in the real API, so no route guard sees it. It
reads the deployment's database live through a read-only role that may write
only its own scratch schema `proto` (connection string in PROTO_DSN; keep the
password in ~/.pgpass). Identity comes from forwarding the caller's bearer token
to the deployment API's /users/me (its base URL in PROTO_STAGING_API); the
frontend reaches this app through Vite's `/proto` proxy.

Run (from the repo root):
  PROTO_DSN=... PROTO_STAGING_API=... uv run python backend/scripts/proto_find_api.py
The first start builds the proto.* tables in batches (a few minutes).
"""

import json
import math
import os
import re
import sys
import threading
import time

import httpx
import psycopg
import uvicorn
from fastapi import Body, FastAPI, Header, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel

# Both must be set: the prototype names no deployment of its own.
DSN = os.environ["PROTO_DSN"]
STAGING_API = os.environ["PROTO_STAGING_API"].rstrip("/")

# A tiny pool, so a slow request never queues the others behind one locked
# connection. Capped below the proto role's CONNECTION LIMIT 5.
# ponytail: no psycopg_pool dependency; swap it in if this outlives the prototype.
_idle: list[psycopg.Connection] = []
_idle_lock = threading.Lock()
_slots = threading.BoundedSemaphore(4)


def q(sql: str, params: object = None) -> list[dict]:
    with _slots:
        for attempt in (1, 2):
            with _idle_lock:
                conn = _idle.pop() if _idle else None
            try:
                if conn is None or conn.closed:
                    conn = psycopg.connect(DSN, autocommit=True, row_factory=dict_row)
                    # Staging's Postgres container has Docker's default 64 MB
                    # /dev/shm, and a parallel hash join over the reference
                    # graph overflows it ("could not resize shared memory
                    # segment"), failing any parallel query running alongside.
                    # The prototype never runs parallel workers.
                    conn.execute("SET max_parallel_workers_per_gather = 0")
                cur = conn.execute(sql, params)  # type: ignore[arg-type]
                rows = cur.fetchall() if cur.description else []
            except psycopg.OperationalError:
                if attempt == 2:
                    raise
                continue
            with _idle_lock:
                _idle.append(conn)
            return rows
    return []


# --- build -------------------------------------------------------------------

LIVE = "d.status = 'ok' AND d.kind = 'channel'"
BATCH = 4000
SAMPLES_PER_DOC = 8


def build() -> None:
    # "Not interested", per account (E). The only table here a viewer writes.
    q("""CREATE TABLE IF NOT EXISTS proto.dismissed (
           user_id uuid NOT NULL, handle text NOT NULL,
           at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, handle))""")
    if not q("SELECT 1 FROM pg_tables WHERE schemaname='proto' AND tablename='degree'"):
        t = time.time()
        q("""CREATE TABLE proto.degree AS
             SELECT handle, sum(indeg)::int AS indeg, sum(outdeg)::int AS outdeg FROM (
               SELECT target_handle AS handle, count(DISTINCT source_channel) AS indeg, 0 AS outdeg
                 FROM tg_post_references GROUP BY 1
               UNION ALL
               SELECT source_channel, 0, count(DISTINCT target_handle)
                 FROM tg_post_references GROUP BY 1) x GROUP BY 1""")
        q("ALTER TABLE proto.degree ADD PRIMARY KEY (handle)")
        print(f"proto.degree built in {time.time() - t:.0f}s", flush=True)
    if q("SELECT 1 FROM pg_tables WHERE schemaname='proto' AND tablename='search_doc'"):
        return
    q("""CREATE TABLE IF NOT EXISTS proto.search_doc_building (
           handle text PRIMARY KEY, tsv tsvector NOT NULL)""")
    # Resumable: each batch starts after the last handle already written.
    last = (
        q('SELECT max(handle COLLATE "C") AS h FROM proto.search_doc_building')[0]["h"]
        or ""
    )
    t = time.time()
    while True:
        rows = q(
            f"""INSERT INTO proto.search_doc_building
                SELECT d.handle,
                  setweight(to_tsvector('simple', d.handle || ' ' || coalesce(d.display_name, '')), 'A')
                  || setweight(to_tsvector('simple', coalesce(d.bio, '')), 'B')
                  || setweight(to_tsvector('simple', left(coalesce(s.body, ''), 12000)), 'C')
                FROM (SELECT * FROM tg_channel_directory d
                      WHERE {LIVE} AND d.handle COLLATE "C" > %s ORDER BY d.handle COLLATE "C" LIMIT {BATCH}) d
                LEFT JOIN LATERAL (
                  SELECT string_agg(x.text, ' ') AS body FROM (
                    SELECT text FROM tg_channel_directory_samples s
                    WHERE s.handle = d.handle ORDER BY post_id DESC LIMIT {SAMPLES_PER_DOC}) x
                ) s ON true
                RETURNING handle""",
            (last,),
        )
        if not rows:
            break
        last = max(r["handle"] for r in rows)
        print(f"search_doc: through {last!r} ({time.time() - t:.0f}s)", flush=True)
    q("CREATE INDEX ON proto.search_doc_building USING gin (tsv)")
    q("ALTER TABLE proto.search_doc_building RENAME TO search_doc")
    print(f"proto.search_doc built in {time.time() - t:.0f}s", flush=True)


# --- shared ------------------------------------------------------------------

app = FastAPI(title="PROTOTYPE find api")
_users: dict[str, str] = {}

ENTRY = """d.handle, d.display_name, d.bio, d.subscribers, d.photo_url, d.language,
           d.posts_per_week, d.last_post_at, d.reach"""


def user_id(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "no token")
    if authorization not in _users:
        r = httpx.get(
            f"{STAGING_API}/api/v1/users/me",
            headers={"Authorization": authorization},
            timeout=15,
        )
        if r.status_code != 200:
            raise HTTPException(401, f"the API said {r.status_code}")
        _users[authorization] = r.json()["id"]
    return _users[authorization]


def followed_cte() -> str:
    return "fol AS (SELECT lower(channel_id) AS h FROM tg_channel_follows WHERE user_id = %(uid)s)"


def samples_for(handle: str) -> list[dict]:
    """Every stored sample of one Channel, newest first, media-only ones included."""
    return q(
        """SELECT post_id, text, timestamp, captured_at, links,
                  (media ->> 'viewsCount')::int AS views,
                  coalesce(media -> 'kinds', '[]'::json)::text <> '[]' AS has_media
           FROM tg_channel_directory_samples WHERE handle = %s ORDER BY post_id DESC""",
        (handle,),
    )


@app.get("/entry/{handle}")
def entry(handle: str, authorization: str | None = Header(None)) -> dict:
    uid = user_id(authorization)
    rows = q(
        f"""WITH {followed_cte()}
            SELECT {ENTRY}, d.handle IN (SELECT h FROM fol) AS following,
                   coalesce(g.indeg, 0) AS indeg
            FROM tg_channel_directory d LEFT JOIN proto.degree g USING (handle)
            WHERE d.handle = lower(%(h)s)""",
        {"uid": uid, "h": handle.lstrip("@")},
    )
    if not rows:
        raise HTTPException(404, "not in the Directory")
    return {
        "entry": rows[0],
        "samples": samples_for(rows[0]["handle"]),
    }


# Search words: letters and digits in any script.
WORD = re.compile(r"[\w]+", re.UNICODE)


# --- the Posts of yours that pointed at a Channel (E's "Why it's here") -------


@app.post("/feed/{handle}/posts")
def feed_posts(
    handle: str,
    sources: list[str] = Body(embed=True),
    days: int = 30,
    authorization: str | None = Header(None),
) -> dict:
    """Every Post of the selected Channels that pointed at `handle`, with its text."""
    uid = user_id(authorization)
    since = int((time.time() - days * 86400) * 1000)
    rows = q(
        """WITH f AS (SELECT channel_id FROM tg_channel_follows WHERE user_id = %(uid)s),
            r AS (
              SELECT source_channel, source_post_id, min(timestamp) AS timestamp,
                     array_agg(DISTINCT kind) AS kinds, max(target_post_id) AS target_post_id
              FROM tg_post_references
              WHERE target_handle = lower(%(h)s) AND timestamp > %(since)s
                AND source_channel = ANY(%(src)s)
              GROUP BY 1, 2)
            SELECT r.*, p.text, p.link_spans, src.display_name AS source_name, src.photo_url AS source_photo
            FROM r
            JOIN f ON lower(f.channel_id) = r.source_channel
            LEFT JOIN tg_posts p ON p.channel_name = f.channel_id AND p.post_id = r.source_post_id
            LEFT JOIN tg_channels src ON src.id = f.channel_id
            ORDER BY r.timestamp DESC LIMIT 30""",
        {"uid": uid, "h": handle, "src": [h.lower() for h in sources], "since": since},
    )
    return {"rows": rows}


# A source citing more than this many targets (or a target cited by more than
# this many sources) is an aggregator, not a taste signal.
HUB = 3000


# --- E: filter everything ----------------------------------------------------
# Modelled on the Channels and Posts tabs: facets (language, kinds), a list of
# bounded metrics each with its own histogram, handle conditions, sort.

# metric -> (SQL expression, scale). Every metric can be bounded and sorted on.
METRICS: dict[str, tuple[str, str]] = {
    "subscribers": ("d.subscribers", "log"),
    "reach": ("d.reach", "log"),
    "posts_per_week": ("d.posts_per_week", "log"),
    "forward_pct": ("d.forward_share * 100", "linear"),
    "last_post_days": ("extract(epoch FROM now() - d.last_post_at) / 86400", "log"),
    "found_days": ("extract(epoch FROM now() - d.created_at) / 86400", "linear"),
    "photos": ("d.photos", "log"),
    "videos": ("d.videos", "log"),
    "files": ("d.files", "log"),
    "links": ("d.links", "log"),
    "samples": ("d.sample_count", "linear"),
    "indeg": ("g.indeg", "log"),
    "outdeg": ("g.outdeg", "log"),
    "mine": ("m.n", "log"),
    # Days since one of your Channels last pointed at it (inside the window).
    "mine_last_days": (
        "(extract(epoch FROM now()) - m.last_at / 1000.0) / 86400",
        "log",
    ),
    # Shared parents / children with the picks, weighed against how connected
    # the candidate is overall; each only exists while its criterion is on.
    "shared_parents": ("par.score", "linear"),
    "shared_children": ("chi.score", "linear"),
}


class Bound(BaseModel):
    metric: str
    mode: str = "atLeast"  # atLeast | atMost | between | none
    min: float | None = None
    max: float | None = None
    negate: bool = False


class Filters(BaseModel):
    q: str = ""
    q_in: list[str] = ["name", "bio", "posts"]  # tsvector weights A, B, C
    name_like: str = ""
    langs: list[str] = []
    langs_not: list[str] = []
    bounds: list[Bound] = []
    cited_by: list[str] = []  # any of these handles cites it
    cites: list[str] = []  # it cites any of these handles
    ref_kinds: list[str] = []
    sources: list[str] = []  # for "mine": empty = every follow
    has_photo: bool = False
    hide_followed: bool = True
    include_unavailable: bool = False
    dismissed: str = "hide"  # hide | show | only: the "Not interested" Channels
    sort: str = "subscribers"
    desc: bool = True
    limit: int = 100
    offset: int = 0
    count_only: bool = False
    # C folded in, as its two signals. The client sends the picks (typed, the
    # Channels tab selection, or every follow); a candidate needs `*_min` shared.
    # Shared parents: Channels that cite a pick also cite it (co-citation).
    parents_of: list[str] = []
    parents_min: int = 2
    # Shared children: it cites what the picks cite (bibliographic coupling).
    children_of: list[str] = []
    children_min: int = 2
    # B folded in: count "your channels" only over the last N days.
    mentioned_days: int | None = None
    snippets: bool = True  # quote the matching Post and bio while searching
    # The Directory filter as the shared AND/OR/NOT tree (the bar variants T, Q
    # and R). It ANDs with the flat fields above, which those variants leave at
    # their widest (hide_followed false, dismissed "show", include_unavailable).
    tree: dict | None = None


WEIGHT = {"name": "A", "bio": "B", "posts": "C"}

TREE_MAX_NODES = 80
FLAGS = {
    "followed": "d.handle IN (SELECT h FROM fol)",
    "dismissed": "d.handle IN (SELECT handle FROM proto.dismissed WHERE user_id = %(uid)s)",
    "available": "d.status = 'ok'",
    "photo": "d.photo_url IS NOT NULL",
}


def _tree_nodes(node: dict) -> list[dict]:
    return [node] + [n for c in node.get("children", []) for n in _tree_nodes(c)]


def _tree_atoms(tree: dict | None) -> list[dict]:
    return (
        [n["cond"] for n in _tree_nodes(tree) if n.get("kind") == "atom"]
        if tree
        else []
    )


def _cond_sql(c: dict, f: Filters, p: dict, skip_lang: bool) -> str | None:
    """One Condition as a boolean SQL expression; None leaves it out."""
    key = f"t{len(p)}"
    kinds = "AND r.kind = ANY(%(kinds)s)" if f.ref_kinds else ""
    match c.get("type"):
        case "language":
            if skip_lang:
                return None
            p[key] = c["value"]
            return f"coalesce(d.language, '?') = %({key})s"
        case "flag":
            return FLAGS.get(c["value"])
        case "name":
            p[key] = f"%{c['value']}%"
            return f"(d.handle ILIKE %({key})s OR d.display_name ILIKE %({key})s)"
        case "metric":
            b = Bound(
                metric=c["metric"],
                mode=c.get("mode", "atLeast"),
                min=c.get("min"),
                max=c.get("max"),
            )
            if (b.metric == "shared_parents" and not f.parents_of) or (
                b.metric == "shared_children" and not f.children_of
            ):
                return "false"
            return _bound_sql(b, p, len(p))
        case "cited_by" | "cites":
            p[key] = [h.lstrip("@").lower() for h in c.get("handles", [])]
            mine, other = (
                ("target_handle", "source_channel")
                if c["type"] == "cited_by"
                else ("source_channel", "target_handle")
            )
            return f"d.handle IN (SELECT r.{mine} FROM tg_post_references r WHERE r.{other} = ANY(%({key})s) {kinds})"
        case "mine":
            # The window is the m CTE's, from mentioned_days (the client sends the first one).
            return "coalesce(m.n, 0) > 0"
        case "parents":
            return "par.handle IS NOT NULL" if f.parents_of else "false"
        case "children":
            return "chi.handle IS NOT NULL" if f.children_of else "false"
    return None


def _tree_sql(node: dict, f: Filters, p: dict, skip_lang: bool = False) -> str | None:
    """AND/OR/NOT over the Conditions; an empty group passes everything, negated or not."""
    if node.get("kind") == "atom":
        sql = _cond_sql(node["cond"], f, p, skip_lang)
        sql = sql and f"coalesce(({sql}), false)"
    else:
        parts = [
            x for c in node.get("children", []) if (x := _tree_sql(c, f, p, skip_lang))
        ]
        joiner = " OR " if node.get("op") == "or" else " AND "
        sql = f"({joiner.join(parts)})" if parts else None
    return f"(NOT {sql})" if sql and node.get("not") else sql


def _bound_sql(b: Bound, p: dict, i: int) -> str | None:
    if b.metric not in METRICS:
        return None
    col = METRICS[b.metric][0]
    if b.mode == "none":
        cond = f"({col}) IS NULL"
    else:
        parts = []
        if b.mode in ("atLeast", "between") and b.min is not None:
            p[f"b{i}min"] = b.min
            parts.append(f"({col}) >= %(b{i}min)s")
        if b.mode in ("atMost", "between") and b.max is not None:
            p[f"b{i}max"] = b.max
            parts.append(f"({col}) <= %(b{i}max)s")
        if not parts:
            return None
        cond = " AND ".join(parts)
    return f"NOT coalesce({cond}, false)" if b.negate else f"coalesce({cond}, false)"


def _where(
    f: Filters, p: dict, skip_lang: bool = False, skip_metric: str | None = None
) -> list[str]:
    w = ["d.kind = 'channel'"] if f.include_unavailable else [LIVE]
    if f.name_like:
        p["like"] = f"%{f.name_like}%"
        w.append("(d.handle ILIKE %(like)s OR d.display_name ILIKE %(like)s)")
    if not skip_lang:
        if f.langs:
            p["langs"] = f.langs
            w.append("coalesce(d.language, '?') = ANY(%(langs)s)")
        if f.langs_not:
            p["langs_not"] = f.langs_not
            w.append("coalesce(d.language, '?') <> ALL(%(langs_not)s)")
    for i, b in enumerate(f.bounds):
        if (b.metric == "shared_parents" and not f.parents_of) or (
            b.metric == "shared_children" and not f.children_of
        ):
            continue  # the score only exists while its criterion is on
        if b.metric != skip_metric and (sql := _bound_sql(b, p, i)):
            w.append(sql)
    if f.has_photo:
        w.append("d.photo_url IS NOT NULL")
    kinds = "AND r.kind = ANY(%(kinds)s)" if f.ref_kinds else ""
    if f.cited_by:
        p["cited_by"] = [h.lstrip("@").lower() for h in f.cited_by]
        w.append(
            f"d.handle IN (SELECT r.target_handle FROM tg_post_references r WHERE r.source_channel = ANY(%(cited_by)s) {kinds})"
        )
    if f.cites:
        p["cites"] = [h.lstrip("@").lower() for h in f.cites]
        w.append(
            f"d.handle IN (SELECT r.source_channel FROM tg_post_references r WHERE r.target_handle = ANY(%(cites)s) {kinds})"
        )
    if f.hide_followed:
        w.append("d.handle NOT IN (SELECT h FROM fol)")
    if f.dismissed in ("hide", "only"):
        op = "NOT IN" if f.dismissed == "hide" else "IN"
        w.append(
            f"d.handle {op} (SELECT handle FROM proto.dismissed WHERE user_id = %(uid)s)"
        )
    if f.tree:
        if len(_tree_nodes(f.tree)) > TREE_MAX_NODES:
            raise HTTPException(400, "the filter is too big")
        if sql := _tree_sql(f.tree, f, p, skip_lang):
            w.append(sql)
    else:
        # The relatives use a left join so a tree can OR them; the flat filter
        # still means "must be one".
        if f.parents_of:
            w.append("par.handle IS NOT NULL")
        if f.children_of:
            w.append("chi.handle IS NOT NULL")
    return w


# C's two signals, for any number of picks, kept apart so each says one thing.
# Each count is weighed against the candidate's own degree, or every list is
# @durov; sources and targets past HUB links are aggregators, not taste.
PARENTS_CTES = f"""
    par_src AS (
      SELECT DISTINCT r.source_channel AS s FROM tg_post_references r
      JOIN proto.degree g ON g.handle = r.source_channel
      WHERE r.target_handle = ANY(%(p_seeds)s) AND r.source_channel <> ALL(%(p_seeds)s)
        AND g.outdeg < {HUB}),
    par AS (
      SELECT c.handle, c.n, c.via,
             c.n / sqrt(greatest(gd.indeg, 1) * greatest((SELECT count(*) FROM par_src), 1))
               AS score
      FROM (SELECT r.target_handle AS handle, count(DISTINCT r.source_channel) AS n,
                   (array_agg(DISTINCT r.source_channel))[1:3] AS via
            FROM tg_post_references r JOIN par_src ON r.source_channel = par_src.s
            GROUP BY 1) c
      LEFT JOIN proto.degree gd ON gd.handle = c.handle
      WHERE c.n >= %(p_min)s AND c.handle <> ALL(%(p_seeds)s))"""

CHILDREN_CTES = f"""
    chi_tgt AS (
      SELECT DISTINCT r.target_handle AS t FROM tg_post_references r
      JOIN proto.degree g ON g.handle = r.target_handle
      WHERE r.source_channel = ANY(%(c_seeds)s) AND r.target_handle <> ALL(%(c_seeds)s)
        AND g.indeg < {HUB}),
    chi AS (
      SELECT c.handle, c.n, c.via,
             c.n / sqrt(greatest(gd.outdeg, 1) * greatest((SELECT count(*) FROM chi_tgt), 1))
               AS score
      FROM (SELECT r.source_channel AS handle, count(DISTINCT r.target_handle) AS n,
                   (array_agg(DISTINCT r.target_handle))[1:3] AS via
            FROM tg_post_references r JOIN chi_tgt ON r.target_handle = chi_tgt.t
            GROUP BY 1) c
      LEFT JOIN proto.degree gd ON gd.handle = c.handle
      WHERE c.n >= %(c_min)s AND c.handle <> ALL(%(c_seeds)s))"""


def _relatives(f: Filters, p: dict) -> tuple[str, str]:
    """The CTEs and inner joins for whichever of the two signals is on."""
    ctes, join = "", ""
    if f.parents_of:
        p["p_seeds"] = sorted({h.lstrip("@").lower() for h in f.parents_of})
        p["p_min"] = max(1, f.parents_min)
        ctes += f", {PARENTS_CTES}"
        join += " LEFT JOIN par USING (handle)"
    if f.children_of:
        p["c_seeds"] = sorted({h.lstrip("@").lower() for h in f.children_of})
        p["c_min"] = max(1, f.children_min)
        ctes += f", {CHILDREN_CTES}"
        join += " LEFT JOIN chi USING (handle)"
    return ctes, join


def _ctes(f: Filters, p: dict) -> tuple[str, str, bool]:
    """The WITH list, the joins, and whether a text search is on."""
    p |= {"kinds": f.ref_kinds, "src": [h.lower() for h in f.sources]}
    src = (
        "r.source_channel = ANY(%(src)s)"
        if f.sources
        else "r.source_channel IN (SELECT h FROM fol)"
    )
    kinds = "AND r.kind = ANY(%(kinds)s)" if f.ref_kinds else ""
    window = ""
    if f.mentioned_days:
        p["since"] = int((time.time() - f.mentioned_days * 86400) * 1000)
        window = "AND r.timestamp > %(since)s"
    ctes = f"""{followed_cte()},
        m AS (SELECT r.target_handle AS handle, count(DISTINCT r.source_channel) AS n,
                     max(r.timestamp) AS last_at
              FROM tg_post_references r WHERE {src} {kinds} {window} GROUP BY 1)"""
    join = "LEFT JOIN proto.degree g USING (handle) LEFT JOIN m USING (handle)"
    rel_ctes, rel_join = _relatives(f, p)
    ctes += rel_ctes
    join += rel_join
    words = WORD.findall(f.q.lower())[:6]
    weights = "".join(WEIGHT[x] for x in f.q_in if x in WEIGHT) or "ABC"
    if words:
        p["tsq"] = " & ".join(f"{x}:*{weights}" for x in words)
        ctes += """, h AS (SELECT handle, ts_rank(tsv, to_tsquery('simple', %(tsq)s), 1) AS rank
                      FROM proto.search_doc WHERE tsv @@ to_tsquery('simple', %(tsq)s))"""
        join += " JOIN h USING (handle)"
    return ctes, join, bool(words)


PARENT_COLS = """par.n AS parents_n, par.via AS parents_via,
               round(par.score::numeric, 4)::float8 AS parents_score,"""
CHILD_COLS = """chi.n AS children_n, chi.via AS children_via,
               round(chi.score::numeric, 4)::float8 AS children_score,"""


# The total and the language counts depend on the filters but not on the sort or
# the page, and counting every matching row is the one slow part left once the
# network is out of the way (~1.5 s with no filters, all 320K channels). So they
# are kept per (account, filters) for a few minutes; paging, re-sorting and
# toggling snippets then skip them.
# ponytail: a follow made within the TTL can leave "hide followed" counts a few
# minutes stale; key on the follow count if that ever matters.
COUNTS_TTL = 300
_counts: dict[str, tuple[float, int, list | None]] = {}


def _counts_key(uid: str, f: Filters) -> str:
    shape = f.model_dump(
        exclude={"sort", "desc", "offset", "limit", "snippets", "count_only"}
    )
    return uid + json.dumps(shape, sort_keys=True, default=str)


def _cached_counts(key: str, need_langs: bool) -> tuple[int, list | None] | None:
    hit = _counts.get(key)
    if (
        hit is None
        or time.time() - hit[0] > COUNTS_TTL
        or (need_langs and hit[2] is None)
    ):
        return None
    return hit[1], hit[2]


def _forget_counts(uid: str) -> None:
    """A dismissal changes what every one of this account's filters counts."""
    for key in [k for k in _counts if k.startswith(uid)]:
        _counts.pop(key, None)


@app.post("/dismiss/{handle}")
def dismiss(handle: str, authorization: str | None = Header(None)) -> dict:
    uid = user_id(authorization)
    q(
        "INSERT INTO proto.dismissed (user_id, handle) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (uid, handle.lstrip("@").lower()),
    )
    _forget_counts(uid)
    return {"ok": True}


@app.delete("/dismiss/{handle}")
def undismiss(handle: str, authorization: str | None = Header(None)) -> dict:
    uid = user_id(authorization)
    q(
        "DELETE FROM proto.dismissed WHERE user_id = %s AND handle = %s",
        (uid, handle.lstrip("@").lower()),
    )
    _forget_counts(uid)
    return {"ok": True}


def _store_counts(key: str, total: int, langs: list | None) -> None:
    if len(_counts) > 500:
        _counts.clear()
    old = _counts.get(key)
    if langs is None and old and old[2] is not None:
        langs = old[2]  # a count-only refresh keeps the languages it did not recount
    _counts[key] = (time.time(), total, langs)


@app.post("/browse")
def browse(f: Filters, authorization: str | None = Header(None)) -> dict:
    uid = user_id(authorization)
    p: dict = {"uid": uid}
    t = time.time()
    ctes, join, searching = _ctes(f, p)
    where = " AND ".join(_where(f, p))
    key = _counts_key(uid, f)
    # The graph tables (proto.degree, the "your channels" CTE) are joined to
    # every candidate only when a filter or the sort reads them. Otherwise the
    # page is picked from the Directory alone and they are joined to its 100
    # rows: that cut the unfiltered page from ~1.3 s to well under one.
    graph = {"indeg", "outdeg", "mine", "mine_last_days"}
    needs_graph = (
        f.sort in graph
        or any(b.metric in graph for b in f.bounds)
        or any(
            c.get("type") == "mine" or c.get("metric") in graph
            for c in _tree_atoms(f.tree)
        )
    )
    light = (
        join
        if needs_graph
        else (" JOIN h USING (handle)" if searching else "") + _relatives(f, {})[1]
    )
    if f.count_only:
        if hit := _cached_counts(key, need_langs=False):
            return {
                "total": hit[0],
                "ms": round((time.time() - t) * 1000),
                "cached": True,
            }
        n = q(
            f"WITH {ctes} SELECT count(*) AS n FROM tg_channel_directory d {light} WHERE {where}",
            p,
        )[0]["n"]
        _store_counts(key, n, None)
        return {"total": n, "ms": round((time.time() - t) * 1000)}
    cached = _cached_counts(key, need_langs=True)
    if f.sort == "relevance" and searching:
        # A's ranking: match strength, weighted by channel size.
        sort = "h.rank * ln(10 + coalesce(d.subscribers, 0))"
    elif (f.sort == "shared_parents" and not f.parents_of) or (
        f.sort == "shared_children" and not f.children_of
    ):
        sort = "d.subscribers"  # no picks, no score
    else:
        sort = METRICS.get(
            f.sort, ("d.handle" if f.sort == "handle" else "d.subscribers", "")
        )[0]
    p |= {"limit": min(f.limit, 200), "offset": f.offset}
    lang_where = " AND ".join(_where(f, p, skip_lang=True))
    # Snippets ride the same statement, so a search costs one round trip.
    # The stored samples carry no weights, so they match the plain query.
    snip_posts = searching and f.snippets and "posts" in f.q_in
    snip_bio = searching and f.snippets and "bio" in f.q_in
    if searching:
        p["tsq_plain"] = " & ".join(f"{x}:*" for x in WORD.findall(f.q.lower())[:6])
    match_sql = (
        """(SELECT json_build_object('post_id', s.post_id, 'timestamp', s.timestamp,
               'snippet', ts_headline('simple', s.text, to_tsquery('simple', %(tsq_plain)s),
                 'StartSel=«,StopSel=»,MaxWords=28,MinWords=12,MaxFragments=1'))
            FROM tg_channel_directory_samples s
            WHERE s.handle = pg.handle
              AND to_tsvector('simple', s.text) @@ to_tsquery('simple', %(tsq_plain)s)
            ORDER BY s.post_id DESC LIMIT 1)"""
        if snip_posts
        else "NULL::json"
    )
    bio_sql = (
        """CASE WHEN to_tsvector('simple', coalesce(pg.bio, '')) @@ to_tsquery('simple', %(tsq_plain)s)
               THEN ts_headline('simple', pg.bio, to_tsquery('simple', %(tsq_plain)s),
                 'StartSel=«,StopSel=»,MaxWords=30,MinWords=10') END"""
        if snip_bio
        else "NULL::text"
    )
    out = q(
        f"""WITH {ctes},
            pg AS (
              SELECT d.handle {"" if cached else ", count(*) OVER () AS total"}
              FROM tg_channel_directory d {light}
              WHERE {where}
              ORDER BY ({sort}) {"DESC" if f.desc else "ASC"} NULLS LAST, d.handle
              LIMIT %(limit)s OFFSET %(offset)s),
            numbered AS (
              SELECT n.pos, {
            ENTRY
        }, d.forward_share, d.photos, d.videos, d.files, d.links,
                     d.reach_estimated, d.created_at AS first_seen, d.sample_count, d.status,
                     coalesce(g.indeg, 0) AS indeg, coalesce(g.outdeg, 0) AS outdeg,
                     coalesce(m.n, 0) AS mine, m.last_at AS mine_last_at,
                     {PARENT_COLS if f.parents_of else ""}
                     {CHILD_COLS if f.children_of else ""}
                     d.handle IN (SELECT h FROM fol) AS following,
                     d.handle IN (SELECT handle FROM proto.dismissed WHERE user_id = %(uid)s)
                       AS dismissed
              FROM (SELECT row_number() OVER () AS pos, handle FROM pg) n
              JOIN tg_channel_directory d USING (handle)
              LEFT JOIN proto.degree g USING (handle)
              LEFT JOIN m USING (handle)
              {"LEFT JOIN par USING (handle)" if f.parents_of else ""}
              {"LEFT JOIN chi USING (handle)" if f.children_of else ""})
            {
            ""
            if cached
            else f''',
            langs AS (
              SELECT coalesce(d.language, '?') AS language, count(*) AS n
              FROM tg_channel_directory d {light} WHERE {lang_where}
              GROUP BY 1 ORDER BY 2 DESC LIMIT 40)'''
        }
            SELECT
              (SELECT coalesce(json_agg(x.row ORDER BY x.pos), '[]'::json) FROM (
                 -- The bio stays out of the list: the drawer reads it from /entry, and
                 -- every byte crosses a ~100 KB/s tunnel in this prototype.
                 SELECT pg.pos, (to_jsonb(pg) - 'bio' - 'pos')
                        || jsonb_build_object('match', {match_sql}, 'bio_hl', {
            bio_sql
        }) AS row
                 FROM numbered pg) x) AS rows,
              {
            "NULL::json"
            if cached
            else "(SELECT coalesce(json_agg(langs ORDER BY langs.n DESC), '[]'::json) FROM langs)"
        } AS langs,
              {
            "NULL::bigint" if cached else "(SELECT total FROM pg LIMIT 1)"
        } AS total""",
        p,
    )[0]
    if cached:
        total, langs = cached
    else:
        # An offset past the end returns no rows and so no window count; 0 is
        # then only a guess, so it is not kept.
        total, langs = out["total"] or 0, out["langs"]
        if out["total"] is not None:
            _store_counts(key, total, langs)
    return {
        "rows": out["rows"],
        "total": total,
        "langs": langs,
        "ms": round((time.time() - t) * 1000),
        "cached": cached is not None,
    }


class HistogramIn(BaseModel):
    filters: Filters
    metric: str


@app.post("/histogram")
def histogram(body: HistogramIn, authorization: str | None = Header(None)) -> dict:
    """The distribution of one metric under every other filter, for its editor."""
    f, metric = body.filters, body.metric
    if metric not in METRICS:
        raise HTTPException(400, "unknown metric")
    col, scale = METRICS[metric]
    p: dict = {"uid": user_id(authorization)}
    ctes, join, _ = _ctes(f, p)
    where = " AND ".join(_where(f, p, skip_metric=metric))
    x = (
        f"ln(greatest(({col})::float8, 0) + 1)"
        if scale == "log"
        else f"(({col})::float8)"
    )
    stats = q(
        f"""WITH {ctes}, v AS (SELECT ({col})::float8 AS val FROM tg_channel_directory d {join} WHERE {where})
            SELECT count(*) AS total, count(val) AS measured, min(val) AS lo, max(val) AS hi,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY val) AS median FROM v""",
        p,
    )[0]
    bins: list[dict] = []
    if stats["measured"] and stats["hi"] is not None and stats["hi"] > stats["lo"]:
        f_ = (lambda v: math.log(max(v, 0) + 1)) if scale == "log" else (lambda v: v)
        inv = (lambda u: math.exp(u) - 1) if scale == "log" else (lambda u: u)
        lo, hi = f_(stats["lo"]), f_(stats["hi"])
        n_bins = 32
        p |= {"lo": lo, "hi": hi, "nb": n_bins}
        counts = {
            r["b"]: r["n"]
            for r in q(
                f"""WITH {ctes} SELECT least(width_bucket({x}, %(lo)s, %(hi)s, %(nb)s), %(nb)s) AS b, count(*) AS n
                    FROM tg_channel_directory d {join} WHERE {where} AND ({col}) IS NOT NULL GROUP BY 1""",
                p,
            )
        }
        step = (hi - lo) / n_bins
        bins = [
            {
                "lo": inv(lo + i * step),
                "hi": inv(lo + (i + 1) * step),
                "n": counts.get(i + 1, 0),
            }
            for i in range(n_bins)
        ]
    return {**stats, "scale": scale, "bins": bins}


# --- G: the reference graph --------------------------------------------------
# A Channel is a node; an edge is every Post in which one Channel forwarded,
# mentioned, linked or replied to another, counted in distinct Posts (a plain
# @handle is stored as both a mention and a link, so rows would double count).
# Edges are undirected pairs carrying a count per direction, so a pair that
# cites each other both ways is one edge with two arrowheads.


class GraphIn(BaseModel):
    centre: str
    hops: int = 1  # 1 or 2
    per_node: int = 15  # neighbours kept per node at the first hop
    per_node_2: int = 5  # and at the second
    min_posts: int = 1  # an edge needs at least this many Posts
    kinds: list[str] = []  # empty = every kind
    direction: str = "both"  # both | in (who cites it) | out (whom it cites)
    expand: list[str] = []  # extra nodes whose neighbours are added (per_node_2 each)
    hidden: list[str] = []  # handles left out of the graph
    # Leave out handles the Directory has not found to be a live Channel: many
    # are misspellings that Posts really linked to (@bbcpersin for @bbcpersian).
    live_only: bool = True


def _neighbours(
    frontier: list[str], g: GraphIn, cap: int, exclude: set[str]
) -> list[str]:
    """The top `cap` neighbours of each frontier node, by Posts across the pair."""
    if not frontier:
        return []
    p = {
        "front": frontier,
        "kinds": g.kinds,
        "cap": cap,
        "min": g.min_posts,
        "excl": list(exclude),
    }
    kinds = "AND r.kind = ANY(%(kinds)s)" if g.kinds else ""
    live = (
        """AND EXISTS (SELECT 1 FROM tg_channel_directory d
                       WHERE d.handle = e.other AND d.status = 'ok' AND d.kind = 'channel')"""
        if g.live_only
        else ""
    )
    sides = []
    if g.direction in ("both", "out"):
        sides.append(f"""SELECT r.source_channel AS f, r.target_handle AS other, r.source_channel, r.source_post_id
              FROM tg_post_references r WHERE r.source_channel = ANY(%(front)s) {kinds}""")
    if g.direction in ("both", "in"):
        sides.append(f"""SELECT r.target_handle AS f, r.source_channel AS other, r.source_channel, r.source_post_id
              FROM tg_post_references r WHERE r.target_handle = ANY(%(front)s) {kinds}""")
    rows = q(
        f"""WITH e AS ({" UNION ALL ".join(sides)}),
            pairs AS (
              SELECT f, other, count(DISTINCT (source_channel, source_post_id)) AS n
              FROM e WHERE other <> f AND other <> ALL(%(excl)s) {live} GROUP BY 1, 2
              HAVING count(DISTINCT (source_channel, source_post_id)) >= %(min)s),
            ranked AS (SELECT *, row_number() OVER (PARTITION BY f ORDER BY n DESC, other) AS rk FROM pairs)
            SELECT DISTINCT other FROM ranked WHERE rk <= %(cap)s""",
        p,
    )
    return [r["other"] for r in rows]


@app.post("/graph")
def graph(g: GraphIn, authorization: str | None = Header(None)) -> dict:
    uid = user_id(authorization)
    t = time.time()
    centre = g.centre.lstrip("@").lower()
    hidden = {h.lower() for h in g.hidden} - {centre}
    nodes: list[str] = [centre]
    first = _neighbours([centre], g, g.per_node, hidden)
    nodes += [h for h in first if h not in nodes]
    if g.hops >= 2:
        nodes += [
            h for h in _neighbours(first, g, g.per_node_2, hidden) if h not in nodes
        ]
    expand = [h.lower() for h in g.expand if h.lower() not in hidden]
    nodes += [h for h in expand if h not in nodes]
    nodes += [h for h in _neighbours(expand, g, g.per_node_2, hidden) if h not in nodes]
    nodes = nodes[:400]  # ponytail: hard cap so a hub cannot freeze the layout
    p = {"nodes": nodes, "kinds": g.kinds, "min": g.min_posts, "uid": uid}
    kinds = "AND r.kind = ANY(%(kinds)s)" if g.kinds else ""
    # Every edge among the chosen nodes, not only the ones the walk used, so
    # neighbours that cite each other show it.
    out = q(
        f"""WITH {followed_cte()},
            e AS (
              SELECT r.source_channel AS s, r.target_handle AS t, r.source_post_id AS pid, r.kind
              FROM tg_post_references r
              WHERE r.source_channel = ANY(%(nodes)s) AND r.target_handle = ANY(%(nodes)s)
                AND r.source_channel <> r.target_handle {kinds}),
            pairs AS (
              -- Within one direction the source is fixed, so distinct post ids are distinct Posts.
              SELECT least(s, t) AS a, greatest(s, t) AS b,
                     count(DISTINCT pid) FILTER (WHERE s < t) AS a_to_b,
                     count(DISTINCT pid) FILTER (WHERE s > t) AS b_to_a,
                     array_agg(DISTINCT kind) AS kinds
              FROM e GROUP BY 1, 2)
            SELECT
              (SELECT coalesce(json_agg(pairs), '[]'::json) FROM pairs WHERE a_to_b + b_to_a >= %(min)s) AS edges,
              (SELECT coalesce(json_agg(json_build_object(
                  'handle', n.h, 'display_name', d.display_name, 'subscribers', d.subscribers,
                  'photo_url', d.photo_url, 'language', d.language, 'status', d.status,
                  'kind', d.kind, 'last_post_at', d.last_post_at, 'posts_per_week', d.posts_per_week,
                  'reach', d.reach, 'bio', NULL,
                  'following', n.h IN (SELECT h FROM fol),
                  'indeg', coalesce(g.indeg, 0), 'outdeg', coalesce(g.outdeg, 0))), '[]'::json)
               FROM unnest(%(nodes)s::text[]) AS n(h)
               LEFT JOIN tg_channel_directory d ON d.handle = n.h
               LEFT JOIN proto.degree g ON g.handle = n.h) AS nodes""",
        p,
    )[0]
    return {"centre": centre, **out, "ms": round((time.time() - t) * 1000)}


@app.get("/edge-posts")
def edge_posts(a: str, b: str, authorization: str | None = Header(None)) -> dict:
    """Every Post behind the edge a <-> b, both directions, newest first, with its text."""
    user_id(authorization)
    a, b = a.lstrip("@").lower(), b.lstrip("@").lower()
    rows = q(
        """WITH r AS (
              SELECT source_channel, target_handle, source_post_id,
                     max(timestamp) AS timestamp, array_agg(DISTINCT kind) AS kinds,
                     max(target_post_id) AS target_post_id
              -- One indexed half per direction; an OR across the pair scans instead.
              FROM (SELECT * FROM tg_post_references WHERE source_channel = %(a)s AND target_handle = %(b)s
                    UNION ALL
                    SELECT * FROM tg_post_references WHERE source_channel = %(b)s AND target_handle = %(a)s) x
              GROUP BY 1, 2, 3)
           SELECT r.*, coalesce(p.text, s.text) AS text, p.link_spans,
                  CASE WHEN p.text IS NOT NULL THEN 'synced'
                       WHEN s.text IS NOT NULL THEN 'sample' END AS text_from
           FROM r
           LEFT JOIN tg_channels c ON lower(c.id) = r.source_channel
           LEFT JOIN tg_posts p ON p.channel_name = c.id AND p.post_id = r.source_post_id
           LEFT JOIN tg_channel_directory_samples s
                  ON s.handle = r.source_channel AND s.post_id = r.source_post_id
           ORDER BY r.timestamp DESC LIMIT 200""",
        {"a": a, "b": b},
    )
    return {"rows": rows}


@app.get("/lookup")
def lookup(prefix: str, authorization: str | None = Header(None)) -> list[dict]:
    """Handles starting with `prefix`, biggest first, for the graph's start box."""
    user_id(authorization)
    pre = prefix.lstrip("@").lower().strip()
    if len(pre) < 2:
        return []
    return q(
        """SELECT handle, display_name, subscribers, photo_url FROM tg_channel_directory
           WHERE handle LIKE %(p)s AND kind = 'channel'
           ORDER BY subscribers DESC NULLS LAST LIMIT 8""",
        # Handles are full of underscores, which LIKE would read as a wildcard.
        {"p": pre.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"},
    )


@app.get("/neighbours/{handle}")
def neighbours(handle: str, authorization: str | None = Header(None)) -> dict:
    """Who cites `handle` most, and whom it cites most."""
    user_id(authorization)
    h = handle.lstrip("@").lower()

    def side(mine: str, other: str) -> list[dict]:
        return q(
            f"""SELECT x.handle, x.posts, x.kinds, d.display_name, d.photo_url, d.subscribers
                FROM (SELECT r.{other} AS handle,
                             count(DISTINCT (r.source_channel, r.source_post_id)) AS posts,
                             array_agg(DISTINCT r.kind) AS kinds
                      FROM tg_post_references r WHERE r.{mine} = %s AND r.{other} <> %s
                      GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x
                LEFT JOIN tg_channel_directory d USING (handle)
                ORDER BY x.posts DESC""",
            (h, h),
        )

    return {
        "cited_by": side("target_handle", "source_channel"),
        "cites": side("source_channel", "target_handle"),
    }


if __name__ == "__main__":
    build()
    if "build" not in sys.argv:
        uvicorn.run(
            app, host="127.0.0.1", port=int(os.environ.get("PROTO_PORT", "8012"))
        )
