#!/usr/bin/env bash
# Merge one deployment's Directory into the other's. Run it ON the box being
# merged into, which pulls straight from the other: the two talk at ~1 MB/s,
# and a laptop in between is far slower and should never carry the data.
#
#   ssh root@vm-contabo 'cat > /root/merge-directory.sh' < scripts/merge-directory.sh
#   ssh root@vm-contabo 'nohup bash /root/merge-directory.sh to-production > /root/directory-merge.log 2>&1 &'
#
#   ssh root@vm-oracle-amd 'cat > /root/merge-directory.sh' < scripts/merge-directory.sh
#   ssh root@vm-oracle-amd 'nohup bash /root/merge-directory.sh to-staging > /root/directory-merge.log 2>&1 &'
#
# Staging crawls the Directory and production does not (its Directory probe
# Request kind is off), so `to-production` is how production's Directory grows,
# and it refuses to run while production probes. `to-staging` hands staging the
# handles production found through its own Follows. The source is only read.
#
# What it takes, and why each is safe to take:
#   entries     the source's row wherever the target has none or the source
#               checked it more recently. Keyed by handle, so the newer verdict
#               wins.
#   samples     those entries' samples, replacing the target's snapshot whole:
#               a handle's samples are one snapshot, never mixed.
#   references  all of the source's, skipping the ones the target has. Their
#               identity is Telegram's (chat id, post number), never a local
#               Post id, so the two databases agree on it.
# It then deletes those entries' search documents and rebuilds both derived
# stores, so search and citation counts cover the new rows.
#
# Re-runnable: a second run takes only what the source learned since.
set -euo pipefail

case ${1:-} in
  to-production)
    source=root@vm-oracle-amd source_db=tg-summarizer-staging-db-1
    target_db=tg-workspace-production-db-1 target_backend=tg-workspace-production-backend-1
    ;;
  to-staging)
    source=root@vm-contabo source_db=tg-workspace-production-db-1
    target_db=tg-summarizer-staging-db-1 target_backend=tg-summarizer-staging-backend-1
    ;;
  *)
    sed -n '2,10p' "$0" >&2
    exit 2
    ;;
esac
source=${SOURCE:-$source}
source_db=${SOURCE_DB:-$source_db}
target_db=${TARGET_DB:-$target_db}
target_backend=${TARGET_BACKEND:-$target_backend}

log() { echo "$(date -u +%T) $*"; }
target() { docker exec -i "$target_db" psql -U postgres -d app -v ON_ERROR_STOP=1 -At "$@"; }
# Both boxes give root a fish shell, so the remote command stays one plain
# pipeline and the SQL travels on stdin.
source_sql() {
  ssh "$source" "docker exec -i $source_db psql -U postgres -d app -v ON_ERROR_STOP=1 -At | gzip -1" | gunzip
}
columns_sql() {
  echo "select string_agg(quote_ident(column_name), ',' order by ordinal_position)
        from information_schema.columns
        where table_schema = 'public' and table_name = '$1' and is_generated = 'NEVER'"
}

# pull <table> <scratch> <copy-out sql>: the source's rows into directory_merge.<scratch>
pull() {
  target -c "create unlogged table directory_merge.$2 as select ${cols[$1]} from public.$1 with no data" >/dev/null
  echo "$3" | source_sql | target -c "copy directory_merge.$2 from stdin" >/dev/null
  log "$2: $(target -c "select count(*) from directory_merge.$2") rows from the source"
}

if [[ $1 == to-production && $(target -c "select value->>'probe' from tg_app_settings where key = 'request_kinds'") != false ]]; then
  echo "Production's Directory probe Request kind is on. Switch it off first: this merge assumes staging is the only crawler." >&2
  exit 1
fi

declare -A cols
for table in tg_channel_directory tg_channel_directory_samples tg_post_references; do
  cols[$table]=$(target -c "$(columns_sql "$table")")
  if [[ ${cols[$table]} != "$(columns_sql "$table" | source_sql)" ]]; then
    echo "$table has different columns on staging and production. Deploy the same release to both first." >&2
    exit 1
  fi
done
entry_cols=${cols[tg_channel_directory]}
sample_cols=${cols[tg_channel_directory_samples]}
ref_cols=${cols[tg_post_references]}

target -c "drop schema if exists directory_merge cascade" -c "create schema directory_merge" >/dev/null

pull tg_channel_directory entries "copy (select $entry_cols from tg_channel_directory) to stdout;"
target -c "create unlogged table directory_merge.taken as
           select s.handle from directory_merge.entries s
           left join tg_channel_directory p using (handle)
           where p.handle is null or s.checked_at > coalesce(p.checked_at, '-infinity')" >/dev/null
log "taking $(target -c "select count(*) from directory_merge.taken") entries"

# The handle list travels inside the statement, quoted by format's %L.
pull tg_channel_directory_samples samples "$(target -c "select format(
  'copy (select %s from tg_channel_directory_samples where handle = any(%L::varchar[])) to stdout;',
  '$sample_cols', coalesce(array_agg(handle), '{}')) from directory_merge.taken")"
pull tg_post_references refs "copy (select $ref_cols from tg_post_references) to stdout;"

entry_set=$(target -c "select string_agg(format('%1\$I = excluded.%1\$I', column_name), ', ')
                       from information_schema.columns
                       where table_schema = 'public' and table_name = 'tg_channel_directory'
                         and column_name <> 'handle' and is_generated = 'NEVER'")

log "merging"
target <<SQL
begin;
insert into tg_channel_directory ($entry_cols)
  select $entry_cols from directory_merge.entries join directory_merge.taken using (handle)
  on conflict (handle) do update set $entry_set;
delete from tg_channel_directory_samples where handle in (select handle from directory_merge.taken);
insert into tg_channel_directory_samples ($sample_cols) select $sample_cols from directory_merge.samples;
delete from tg_channel_directory_search where handle in (select handle from directory_merge.taken);
commit;
-- Its own transaction: the worker writes References too, and a shorter lock
-- window leaves it less to wait on.
insert into tg_post_references ($ref_cols) select $ref_cols from directory_merge.refs on conflict do nothing;
SQL
target -c "drop schema directory_merge cascade" >/dev/null

log "rebuilding citation pairs"
docker exec "$target_backend" uv run python scripts/backfill_citation_pairs.py 2>&1 | tail -1
log "indexing for search"
docker exec "$target_backend" uv run python scripts/backfill_directory_search.py 2>&1 | tail -1
log "done"
