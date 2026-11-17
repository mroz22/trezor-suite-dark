---
name: suite-dark-sync
description: Sync Suite Dark with trezor/trezor-suite develop by fast-forwarding develop, rebuilding main, staging and the feature branches on it, dropping fork commits upstream has merged, auditing the upstream delta for privacy, checking the result and handing over one atomic, lease-pinned push. Use only when the owner asks for it, e.g. "syncni s upstreamem", "prerebasuj na upstream develop", "vsechny vetve prerebasuj na upstream".
---

# Suite Dark: sync with upstream

Rules: `SUITE_DARK.md` (Development branches; Working here: Branches, CI, Sync with upstream, Checks) and the Suite
Dark section of `AGENTS.md`. Moving branches, markers and CI: `skills/suite-dark-branches/SKILL.md`. `<d>` is the
date of step 2 (`yyyymmdd`), `<O>` is `backup/develop-pre-sync-<d>`. Shell variables do not survive between
commands: paste literal values, never recompute `<d>` with `date`.

## When to use

Only on the owner's request for a sync in his own message; a `develop` that is behind is no reason to start one.

## Preconditions

1. Own workspace: `git status --short` is empty and nothing is in progress (WIP commit, see Development branches);
   `git branch --list 'sync/*' 'promote/*'` prints nothing, else another session is mid-operation: ask. Then
   `git fetch --prune origin && git fetch upstream develop`.
2. `skills/suite-dark-branches/scripts/series-check.sh --main origin/main origin/develop origin/staging origin/<f>`
   for each `<f>` in `git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin/feature/`, before
   `develop` moves. A local branch equal to or behind its origin ref is fine; local commits origin lacks: stop, ask.
   Local `develop` may be ahead after an aborted sync if `git merge-base --is-ancestor origin/develop develop`.
   `MISSING`, `NESTED` and `UNFOLDED` lines go into step 1's table.
3. `git worktree list` shows `develop` checked out nowhere; `git merge-base --is-ancestor develop upstream/develop`.
4. A feature failing `git merge-base --is-ancestor origin/staging origin/<f>` stays out; report it.

## Steps

1. **Table** (read-only), then wait for the owner's answers. One row per `Upstream:` commit
   (`git log --oneline --grep='^Upstream:' develop..origin/<branch>`) and per `MISSING`/`NESTED` marker, with its
   candidate (the branch its series-check line names), PR, PR state and action. PRs:
   `gh pr list --repo trezor/trezor-suite --author mroz22 --state all --limit 50 --json number,state,mergedAt,title`,
   per merged one `gh pr view <n> --repo trezor/trezor-suite --json commits --jq '.commits[].messageHeadline'`
   (catches reworded subjects). Actions: _drops by itself_ (`UPSTREAM-SAME`); _drop by hand_ (merged with another
   patch), with every marker naming it (`git log --oneline develop..origin/<branch> | grep -F '! <subject>'`) unless
   the owner keeps a marker's change as its own commit; _keep_; for a marker: A) retarget to `<subject>`, B) drop.
   `UNFOLDED` markers stay on `main` until a promotion folds them.
2. **Backups and candidates, then `develop`.** The backups are the old bases and the lease pins; the candidates
   tell other sessions a sync is running. If a name exists, stop and ask.

    ```bash
    D=$(date +%Y%m%d); echo "<d> is $D"; ok=1
    for b in develop main staging feature/<name>; do git branch "backup/$b-pre-sync-$D" "origin/$b" || { ok=0; break; }; done
    for b in main staging feature/<name>; do [ "$ok" = 1 ] && { git branch "sync/$b" "backup/$b-pre-sync-$D" || ok=0; }; done
    [ "$ok" = 1 ] && git fetch upstream develop:develop
    ```

3. **Rebase the candidates**, in this order; finish one (steps 4-6) before the next.

    | Candidate             | `<new>`        | `<old>`                       |
    | --------------------- | -------------- | ----------------------------- |
    | `sync/main`           | `develop`      | `<O>`                         |
    | `sync/staging`        | `sync/main`    | `backup/main-pre-sync-<d>`    |
    | `sync/feature/<name>` | `sync/staging` | `backup/staging-pre-sync-<d>` |

    ```bash
    DROP='<sha>|<sha>'   # full SHAs (git rev-parse) of this candidate's drops from step 1; may be empty
    EDIT='<sha>|<sha>'   # full SHAs of its markers to retarget; may be empty
    GIT_SEQUENCE_EDITOR="perl -i -pe 's/^pick ($DROP) /drop \$1 /; s/^pick ($EDIT) /edit \$1 /'" GIT_LFS_SKIP_SMUDGE=1 \
        git -c core.abbrev=40 -c core.hooksPath=/dev/null rebase -i --no-autosquash --empty=drop --onto <new> <old> <candidate>
    ```

    `core.abbrev=40` writes full SHAs into the todo, so the editor matches exactly; `--empty=drop` drops commits whose
    change upstream already has. At an `edit` stop retarget the marker (suite-dark-branches step 3.3). At a conflict,
    resolve it in the commit `git log -1 --format='%h %s' REBASE_HEAD` names and `git add`. Then
    `GIT_EDITOR=true git -c core.hooksPath=/dev/null rebase --continue`. When a candidate changes later, rebase the
    ones above it again, with empty `DROP` and `EDIT` and `<old>` = the changed candidate's SHA before the change.

4. **Workflow-removal stop.** Handle it exactly as `SUITE_DARK.md` (Working here, Sync with upstream) says, continuing
   with step 3's `--continue`. Afterwards `git ls-tree --name-only sync/main .github/workflows/` lists only
   `suite-dark-check.yml`; otherwise fold the removal as in step 6.
5. **Docs.** Remove the dropped commits' lines from the upstream list in `SUITE_DARK.md` (Upstream first): main's in
   the docs commit on `sync/main` (fold as in step 6), staging's or a feature's in one docs `fixup!` on that
   candidate. Format with prettier as in Checks.
6. **Fixes and folds.** A clean rebase can still break where upstream renamed or removed something a fork commit uses
   (2026-11-23: the `#src/hooks/suite` barrel). Read the files both sides changed,
   `comm -12 <(git diff --name-only <O> develop | sort) <(git diff --name-only develop sync/staging | sort)`; the
   checks find the rest (a rejected action pin belongs in `flavour: check the fork on every push`). Fix in the
   candidate holding the broken commit `<c>` with `git commit --fixup=<c> -- <files>`, fold at once with
   `GIT_SEQUENCE_EDITOR=: git -c core.hooksPath=/dev/null rebase -i --autosquash <c>^`, then rebuild the candidates
   above. The fold also takes older markers whose target lies after `<c>`; name them in the report.
7. **Verify.**
    - `skills/suite-dark-branches/scripts/series-check.sh --main sync/main sync/staging sync/feature/<name>` prints
      only `REF`, `OK` and step 1's `UNFOLDED` lines; each candidate contains the one below it
      (`git merge-base --is-ancestor`).
    - Reworded upstream merges, for `sync/staging` and each feature candidate: lists only commits the owner kept:
      `comm -12 <(git log --format=%s <O>..develop | sort) <(git log --format=%s --grep='^Upstream: ' develop..<candidate> | sort)`.
    - Per candidate, with step 3's ranges (`<O>..backup/main-pre-sync-<d> develop..sync/main`, and so on):
      `git range-diff --no-color <old range> <new range> | grep -E '^ *[0-9-]+: ' | grep -v ' = '`. Each `<` (gone)
      is on the drop list, `UPSTREAM-SAME` or a folded marker; a `>` occurs only for step 5's docs `fixup!`. For each
      `!` read its full entry and say whether only context or a retargeted subject moved, or the change differs (a
      resolution or fix); report the second kind.
    - Per hand drop, explain every hunk of `git diff backup/staging-pre-sync-<d> sync/staging -- <files>` (the files
      of the dropped commit and its markers; a feature's own pair for a feature commit) as upstream's change
      (`git log --oneline <O>..develop -- <files>`) or the fork-versus-merged patch difference. A hunk that takes
      away fork behaviour upstream did not take means the drop lost something: ask.
8. **Checks** on CI candidates `ci/sync-main`, `ci/sync-staging`, `ci/sync-feature-<name>` with suite-dark-branches
   step 7; audit while they run. If CI cannot run, use the throttled local form of `SUITE_DARK.md`, Checks, on
   `sync/staging`, which contains main.
9. **Upstream-delta privacy audit.** This is the single list of patterns; add new ones here.

    ```bash
    P='data\.trezor\.io|services\.trezor\.io|cdn\.trezor\.io|sentry|analytics|FeedbackCard|sendFeedbackThunk|Banner|configSource|isCodesignBuild|wallet-trading|loadInitialDataThunk|GITBOOK_REVISION'
    git diff --stat=200 -i -G"$P" <O> develop -- . ':!suite-native*' ':!suite/e2e' ':!*.test.*'
    git log --format='%h %s' -i -G"$P" <O>..develop -- <file>   # the upstream commit behind a hit
    for h in $(git diff -U0 <O> develop | grep '^+' | grep -o -E 'https?://[A-Za-z0-9.-]+' | sort -u); do
        git grep -q -F "$h" <O> || echo "NEW $h"; done
    # after a GITBOOK_REVISION change: the Guide category guideReducer.ts drops must still exist
    gh api "repos/trezor/trezor-suite-guide/git/trees/<rev>?recursive=1" --jq '.tree[].path' | grep -x 'en-us/4_buy-sell-and-exchange'
    ```

    Read each hit in `git diff <O> develop -- <file>`: does it send data, show a banner, form or trading entry point
    (which must read `selectIsRegionRestricted`), or undo a fork default? On a large delta, give pattern groups to
    subagents and have another confirm each finding. Neutralising a confirmed surface in the commit that owns its
    area, or listing it on the website, is a fork change for the owner; with his go, fix it as in step 6.

10. **Catch up, then hand off.** `git fetch --prune origin`. Where `origin/staging` or a feature moved on from its
    backup, `git cherry-pick --allow-empty backup/<b>-pre-sync-<d>..origin/<b>` onto `sync/<b>`, rebuild the
    candidates above, repeat steps 7-8 and pin that lease to the new `origin/<b>`. Any other move: stop and ask.
    Then the report and the exact push for the owner's go, leases pinned with `git rev-parse`:

    ```bash
    # develop has no lease: it only fast-forwards
    git push --atomic --force-with-lease=main:<sha> --force-with-lease=staging:<sha> \
        --force-with-lease=feature/<name>:<sha> \
        origin develop sync/main:main sync/staging:staging sync/feature/<name>:feature/<name>
    ```

11. **After the push.** `git ls-remote origin` shows the candidates' SHAs. Switch the own workspace back to its
    branch. Move local `main`, `staging`, the features and the worktrees holding them, the owner's checkout included,
    with suite-dark-branches step 6. Delete the `sync/*` candidates, watch CI on `main` and `staging`
    (`gh run list --repo mroz22/trezor-suite-dark --branch <b> --limit 1`), list the older backups
    (`git branch --list 'backup/*'`) and ask once whether to delete them.

**Abort** before the push: delete `sync/*` and, once their runs finished, `ci/sync-*`; keep the backups. Local
`develop` may stay ahead of `origin/develop`: it is still a pure mirror, and the next sync accepts it.

## Gates

- The owner starts the sync and answers step 1's table (hand drops, markers) before step 2.
- Neutralising an audit finding, listing it on the website or any other fork change needs his go.
- `ci/sync-*` pushes and deletions: standing permission (`AGENTS.md`). Any other push: his go for the exact command
  shown first; a candidate that changes after the go, step 10's catch-up included, needs a new go.
- His checkout moves under the standing OK in `AGENTS.md` (suite-dark-branches step 6), else ask.
- Deleting older backups: ask once, at the end.

## Report

Each branch's SHA before (backup) and after (candidate) with commit counts; upstream commits taken
(`git rev-list --count <O>..develop`); the table and what dropped or was retargeted; conflicts, fixes and folds per
commit; range-diff `!` entries beyond context; audit findings (file, upstream commit, what reaches which host) and new
hosts; checks run (CI URLs or commands, results) and not run; backups made and older ones; commits caught up in step
10; the push command; decisions as numbered questions with lettered options.
