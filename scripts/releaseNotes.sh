#!/usr/bin/env bash
set -euo pipefail

# Builds categorized GitHub release notes from the conventional commits between
# the previous v* tag and the tag currently checked out. Writes markdown to
# stdout (the workflow redirects it into a file for action-gh-release).
#
# Release notes must travel with the release, not with an interactive changelog
# tool: they are derived from the same "one conventional commit per change" rule
# the review PRs enforce, so the body is deterministic and needs no API access.

current="${GITHUB_REF_NAME:-$(git describe --tags --exact-match HEAD 2>/dev/null || true)}"
if [ -z "$current" ]; then
  echo "no git tag at HEAD" >&2
  exit 1
fi

# The nearest v* tag reachable from the commit before this one: the previous
# release on this line of history, whatever other tags sort higher.
prev="$(git describe --tags --abbrev=0 --match 'v*' "${current}^" 2>/dev/null || true)"

if [ -z "$prev" ]; then
  range="$current"
  label="$current"
else
  range="${prev}..${current}"
  label="${prev}...${current}"
fi

category() {
  local subject="$1" hash="$2"
  if [[ "$subject" =~ ^[a-z]+(\([^\)]*\))?!: ]] ||
    git log -1 --format=%b "$hash" | grep -q '^BREAKING[ -]CHANGE:'; then
    echo break
    return
  fi
  case "$subject" in
    feat:* | feat\(*) echo feat ;;
    fix:* | fix\(*) echo fix ;;
    docs:* | docs\(*) echo docs ;;
    test:* | test\(*) echo test ;;
    chore:* | chore\(* | ci:* | ci\(* | build:* | build\(* | refactor:* | refactor\(* | perf:* | perf\(* | style:* | style\(*)
      echo maintenance
      ;;
    *) echo other ;;
  esac
}

declare -a breaks features fixes docs tests maintenance other

while IFS= read -r line; do
  hash="${line%%$'\x1f'*}"
  subject="${line#*$'\x1f'}"
  entry="* ${subject} (${hash:0:7})"
  case "$(category "$subject" "$hash")" in
    break) breaks+=("$entry") ;;
    feat) features+=("$entry") ;;
    fix) fixes+=("$entry") ;;
    docs) docs+=("$entry") ;;
    test) tests+=("$entry") ;;
    maintenance) maintenance+=("$entry") ;;
    *) other+=("$entry") ;;
  esac
done < <(git log --no-merges --format='%H%x1f%s' "$range")

print_section() {
  local name="$1"
  shift
  if [ "$#" -gt 0 ]; then
    printf '### %s\n\n' "$name"
    for entry in "$@"; do
      printf '%s\n' "$entry"
    done
    printf '\n'
  fi
}

notes="$(mktemp)"
trap 'rm -f "$notes"' EXIT
printf '## What changed in %s\n\n' "$label" > "$notes"
print_section 'Breaking changes' ${breaks[@]+"${breaks[@]}"} >> "$notes"
print_section 'New features' ${features[@]+"${features[@]}"} >> "$notes"
print_section 'Bug fixes' ${fixes[@]+"${fixes[@]}"} >> "$notes"
print_section 'Documentation' ${docs[@]+"${docs[@]}"} >> "$notes"
print_section 'Tests' ${tests[@]+"${tests[@]}"} >> "$notes"
print_section 'Maintenance' ${maintenance[@]+"${maintenance[@]}"} >> "$notes"
print_section 'Other' ${other[@]+"${other[@]}"} >> "$notes"

# Only the header line plus its blank line means the range had no commits.
if [ "$(wc -l < "$notes")" -eq 2 ]; then
  printf '_No conventional commits in range._\n' >> "$notes"
fi

cat "$notes"