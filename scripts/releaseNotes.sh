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

prev="$(git tag --sort=-version:refname | grep -vFx "$current" | sed -n '1p' || true)"

if [ -z "$prev" ]; then
  range="HEAD"
  label="$current"
else
  range="${prev}..HEAD"
  label="${prev}...${current}"
fi

category() {
  case "$1" in
    'feat'*!:) echo break ;;
    'fix'*!:) echo break ;;
    feat*) echo feat ;;
    fix*) echo fix ;;
    docs*) echo docs ;;
    test*) echo test ;;
    chore* | ci* | build* | refactor* | perf* | style*) echo maintenance ;;
    *) echo other ;;
  esac
}

declare -a breaks features fixes docs tests maintenance other

while IFS= read -r line; do
  hash="${line%%$'\x1f'*}"
  subject="${line#*$'\x1f'}"
  entry="* ${subject} (${hash:0:7})"
  case "$(category "$subject")" in
    break) breaks+=("$entry") ;;
    feat) features+=("$entry") ;;
    fix) fixes+=("$entry") ;;
    docs) docs+=("$entry") ;;
    test) tests+=("$entry") ;;
    maintenance) maintenance+=("$entry") ;;
    *) other+=("$entry") ;;
  esac
done < <(git log --format='%H%x1f%s' "$range")

print_section() {
  local name="$1"
  shift
  local -a entries=("$@")
  if [ "${#entries[@]}" -gt 0 ]; then
    printf '### %s\n\n' "$name"
    for entry in "${entries[@]}"; do
      printf '%s\n' "$entry"
    done
    printf '\n'
  fi
}

notes="$(mktemp)"
printf '## What changed in %s\n\n' "$label" > "$notes"
print_section 'Breaking changes' "${breaks[@]}" >> "$notes"
print_section 'New features' "${features[@]}" >> "$notes"
print_section 'Bug fixes' "${fixes[@]}" >> "$notes"
print_section 'Documentation' "${docs[@]}" >> "$notes"
print_section 'Tests' "${tests[@]}" >> "$notes"
print_section 'Maintenance' "${maintenance[@]}" >> "$notes"
print_section 'Other' "${other[@]}" >> "$notes"

# Only the header line plus its blank line means the range had no commits.
if [ "$(wc -l < "$notes")" -eq 2 ]; then
  printf '_No conventional commits in range._\n' >> "$notes"
fi

cat "$notes"
rm "$notes"