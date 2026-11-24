#!/usr/bin/env bash
# 変更範囲チェックが、承認後のテスト改ざん・範囲外の変更・タグの欠落を不合格にすることを、
# 使い捨てのリポジトリで確かめる。GitHub には何も送らない。
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
cd "$T"
git init -q -b main
git config user.name probe
git config user.email "1+probe@users.noreply.github.com"
mkdir -p product/src product/tests/acceptance
echo "export {};" >product/src/cli.ts
echo "base" >package.json
git add -A && git commit -q -m base
BASE=$(git rev-parse HEAD)

expect() {
  local label=$1 want=$2 branch=$3
  node "$SRC/factory/checks/diff-scope.ts" --base "$BASE" --head HEAD --branch "$branch" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then echo "PASS $label (exit $got)"; else echo "FAIL $label (want $want, got $got)"; FAILED=1; fi
}
FAILED=0

git switch -q -c factory/T-001
mkdir -p specs tickets
echo "spec" >specs/T-001.md
echo "ticket" >tickets/T-001.md
echo "test" >product/tests/acceptance/t-001.test.ts
git add -A && git commit -q -m spec
git tag spec-approved/T-001
echo "impl" >>product/src/cli.ts
git add -A && git commit -q -m build
expect "valid factory branch" 0 factory/T-001

git switch -q -c factory/T-002 "$BASE"
mkdir -p specs tickets
echo "spec" >specs/T-002.md
git add -A && git commit -q -m spec
git tag spec-approved/T-002
mkdir -p product/tests/acceptance
echo "weakened" >product/tests/acceptance/t-002.test.ts
git add -A && git commit -q -m "tamper with tests after approval"
expect "test edited after approval" 1 factory/T-002

git switch -q -c factory/T-003 "$BASE"
mkdir -p specs
echo "spec" >specs/T-003.md
echo "changed" >package.json
git add -A && git commit -q -m "spec stage touches package.json"
git tag spec-approved/T-003
expect "spec stage out of scope" 1 factory/T-003

git switch -q -c factory/T-004 "$BASE"
echo "impl" >>product/src/cli.ts
git add -A && git commit -q -m "no approval tag"
expect "missing approval tag" 1 factory/T-004

expect "invalid factory branch name" 1 factory/oops
expect "non-factory branch skipped" 0 feat/anything

exit "$FAILED"
