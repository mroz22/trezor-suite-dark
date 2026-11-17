#!/bin/bash
# Read-only check of the Suite Dark commit series; how to act on it: skills/suite-dark-branches/SKILL.md.
# Usage: series-check.sh [--main <ref>] [<branch>...]   (default: --main main staging)
# Prints a REF line (full SHAs, for lease pins) for main and each branch, then one line per fixup!/amend!/squash!
# marker and per commit upstream already has. Each commit is reported once, under the first of main and the
# branches, in that order, that contains it. A branch given as origin/<b> is checked as origin has it; its REF line
# still shows the local branch and worktree of <b>. Never fetches, calls gh or writes refs: `git fetch` first.
# Exit: 0 clean, 1 attention (any line other than REF and OK), 2 usage, 3 unknown ref.
set -u

usage() { echo 'usage: series-check.sh [--main <ref>] [<branch>...]' >&2; exit 2; }
g() { git --no-optional-locks "$@"; }
nl=$'\n'
rc=0
main=main
while [ $# -gt 0 ]; do
    case $1 in
        --main) [ $# -ge 2 ] || usage; main=$2; shift 2 ;;
        --) shift; break ;;
        -*) usage ;;
        *) break ;;
    esac
done
[ $# -gt 0 ] || set -- staging

for r in develop upstream/develop "$main" "$@"; do
    g rev-parse -q --verify "$r^{commit}" > /dev/null || { echo "series-check: unknown ref $r" >&2; exit 3; }
done

# The series of a ref starts where it leaves upstream/develop, which is develop itself unless the ref was already
# rebased onto a newer upstream (a sync candidate); upstream commits then never count as targets.
fork_base() {
    g merge-base "$1" upstream/develop && return
    echo "series-check: $1 has no history in common with upstream/develop" >&2
    exit 3
}
# has <newline-wrapped list> <line>: exact, literal line match.
has() { case $1 in *"$nl$2$nl"*) return 0 ;; esac; return 1; }
is_marker() { case $1 in 'fixup! '* | 'amend! '* | 'squash! '*) return 0 ;; esac; return 1; }
say() { echo "$1 $2 $3 $4"; [ "$1" = OK ] || rc=1; }

wtl=$(g worktree list --porcelain)
for b in "$main" "$@"; do
    n=${b#origin/}
    l=$(g rev-parse -q --verify "refs/heads/$n") || l=-
    o=$(g rev-parse -q --verify "refs/remotes/origin/$n") || o=-
    w=- busy=
    while IFS= read -r line; do
        case $line in
            'worktree '*) p=${line#worktree } ;;
            "branch refs/heads/$n") w=$p ;;
            # A worktree in the middle of a rebase lists as detached; its head-name names the branch.
            detached)
                gd=$(g -C "$p" rev-parse --absolute-git-dir 2> /dev/null) &&
                    cat "$gd/rebase-merge/head-name" "$gd/rebase-apply/head-name" 2> /dev/null |
                    grep -qxF "refs/heads/$n" && { w=$p; busy=1; } ;;
        esac
    done <<< "$wtl"
    if [ "$w" != - ]; then
        # A worktree mid-rebase, or one whose status cannot be read, counts as dirty.
        if [ -z "$busy" ] && st=$(g -C "$w" status --porcelain 2> /dev/null) && [ -z "$st" ]; then
            w="$w clean"
        else
            w="$w dirty"
        fi
    fi
    echo "REF $b local=$l origin=$o worktree=$w"
done

# Upstream subjects come from develop..upstream/develop, so this check needs develop not yet fast-forwarded.
usubj=$nl$(g log --format=%s develop..upstream/develop)$nl
msubj=$nl rep=$nl
for b in "$main" "$@"; do
    mb=$(fork_base "$b") || exit 3
    seen=$msubj
    same=$nl$(g cherry upstream/develop "$b" | awk '$1 == "-" { print $2 }')$nl
    ups=$nl$(g log --format=%H --grep='^Upstream: ' "$mb..$b")$nl
    while IFS=$'\t' read -r H h s; do
        if ! has "$rep" "$H"; then
            rep=$rep$H$nl
            if has "$same" "$H"; then
                say UPSTREAM-SAME "$b" "$h" "$s"
            elif has "$ups" "$H" && has "$usubj" "$s"; then
                say UPSTREAM-SUBJECT "$b" "$h" "$s"
            fi
            if is_marker "$s"; then
                t=${s#* }
                if [ "$b" = "$main" ]; then
                    say UNFOLDED "$b" "$h" "$s"
                elif is_marker "$t"; then
                    say NESTED "$b" "$h" "$s"
                elif has "$seen" "$t"; then
                    say OK "$b" "$h" "$s"
                else
                    say MISSING "$b" "$h" "$s"
                fi
            fi
        fi
        seen=$seen$s$nl
    done < <(g log --reverse --format='%H%x09%h%x09%s' "$mb..$b")
    [ "$b" = "$main" ] && msubj=$seen
done
exit $rc
