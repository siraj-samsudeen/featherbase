#!/usr/bin/env bash
# PreToolUse hook (wired in .claude/settings.json): blocks PR creation —
# `gh pr create` via Bash, or the GitHub MCP create_pull_request tool —
# unless scripts/preflight.sh has passed on the exact current working-tree
# content. Everything else is allowed through untouched.
set -euo pipefail
cd "$(dirname "$0")/.."

payload=$(cat)

# Fast path: nothing PR-shaped in the payload at all → allow silently.
case "$payload" in
  *"gh pr create"* | *create_pull_request*) ;;
  *) exit 0 ;;
esac

# Precise check (node — no jq dependency in a JS monorepo).
is_pr_creation=$(node -e '
  let s = "";
  process.stdin.on("data", (c) => (s += c));
  process.stdin.on("end", () => {
    let p;
    try {
      p = JSON.parse(s);
    } catch {
      return console.log("no");
    }
    if (p.tool_name === "mcp__github__create_pull_request") {
      return console.log("yes");
    }
    const cmd = (p.tool_input && p.tool_input.command) || "";
    // Match gh only in command position (start of command or after a shell
    // separator) — the phrase inside prose, e.g. a commit message that
    // MENTIONS "gh pr create", must not trip the gate.
    if (
      p.tool_name === "Bash" &&
      /(^|[;&|(]\s*)gh\s+pr\s+create\b/.test(cmd)
    ) {
      return console.log("yes");
    }
    console.log("no");
  });
' <<< "$payload")

[ "$is_pr_creation" = "no" ] && exit 0

deny() {
  node -e '
    const reason = process.argv[1];
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      }),
    );
  ' "$1"
  exit 0
}

marker=.git/preflight-ok
if [ ! -f "$marker" ]; then
  deny "Preflight gate: no preflight has run in this clone. Run 'npm run preflight' (full CI battery + Playwright E2E) to green, then retry creating the PR."
fi

recorded=$(grep '^tree=' "$marker" | cut -d= -f2)
tmp=$(mktemp)
cp .git/index "$tmp" 2>/dev/null || true
GIT_INDEX_FILE="$tmp" git add -A >/dev/null 2>&1
current=$(GIT_INDEX_FILE="$tmp" git write-tree)
rm -f "$tmp"

if [ "$recorded" != "$current" ]; then
  deny "Preflight gate: the working tree changed since the last green preflight. Run 'npm run preflight' again, then retry creating the PR."
fi

exit 0
