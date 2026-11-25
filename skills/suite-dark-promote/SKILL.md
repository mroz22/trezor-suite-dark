---
name: suite-dark-promote
description: Promote the commits the owner picked from staging to main in Suite Dark, together with what they depend on, by rebuilding main in series order with their fixup!/amend! commits folded and staging with an unchanged tree, verifying and checking both candidates and handing over one atomic push. Use when the owner says "dostan to do main", "povys do main", "by mel jit do main taky", "dostat do vetve main", "fixupy ktere miri na main poslat na main", "posquashuj fixupy", "squashni ty fixupy" or names staging commits that should reach main.
---

# Promote staging commits to main

Rules: `SUITE_DARK.md` (Development branches; Upstream first, the order on `main`) and the Suite Dark section of
`AGENTS.md`. Moving branches, rebasing feature branches, markers and CI: `skills/suite-dark-branches/SKILL.md`.

## When to use

The owner names commits on `staging` for `main`: SHAs, subjects, a feature, or "the fixups that target main", which are
the `fixup!`/`amend!` commits whose change concerns only work already on `main` (from a docs fixup that also covers work
only on `staging`, only its text about work on `main`, split as in step 3). List separately, unpicked, every marker
whose closure would add a non-marker commit, such as an `amend!` of a flavour commit that needs a `staging` feature.
Never choose picks yourself and never start without that request. A named feature not yet on `staging` has not been in
daily use (SUITE_DARK.md, Development branches): say so and stop; it lands through its pull request first. Syncs are
`suite-dark-sync`.

## Preconditions

Run from the root of your own workspace and paste literal values for placeholders; shell variables do not survive
between commands. `<d>` is today as `yyyymmdd`. Prefix checkouts and rebases with `GIT_LFS_SKIP_SMUDGE=1` and commit
with `--no-verify` (step 5 checks formatting). Docs files are the docs commit's:
`SUITE_DARK.md AGENTS.md README.md 'skills/suite-dark-*' .claude/skills`.

1. `git status --short` is empty and nothing is in progress (WIP commit, see Development branches);
   `git branch --list 'sync/*' 'promote/*'` prints nothing, else another session is mid-operation: ask.
2. `git fetch --prune origin && git fetch upstream develop`, then
   `skills/suite-dark-branches/scripts/series-check.sh --main origin/main origin/develop origin/staging origin/<f>`
   for each `<f>` in `git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin/feature/`. A local branch
   equal to or behind its origin ref is fine; local commits origin lacks: stop, ask, except on a feature branch whose
   session is running (SUITE_DARK.md, Development branches), which stays out and is reported. `MISSING`, `NESTED` and
   `UNFOLDED` lines are handled in steps 3-4; an `UPSTREAM-*` pick waits for a sync.
3. `develop` is `main`'s base:
   `git merge-base --is-ancestor develop origin/main && [ "$(git merge-base origin/main upstream/develop)" = "$(git rev-parse develop)" ]`.
   Otherwise stop: a `develop` ahead of `origin/develop` comes from an aborted sync, so a sync is due (ask); one
   behind it moves with `git fetch origin develop:develop`.
4. CI passed on the current `staging` commit, otherwise stop and report; no run yet: wait and retry.
   `gh run list --repo mroz22/trezor-suite-dark --branch staging --commit <git rev-parse origin/staging> --json status,conclusion`
   must show `completed` and `success`.

## Steps

1. **Backups and candidate.** The backups are the old bases and lease pins; `promote/main` tells other sessions a
   promotion is running. If `promote/main` exists, stop and ask; if a backup name exists (a second operation that
   day), `<d>` is `yyyymmdd-2` (then `-3`) from here on, in every name of this skill, `<M>` and `<S>` included. Back
   up every feature branch step 8 will rebase, not one whose session is running. Below, `<M>` is
   `backup/main-pre-promote-<d>` and `<S>` is `backup/staging-pre-promote-<d>`.

    ```bash
    ok=1; for b in main staging feature/<name>; do git branch "backup/$b-pre-promote-<d>" "origin/$b" || { ok=0; break; }; done
    [ "$ok" = 1 ] && git branch promote/main develop
    ```

2. **Dependency closure**: the picks plus what they need. Map the owner's words to SHAs in
   `git log --reverse --format='%h %s' <M>..<S>`. Run this for the picks, then for every commit it adds, until
   nothing new appears:

    ```bash
    for p in <sha>...; do
        s=$(git log -1 --format=%s "$p")
        git log --reverse --format='%h %s' <M>..<S> | while read -r h t; do
            case "$t" in "fixup! $s" | "amend! $s" | "squash! $s") echo "$h $t  [marker of $p]" ;; esac
        done
        f=$(git diff-tree --no-commit-id --name-only -r "$p" | grep -v '\.md$')
        [ -n "$f" ] && git log --reverse --format="%h %s  [files of $p]" <M>.."$p"^ -- $f
    done
    ```

    - Markers of a pick come along; a picked marker whose target is not on `main` brings its target. The picked
      feature's docs fixup is a pick. A commit that shares a file is a candidate: read both diffs and say why.
    - Type level, which clean cherry-picks and `git merge-tree` cannot see: every symbol, type field, config key, test
      file and message id the picks use exists on `main` or comes from the list;
      `git log --reverse --format='%h %s' -S'<symbol>' <M>..<pick>^` lists the commit that adds it first.
    - Show the owner the picks, each added commit with its reason, the markers to retarget (steps 3-4) and what stays
      on `staging` (gate 2).

3. **Build `promote/main`** in the order of `SUITE_DARK.md`, Upstream first: picked upstream-bound commits after
   main's, fixes before refactors before features where they do not depend on each other, else in `staging`'s order;
   picked flavour commits after main's. `<U>` is the newest upstream-bound commit on `main`,
   `git log -1 --format=%h -E --grep='^Upstream: (fix|refactor|feature)$' develop..<M>`; if that prints nothing, the
   docs commit, `git rev-list --reverse develop..<M> | head -1`.

    ```bash
    GIT_LFS_SKIP_SMUDGE=1 git switch -q promote/main
    git cherry-pick --allow-empty develop..<U>     # the docs commit and main's upstream-bound commits
    git cherry-pick --allow-empty <picked upstream-bound commits>
    git cherry-pick --allow-empty <U>..<M>        # main's other flavour commits
    git cherry-pick --allow-empty <picked flavour commits and every picked marker>
    GIT_SEQUENCE_EDITOR=: GIT_LFS_SKIP_SMUDGE=1 git rebase -q -i --autosquash develop   # plain --autosquash folds nothing
    ```

    - A picked `amend!` that removes its target's `Upstream:` trailer (a declined commit made flavour) moves that
      target: keep `<U>` as defined above, leave the target out of `develop..<U>` (list the other commits) and
      cherry-pick it right after the picked upstream-bound commits, before `<U>..<M>`; its `amend!` comes with the
      picked markers.
    - `--allow-empty` keeps a message-only `amend!`; never `--skip` a stop on one. Pick a `MISSING` or `NESTED`
      marker alone and retarget it right after (suite-dark-branches step 3.3). `UNFOLDED` markers fold here; one that
      names no commit on `main` is picked alone and retargeted the same way.
    - A picked upstream-bound commit that conflicts there does not stand on plain `develop`: stop and ask. If a picked
      marker makes a commit already on `main` need a picked upstream-bound commit, cherry-pick that one before it.
    - Docs: a fixup with only the picked work's text is cherry-picked like any marker. For a mixed one,
      `git cherry-pick --no-commit <sha>`, keep only the picked work's text, `git commit --no-verify -C <sha>`.
      `git diff <M> promote/main -- <docs files>` must show that text word for word as on `staging` (else gate 3).

4. **Rebuild `promote/staging`** on the new `main` with the old staging's tree. A conflict in a non-docs commit means
   the closure is incomplete: `git cherry-pick --abort`, back to step 2. Pick alone and retarget (step 3) every
   `MISSING` or `NESTED` marker and every marker naming a subject a picked `amend!` renamed. Then the docs, in
   `staging`'s order. A: in place of each fixup split in step 3, its unpicked rest:
   `git checkout <sha> -- <docs files>` restores the full text when every docs fixup before it is already in
   (today's main plus the picked part) and no docs fixup after it in `staging`'s order reached `main`, whole or in
   part; then `git commit --no-verify` with the subject `fixup! flavour: document the fork for contributors and agents`
   and a body naming the unpicked work. Every other docs fixup is cherry-picked as it is. If a later fixup reached
   `main`, a cherry-pick conflicts (`--abort`) or `same-tree` does not print, B restores them as one.

    ```bash
    GIT_LFS_SKIP_SMUDGE=1 git switch -q -c promote/staging promote/main
    git cherry-pick --allow-empty <rest of <M>..<S> in order, without the closure and docs fixups>
    git cherry-pick --allow-empty <remaining docs fixups>   # A
    git diff --name-only HEAD <S>                           # B: must list docs files only
    git checkout <S> -- <those files>
    git commit --no-verify -m 'fixup! flavour: document the fork for contributors and agents' -m '<the unpicked work>'
    git diff --quiet <S> promote/staging && echo same-tree   # must print it
    ```

5. **Verify** both candidates; the last four commands dry-run the next promotion.

    ```bash
    skills/suite-dark-branches/scripts/series-check.sh --main promote/main promote/staging
    git range-diff --no-color develop..<M> develop..promote/main | grep -E '^ *[-0-9]+: '
    GIT_LFS_SKIP_SMUDGE=1 git checkout -q --detach promote/staging
    GIT_SEQUENCE_EDITOR=: GIT_LFS_SKIP_SMUDGE=1 git rebase -q -i --autosquash develop
    git log --oneline -E --grep='^(fixup|amend|squash)! ' develop..HEAD    # must print nothing
    git diff --quiet HEAD promote/staging && echo same-tree; git checkout -q promote/staging
    ```

    - series-check prints no `UNFOLDED`, `MISSING` or `NESTED` line; the dry run prints `same-tree` (if it stops,
      `git rebase --abort` and report it); prettier passes on the `.md` docs files of both (`SUITE_DARK.md`, Checks).
    - range-diff: `>` only for the closure's non-marker commits, `!` only for commits a picked marker folded into (the
      docs commit included), `=` for the rest, no `<`. Explain every `!` from the full output. The order follows the
      rule, and each folded `amend!` left its new message.

6. **Type-check and unit-test `promote/main`**, mandatory even after clean cherry-picks; `promote/staging` keeps the
   checked tree. Use the CI candidate `ci/promote-main` (suite-dark-branches step 7). Without CI, run the throttled
   checks of `SUITE_DARK.md` (Working here, Checks) on `promote/main` with `$P` as defined there. A failure is a
   dependency the closure missed: back to step 2 with the owner, never a patch on `promote/main` alone.
7. **Catch up, then hand off.** `git fetch --prune origin`. If `origin/staging` moved and `<S>` is its ancestor,
   `git cherry-pick --allow-empty <S>..origin/staging` onto `promote/staging`, check
   `git diff --quiet origin/staging promote/staging`, repeat step 5 and pin the staging lease to the new
   `origin/staging`; any other move: stop and ask. Show the owner the new series, the closure, the range-diff summary,
   the docs diff and the checks, then this command with the SHAs filled in (gate 4):

    ```bash
    git push --atomic --force-with-lease=main:<sha of <M>> --force-with-lease=staging:<sha of <S>> \
        origin promote/main:main promote/staging:staging
    ```

8. **After the push**, with suite-dark-branches: move `main`, `staging` and their checkouts (step 6). Rebase each
   feature branch onto `staging` (step 5, old base `git merge-base <S> origin/feature/<name>`; gate 5), except one
   whose session is running: report it as lagging, with that old base, and if it has an open pull request
   (`gh pr list --repo mroz22/trezor-suite-dark --head feature/<name> --state open`), tell the owner not to merge it
   before its agent has rebased it. A feature with nothing of its own
   (`git cherry <S> origin/feature/<name>` prints no `+` line) is not rebased: ask whether to delete it on origin and
   locally. Compare the website (`git show origin/gh-pages:index.html`) with the new `main` and propose any change
   to the owner (SUITE_DARK.md, Website). Delete `promote/*`, return to your branch, note the CI runs on `main` and
   `staging`.

**Abort** before the push: delete `promote/*` and, once their runs finished, `ci/promote-*`; keep the backups.

## Gates

1. The owner's request naming the picks starts the promotion.
2. The owner confirms the closure list before step 3.
3. Docs text on `main` beyond the picked work's existing text needs the owner's agreement.
4. One go for the atomic push of step 7, with the exact command shown first; a catch-up after it needs a new go.
5. One go per feature-branch force-push, with the exact command shown first.
6. List the older `backup/*` branches that SUITE_DARK.md (Development branches) does not keep and ask once whether to
   delete them.

No go needed (standing permissions in `AGENTS.md`): pushing and deleting `ci/promote-main`, and moving the owner's
checkout as in suite-dark-branches step 6 after the approved push.

## Report

- Refs before and after, local and `origin`: `develop` (unchanged), `main`, `staging`, each feature; backups made
  and older ones (gate 6).
- The promoted commits, the closure with a reason for each, retargeted markers, commits caught up in step 7, and how
  many commits stay on `staging`.
- Checks with results: series-check, range-diff summary, dry run, tree equality, prettier, the CI run id and
  conclusion or the local commands and exit codes. Checks not run, and why. `UPSTREAM-*` lines, for the next sync.
- Open decisions as numbered questions with lettered options ("1. Closure: A) as listed, B) without `<subject>`").
