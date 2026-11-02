#!/usr/bin/env bash
# scripts/pending-articles.sh — put every pending article of the open pull requests into the working tree.
#
#   REPO=pfouge/spotthemoney GH_TOKEN=... scripts/pending-articles.sh qa|publish
#
# Run from the repository root with main checked out (used by qa.yml and publish.yml). It lists the
# open pull requests against main whose head branch lives in this repository (drafts included),
# oldest first, and for each included pull request copies ONLY the files under
#   web/src/content/articles/   web/src/content/authors/   web/public/writing/
# from the pull request head into the working tree (added and modified files are checked out,
# deleted and renamed-away files are removed). No other file of a pull request is ever taken:
# no code, no workflows, no package files. Symlinks and submodules are never taken.
#
# Modes:
#   qa       a pull request is included when it changes at least one file in those folders;
#            anything else it changes is ignored (and noted in the QA comment).
#   publish  a pull request is included only when EVERY file it changes is in those folders
#            (it "qualifies"); the others are reported as skipped and never merged.
#
# Result: pending.json (path from $PENDING_JSON), one record per open same-repository pull request:
#   number, title, draft, sha (head commit actually fetched), created, qualifies, included,
#   reason (why it is not included), articles (slugs added or changed), ops (files taken),
#   other (files outside the folders), plus a wrapper with the main commit. Newer pull requests
#   are applied last, so if two change the same file the newer one wins (listed in "overlaps").
set -euo pipefail

mode=${1:-}
case "$mode" in qa|publish) ;; *) echo "usage: $0 qa|publish" >&2; exit 2 ;; esac
: "${REPO:?REPO is required, like pfouge/spotthemoney}"
out=${PENDING_JSON:-pending.json}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git() { command git --literal-pathspecs "$@"; }

# Every open pull request against main with a head branch in this repository, oldest first.
gh api --paginate "repos/$REPO/pulls?state=open&base=main&per_page=100" \
  | jq -s --arg repo "$REPO" '
      add // []
      | map(select((.head.repo.full_name // "") == $repo))
      | map({number, title, draft: (.draft // false), sha: .head.sha, created: .created_at})
      | sort_by(.created, .number)' > "$work/prs.json"

echo "[]" > "$work/records.json"
while IFS= read -r pr; do
  n=$(jq -r '.number' <<<"$pr")
  gh api --paginate "repos/$REPO/pulls/$n/files?per_page=100" | jq -s 'add // []' > "$work/files.json"
  # One operation per touched path: "put" (added/modified/renamed-to) or "rm" (removed/renamed-from).
  jq --argjson pr "$pr" --arg mode "$mode" '
    def allowed: test("^(web/src/content/(articles|authors)/|web/public/writing/)") and (test("(^|/)\\.\\.(/|$)") | not);
    [ .[] | ( {path: .filename, op: (if .status == "removed" then "rm" else "put" end)} ),
            ( select(.status == "renamed") | {path: .previous_filename, op: "rm"} ) ] as $all
    | ($all | map(select(.path | allowed))) as $ops
    | ($all | map(select(.path | allowed | not) | .path)) as $other
    | (length >= 3000) as $truncated
    | ($ops | length > 0 and ($other | length) == 0 and ($truncated | not)) as $qualifies
    | $pr + {
        qualifies: $qualifies,
        ops: $ops,
        other: $other,
        articles: ($ops | map(select(.op == "put") | .path | capture("^web/src/content/articles/(?<s>[^/]+)\\.md$").s?) | unique),
        included: (if $mode == "qa" then ($ops | length > 0) else $qualifies end),
        reason: (if $truncated then "changes 3000 files or more"
                 elif $mode == "publish" and ($other | length) > 0 then "changes files outside articles, authors and images: " + ($other[:3] | join(", ")) + (if ($other | length) > 3 then " and " + ((($other | length) - 3) | tostring) + " more" else "" end)
                 elif ($ops | length) == 0 then "changes no article, author or image files"
                 else "" end)
      }' "$work/files.json" > "$work/rec.json"
  jq --slurpfile r "$work/rec.json" '. + $r' "$work/records.json" > "$work/records.next" && mv "$work/records.next" "$work/records.json"
done < <(jq -c '.[]' "$work/prs.json")

main_sha=$(git rev-parse HEAD)
declare -A owner=()
overlaps=()

# Apply the included pull requests, oldest first.
while IFS= read -r pr; do
  n=$(jq -r '.number' <<<"$pr")
  echo "::group::pull request #$n"
  git fetch --no-tags --depth=1 --quiet origin "pull/$n/head"
  fetched=$(git rev-parse FETCH_HEAD)
  # A symlink or submodule is never taken. In publish mode such a pull request does not qualify.
  bad=()
  while IFS= read -r path; do
    entry=$(git ls-tree FETCH_HEAD -- "$path" | head -1 || true)
    case "${entry%% *}" in 120000|160000) bad+=("$path") ;; esac
  done < <(jq -r '.ops[] | select(.op == "put") | .path' <<<"$pr")
  if [ "$mode" = publish ] && [ "${#bad[@]}" -gt 0 ]; then
    echo "::warning::#$n contains a symlink or submodule (${bad[0]}): not merged"
    jq --argjson n "$n" --arg why "contains a symlink or submodule: ${bad[0]}" \
      'map(if .number == $n then .included = false | .qualifies = false | .reason = $why else . end)' "$work/records.json" > "$work/records.next" \
      && mv "$work/records.next" "$work/records.json"
    echo "::endgroup::"
    continue
  fi
  while IFS=$'\t' read -r op path; do
    [ -n "$path" ] || continue
    if [ "$op" = "rm" ]; then
      if [ -e "$path" ] || git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
        git rm -q -f --ignore-unmatch -- "$path" >/dev/null 2>&1 || rm -f -- "$path"
        echo "remove   $path"
      fi
      continue
    fi
    entry=$(git ls-tree FETCH_HEAD -- "$path" | head -1 || true)
    mode_bits=${entry%% *}
    case "$mode_bits" in
      "")             echo "::warning::#$n: $path is not in the pull request head, skipped"; continue ;;
      120000|160000)  echo "::warning::#$n: $path is a symlink or submodule, skipped"; continue ;;
    esac
    if [ -n "${owner[$path]:-}" ] && [ "${owner[$path]}" != "$n" ]; then
      # Same path from two pull requests: harmless when the content is identical (a shared author file).
      if ! git diff --quiet FETCH_HEAD -- "$path" 2>/dev/null; then
        overlaps+=("$path (#${owner[$path]} replaced by #$n)")
        echo "::warning::$path is changed by #${owner[$path]} and #$n with different content; the newer pull request (#$n) wins"
      fi
    fi
    git checkout FETCH_HEAD -- "$path"
    owner[$path]=$n
    echo "take     $path"
  done < <(jq -r '.ops[] | [.op, .path] | @tsv' <<<"$pr")
  echo "::endgroup::"
  jq --argjson n "$n" --arg sha "$fetched" 'map(if .number == $n then .sha = $sha else . end)' "$work/records.json" > "$work/records.next" \
    && mv "$work/records.next" "$work/records.json"
done < <(jq -c '.[] | select(.included)' "$work/records.json")

overlaps_json=$(printf '%s\n' "${overlaps[@]:-}" | jq -R . | jq -s 'map(select(. != ""))')
jq --arg main "$main_sha" --arg mode "$mode" --argjson overlaps "$overlaps_json" \
  '{mode: $mode, main_sha: $main, overlaps: $overlaps, prs: .}' "$work/records.json" > "$out"

included=$(jq '[.prs[] | select(.included)] | length' "$out")
echo "main $main_sha, mode $mode: $included of $(jq '.prs | length' "$out") open pull request(s) included"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "included=$included" >> "$GITHUB_OUTPUT"; fi
