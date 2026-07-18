#!/usr/bin/env bash
# Hard-fail CI gate: orphan TG class recipes that should live in ui/tg-* primitives.
# Justified one-offs: add path to ALLOWLIST below with a matching // tg-ui-allow: comment in the file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPONENTS="$ROOT/src/components"
FAILED=0

# Paths that may intentionally keep a recipe (relative to COMPONENTS).
ALLOWLIST=(
  "ui/tg-button.tsx"
  "ui/tg-confirm-dialog.tsx"
  "ui/tg-input.tsx"
  "ui/tg-icon-button.tsx"
  "ui/tg-settings-section.tsx"
  "ui/tg-chips.tsx"
  "ui/tg-segmented.tsx"
  "ui/button.tsx"
  "ui/loading-button.tsx"
  "ui/input.tsx"
  "ui/sidebar.tsx"
)

is_allowlisted() {
  local file="$1"
  local rel="${file#"$COMPONENTS"/}"
  # Unit tests may assert recipe strings.
  if [[ "$rel" == *.test.tsx || "$rel" == *.test.ts ]]; then
    return 0
  fi
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$rel" == "$allowed" ]]; then
      return 0
    fi
  done
  # Allow files that declare an explicit one-off exception comment.
  if grep -q 'tg-ui-allow:' "$file" 2>/dev/null; then
    return 0
  fi
  return 1
}

check_pattern() {
  local label="$1"
  local pattern="$2"
  local glob="${3:-*.tsx}"
  local hits=()
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if is_allowlisted "$file"; then
      continue
    fi
    hits+=("$file")
  done < <(rg -l --glob "$glob" "$pattern" "$COMPONENTS" 2>/dev/null || true)

  if ((${#hits[@]} > 0)); then
    echo "FAIL [$label]: orphan matches outside tg-* primitives:"
    printf '  %s\n' "${hits[@]}"
    FAILED=1
  else
    echo "OK   [$label]"
  fi
}

echo "Checking TG UI left-behind duplicates in $COMPONENTS"
echo

# Phase 1 — primary fill + soft-red confirm recipes on labeled buttons (heuristic)
check_pattern \
  "soft-red confirm footer recipe" \
  'border-red-500/30 bg-red-500/10.*tracking-widest text-red-600'

# Phase 2 — window.confirm
check_pattern \
  "window.confirm" \
  'window\.confirm\('

# Phase 3 — settings mono field + muted toolbar input
check_pattern \
  "settings mono input recipe" \
  'bg-app-ink/5 border border-app-ink/10 p-3 text-\[10px\] font-mono uppercase tracking-widest'

check_pattern \
  "muted toolbar input recipe" \
  'bg-app-muted/50 border border-app-ink/10 rounded-lg py-2'

# Phase 5 — settings card shell
check_pattern \
  "settings card shell" \
  'bg-app-card border border-app-ink/10 p-6 shadow-sm'

# Phase 7 — segmented track
check_pattern \
  "segmented track" \
  'flex bg-app-ink/5 p-1 rounded-lg border border-app-ink/10'

# Phase 4 — icon button recipes
check_pattern \
  "icon ghost recipe" \
  'p-1\.5 rounded-full text-app-ink/50 hover:bg-app-ink/5'

check_pattern \
  "icon frosted recipe" \
  'w-8 h-8 rounded-full bg-app-bg/90'

# Phase 1 / 2 heuristic: soft red + mono uppercase on buttons outside primitives already covered

if [[ "$FAILED" -ne 0 ]]; then
  echo
  echo "TG UI duplicate-class check failed. Migrate call sites to ui/tg-* or add // tg-ui-allow: <reason>."
  exit 1
fi

echo
echo "All TG UI left-behind checks passed."
