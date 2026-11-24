#!/usr/bin/env bash
# 工場の工程が、ユーザーレベルの設定（スキル、エージェント、フック、CLAUDE.md、プラグイン、MCP）を
# 読み込まずに動き、しかも --settings で渡したフックだけは動くことを確かめる。
# 比較のため、分離しない対照の実行も同時に行う。結果は公開しない実行ログ置き場に書く。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

OUT="$PWD/runs/probe/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

PROMPT='Do two things. 1) Run the bash command: echo probe  2) Then answer on one line whether the contents of any CLAUDE.md file appear in your context. Reply exactly CLAUDE_MD=yes or CLAUDE_MD=no.'

# リポジトリがホームディレクトリの下にあると、祖先ディレクトリをたどる仕組みで ~/.claude/CLAUDE.md が
# 「プロジェクトの指示」として読み込まれ、--setting-sources project では外れないため、明示的に除外する
ISOLATION=$(jq -nc --arg p "$HOME/.claude/CLAUDE.md" '{claudeMdExcludes: [$p]}')

run_probe() {
  local name=$1 extra=$2
  shift 2
  local marker="$OUT/hook-fired-$name"
  local settings
  settings=$(jq -nc --arg m "$marker" --argjson extra "$extra" \
    '$extra + {hooks:{PreToolUse:[{matcher:"Bash",hooks:[{type:"command",command:("echo fired >> " + ($m|@sh))}]}]}}')
  claude -p "$PROMPT" "$@" \
    --settings "$settings" \
    --model sonnet \
    --tools Bash \
    --allowedTools "Bash(echo probe)" \
    --permission-mode dontAsk \
    --no-session-persistence \
    --output-format stream-json --verbose --include-hook-events \
    >"$OUT/$name.jsonl" 2>"$OUT/$name.stderr" || true
}

summarize() {
  local name=$1
  local file="$OUT/$name.jsonl"
  echo "===== $name ====="
  jq -r 'select(.type=="system" and .subtype=="init")
    | to_entries[]
    | select(.key|test("^(mcp_servers|skills|agents|plugins)$"))
    | "\(.key) (\(.value|length)): \(.value | map(if type=="string" then . else (.name // .id // tostring) end) | .[0:20] | join(", "))"' "$file" || true
  echo "-- hook events --"
  jq -r 'select(.type=="system" and .subtype=="hook_started") | .hook_name // ""' "$file" | sort | uniq -c || true
  echo "-- --settings hook fired: $([ -f "$OUT/hook-fired-$name" ] && echo yes || echo no)"
  echo "-- answer --"
  jq -r 'select(.type=="result") | "\(.result | tostring | .[0:200])  cost_usd=\(.total_cost_usd // "n/a")"' "$file" || true
  if [ -s "$OUT/$name.stderr" ]; then
    echo "-- stderr (head) --"
    head -5 "$OUT/$name.stderr"
  fi
}

run_probe control '{}'
run_probe isolated "$ISOLATION" --setting-sources project

summarize control
summarize isolated
echo "raw output: $OUT"
