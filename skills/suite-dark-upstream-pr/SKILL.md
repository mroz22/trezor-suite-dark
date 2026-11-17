---
name: suite-dark-upstream-pr
description: Offer an `Upstream:` commit of Suite Dark to trezor/trezor-suite as a pull request and follow it through review and merge, keeping the patch identical on staging. Use when the owner asks "je to kandidat na upstream?", "co z toho by slo do upstreamu?", "otevri PR do upstreamu", "udelej PR na tento commit do upstreamu" or "rovnou to otevri jako PR do upstreamu", or links a review comment on an upstream pull request ("zapracuj review", "odpovez na komentar").
---

# Suite Dark: upstream pull requests

Rules: `SUITE_DARK.md` (Upstream first) and the Suite Dark section of `AGENTS.md`. Fork-side commits land with
`skills/suite-dark-branches/SKILL.md`.

## When to use

- "Is it a candidate?" or "what could go upstream?": step 1 only, which writes nothing.
- A pull request of specific commits: steps 1-5. A review comment: step 6. Merged or closed: step 7.

## Preconditions

- Run `git fetch origin` and `git fetch upstream develop`. Base on `upstream/develop`, not on the local `develop`,
  which lags until the next sync.
- `git status --short` must be empty, else set the work aside as a WIP commit (`SUITE_DARK.md`, Development branches).
- Shell variables do not survive between commands, so each block sets what it uses; fill in `<topic>` and `<sha>`.
  A grep that must find nothing passes only when its exit status is 1 (2 is an error).
- `upstream-pr/<topic>` holds upstream's tree, without this skill, SUITE_DARK.md or the fork section of AGENTS.md.
  Read them before you switch, or with `git show origin/staging:<path>`.

## Steps

### 1. Candidate check (read-only)

```bash
LEAK='suite[ _-]?dark|flavour|kruw|co-authored-by'; C=<sha>; S=$(git log -1 --format=%s "$C")
git log --format='%h %s' --grep='^Upstream: ' develop..origin/staging | grep -v -E '^[0-9a-f]+ (fixup|amend)! '
git log -1 --format='%h %s | %an <%ae> | Upstream: %(trailers:key=Upstream,valueonly,separator=%x2C)' "$C"
git log --format='%h %s' develop..origin/staging | grep -F "! $S"   # markers that change it
git cherry upstream/develop "$C" "$C^"                              # '-': the patch is upstream already
gh pr list --repo trezor/trezor-suite --author mroz22 --state all --search "\"$S\" in:title"
d=$(mktemp -d) && GIT_INDEX_FILE="$d/i" git read-tree upstream/develop &&
    git diff --binary "$C^" "$C" | GIT_INDEX_FILE="$d/i" git apply --cached --check 2>/dev/null &&
    echo 'applies to upstream/develop' || echo 'does not apply'; rm -rf "$d"
git log --format='%h %s' upstream/develop.."$C^" -- $(git show --name-only --format= "$C" | grep -v '\.md$')
git show "$C" | grep -n -i -E "$LEAK"; echo "leak grep exit $?"
```

A candidate has the trailer, is on staging, has no PR, applies to `upstream/develop` and has no leak hit in its
diff (step 2 removes message hits). If it does not apply, the `-- <files>` line lists the fork commits it builds on:
offer those first, or adapt it in step 2. Give a verdict and a reason per commit, in the order Upstream first sets.

### 2. Build the branch (once the owner has asked for this pull request)

```bash
T=<topic>; C=<sha>   # topic in kebab-case from the subject, e.g. range-beneath-sticky-bars
git ls-remote https://github.com/trezor/trezor-suite.git "refs/heads/mroz22/$T"   # must print nothing
git rev-parse -q --verify "refs/heads/upstream-pr/$T"                              # must print nothing
GIT_LFS_SKIP_SMUDGE=1 git switch -c "upstream-pr/$T" upstream/develop
git cherry-pick "$C"   # never -x, it names the fork commit; on a conflict resolve, then --continue
git log -1 --format=%B | grep -v -E '^Upstream: (fix|refactor|feature)$' | git commit --amend --no-verify -q -F -
```

- `upstream-pr/<topic>` is local only and never goes to `origin` (fork CI fails on upstream's workflows); the
  branch in `trezor/trezor-suite` is `mroz22/<topic>`.
- Several commits: the last two lines per commit, in series order. Staging's markers for `C` are picked after it
  with `git cherry-pick --allow-empty` (never `--skip` a stop on an `amend!`) and folded with
  `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash upstream/develop`; strip the trailer after that.
- On a conflict, keep only this commit's change. Adapt tests that rely on an earlier fork commit or a fork default
  (a fork-only test next to them, a fork mock) to plain upstream. Never pull fork commits in.
- Drop leak hits and lines about fork branches or checks from the message, and follow upstream's
  `skills/git-and-commit-guidelines/SKILL.md`. The author stays the owner.

### 3. Upstream's checks

- Upstream's checks for the touched packages as `AGENTS.md` (Setup and commands; Verification and completion) says,
  throttled as in `SUITE_DARK.md` (Working here, Checks). If
  `git diff --stat origin/staging upstream/develop -- yarn.lock .yarnrc.yml submodules` prints anything, install
  first or report that the checks used the fork's dependencies.
- A fix's new test must fail without the fix: `git checkout upstream/develop -- <non-test files>`, run the test,
  then `git checkout HEAD -- <same files>`.

### 4. Leak, data and patch-id checks

```bash
LEAK='suite[ _-]?dark|flavour|kruw|co-authored-by'
git log -p --format='%an <%ae>%n%B' upstream/develop..HEAD | grep -n -i -E "$LEAK|^Upstream: "; [ $? -eq 1 ] && echo no-leak
for c in $(git rev-list --reverse upstream/develop..HEAD) <fork shas>; do
    echo "$(git show "$c" | git patch-id --stable | cut -c1-12) $(git log -1 --format='%h %s' "$c")"; done
```

It must print `no-leak`. Read the diff and the message against `AGENTS.md` (Confidential data). Screenshots stay
empty unless the owner supplies and clears an image: the fork has no QA wallets and shows its own palette and name.
Equal patch-ids mean identical (the sync drops the fork commit by itself), different ones adapted (by hand).

### 5. Hand-off, push, open

Write the body to `"${TMPDIR:-/tmp}/upstream-pr-<topic>.md"`. Line 1 is `🤖 Agent <Model> <Version>:` with the
actual model, then a blank line, then `git show upstream/develop:.github/pull_request_template.md` filled in. The
Description gives the cause, the fix and the test, with permalinks to
`https://github.com/trezor/trezor-suite/blob/<base sha>/<path>#L<n>`. Notes for QA follow `skills/qa-notes/SKILL.md`.
Drop Related Issue when there is none, and treat Screenshots as step 4 says. Never link the fork's issues, PRs or
branches. The title is the subject. Check the body like the patch:
`grep -n -i -E 'suite[ _-]?dark|flavour|kruw|co-authored-by' "${TMPDIR:-/tmp}/upstream-pr-<topic>.md"; [ $? -eq 1 ] && echo no-leak`.

Show the owner `git log --stat upstream/develop..HEAD`, the message, the body, the patch-ids, the checks and these
commands (gate 2). The `upstream` remote cannot push, so use the SSH URL. Add `--draft` only on request.

```bash
T=<topic>
git push git@github.com:trezor/trezor-suite.git "upstream-pr/$T:refs/heads/mroz22/$T"
gh pr create --repo trezor/trezor-suite --base develop --head "mroz22/$T" --title "<subject>" --body-file "${TMPDIR:-/tmp}/upstream-pr-$T.md"
```

Then read `gh pr checks <n> --repo trezor/trezor-suite`. `check-project-or-issue` needs the `no-project` label or
a linked issue, and labels are the owner's. If a check fails the same way on upstream `develop` or other PRs, it is
upstream's: report it.

Switch back to the workspace branch; reinstall if `yarn.lock` differed. Record `` `<subject>`: PR <n> `` in the
upstream list of SUITE_DARK.md with a docs `fixup!` that changes only that
line, landed on staging with suite-dark-branches.

### 6. Review round

`<n>` comes from the link; the fork commit is the one in step 1's list with the PR commit's subject.

```bash
T=$(gh pr view <n> --repo trezor/trezor-suite --json headRefName --jq '.headRefName | ltrimstr("mroz22/")')
git fetch upstream "refs/heads/mroz22/$T"   # FETCH_HEAD only
git switch "upstream-pr/$T" 2>/dev/null || git switch -c "upstream-pr/$T" FETCH_HEAD
git merge --ff-only FETCH_HEAD              # others may have pushed; if it diverged, stop and report
gh pr view <n> --repo trezor/trezor-suite --comments
gh api --paginate "repos/trezor/trezor-suite/pulls/<n>/comments" --jq '.[] | "\(.id) \(.path):\(.line) \(.body)"'
```

- The owner decides the answer. Make the change once, in the shape the PR uses (a new upstream-style commit or
  `fixup! <PR commit subject>`), then run steps 3 and 4.
- Put the same patch on staging with suite-dark-branches: a new commit with its `Upstream: <kind>` trailer, or a
  `fixup!` with the fork commit's exact subject. Its `git patch-id --stable` must equal the PR commit's; if they
  differ only in context lines, show both diffs and say so. main differs until the promotion.
- Push to the PR branch with the step 5 push as a fast-forward. Reordering needs
  `--force-with-lease=refs/heads/mroz22/<topic>:<sha seen>`.
- A reply starts with the agent prefix, passes the leak grep and goes out with
  `gh api "repos/trezor/trezor-suite/pulls/<n>/comments/<id>/replies" -F body=@<file>` (in the conversation:
  `gh pr comment <n> --repo trezor/trezor-suite --body-file <file>`). Resolve a thread only when asked.

### 7. After merge or close

- Merged: the docs need nothing; suite-dark-sync step 1 drops the fork commit, its markers and its list line.
- List the merged local `upstream-pr/*` branches at the end, and ask once before `git branch -D`.
- Closed unmerged: it becomes a flavour commit (Upstream first), a new fork commit to agree with the owner.

## Gates

1. Steps 2-6 need the owner's request for this pull request. Without it, only step 1 runs.
2. A request to open the PR ("otevri", "udelej PR") is the go for exactly the step 5 push and `gh pr create` only
   when every check of steps 1-4 passed without a leak hit and the patch is the fork commit's unchanged (equal
   patch-ids, or only staging's markers folded in; only the trailer left the message). Show both commands before
   running them. Otherwise, and after a request to prepare ("priprav") or to judge ("je to kandidat?"), stop at the
   hand-off.
3. Every later GitHub write needs its own go: pushes and force-pushes to the PR branch, replies, comments,
   description edits, labels, resolving threads, closing, and deleting `mroz22/<topic>`.
4. Fork side: the suite-dark-branches push gate, and the owner's agreement for a new fork commit.

## Report

- Refs: the `upstream/develop` base, `upstream-pr/<topic>`, `mroz22/<topic>`, the PR URL, the fork commits, the
  fork-side commits marked local, landed or pushed; per commit identical or adapted, and why. Checks run with
  results, not run and why (`yarn.lock`), the leak grep, the data review, the screenshots, upstream CI, labels.
- Decisions as numbered questions with lettered options, and merged `upstream-pr/*` leftovers as one question.
