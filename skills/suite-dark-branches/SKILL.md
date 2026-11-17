---
name: suite-dark-branches
description: Everyday Suite Dark branch work, which lands commits on staging or a feature/<name> branch through a local land/* branch, writes fixup!/amend! commits that autosquash folds, creates and lands feature branches, rebases feature branches after staging moved, runs CI on a candidate and moves branches checked out in other worktrees. Use when the owner says "dej to do staging", "dostan to do staging", "dostat do staging", "pushni to i na origin", "zkonsoliduj nad aktualni staging", "zkus svou praci zkonsolidovat nad aktualni staging", "main i staging se posunuly", "udelej na to feature vetev", "prerebasuj feature vetev nad staging", before any push of staging or a feature branch, and before a session ends with unpushed commits.
---

# Suite Dark branches

Rules: the Suite Dark section of `AGENTS.md` (permissions, standing permissions) and `SUITE_DARK.md` (Upstream
first; Development branches: markers, backups, old bases, worktrees, atomic pushes; Working here: Checks).

## When to use

Landing, fixing a pushed commit, following a parent that moved, after every push, before a session ends. Rebuilding
`staging` and folding pushed markers are syncs (`suite-dark-sync`) and promotions (`suite-dark-promote`), never this.

## Preconditions

- Run from the root of your own worktree; `<d>` is today (`date +%Y%m%d`). Shell variables do not survive between
  commands: paste SHAs and names literally.
- Your worktree is clean, or its work is a WIP commit (Development branches), undone later by `git reset -q HEAD~1`
  on its branch: `git add -A && git -c core.hooksPath=/dev/null commit -q -m 'WIP: set aside'`.
- `git branch --list 'sync/*' 'promote/*'` prints nothing (else a sync or promotion is running: land nothing, ask),
  and `land/<target>` does not exist (another session is landing there: ask).

## Steps

### 1. Start

```bash
git fetch --prune origin && git fetch upstream && git status --short
skills/suite-dark-branches/scripts/series-check.sh --main origin/main origin/staging [origin/feature/<name> ...]
```

- Each commit is reported once, under the first ref that contains it; keep the output for steps 2 and 5.
- `REF`: work from `origin/<b>`. Local commits origin lacks (`git log --oneline origin/<b>..<b>`) are someone's:
  never overwrite them, ask. A local branch only behind: move it as in step 6, with `<old>` = `origin/<b>`.
- `MISSING`, `NESTED` on a pushed commit, `UNFOLDED` (a marker on `main`): report; the next sync or promotion
  retargets or drops them with the owner. On your unpushed commits: step 3. `UPSTREAM-*`: the next sync drops that
  commit, so ask before adding a marker that targets it.

### 2. Land commits on `staging` or a feature branch

`<T>` is `staging` or `feature/<name>`. Replays run without hooks; new commits keep them.

1. Build `land/<T>`: `git branch land/<T> <your newest commit>` if your branch is `origin/<T>` plus exactly your
   commits; else `GIT_LFS_SKIP_SMUDGE=1 git switch -c land/<T> origin/<T>` and
   `git -c core.hooksPath=/dev/null cherry-pick --allow-empty <oldest>^..<newest>` (or the SHAs in order).
   `--allow-empty` keeps a message-only `amend!`; never `--skip` a stop on one.
2. Check: `git log --oneline origin/<T>..land/<T>` is exactly what lands, split as Upstream first says, one docs fixup
   per feature. `series-check.sh --main origin/main land/<T>` prints an `OK` for every marker you add and no
   `MISSING`, `NESTED` or `UNFOLDED` line step 1 did not print (`UPSTREAM-*` lines alone exit 1: report them). New
   commits only: append `| grep -F -f <(git log --format=%h origin/<T>..land/<T> | cut -c1-7)`. Checks: Working
   here in `SUITE_DARK.md`, or step 7.
3. After the go (gate 1): `git push origin land/<T>:refs/heads/<T>`. Without a force Git takes only a fast-forward;
   if rejected, fetch and rebuild on the new `origin/<T>`. Then steps 6 and 8.

### 3. Fix a pushed commit with `fixup!` or `amend!`

Pushed means `git branch -r --contains <sha> --list 'origin/*'` prints something. Fix your own unpushed commit in
place: `git commit --fixup=<sha>`, then
`GIT_SEQUENCE_EDITOR=: git -c core.hooksPath=/dev/null rebase -i --autosquash <sha>^`.

1. Target the original commit by its exact subject, never a marker. Exactly one SHA must come out:
   `S=$(git log -1 --format=%s <sha>); git log --format='%H %s' develop..origin/<T> | S="$S" awk 'substr($0, 42) == ENVIRON["S"] { print $1 }'`.
2. Content only: `git commit --fixup=<sha>`. The message changes too: an `amend!` (Development branches), never with
   `--cleanup=verbatim`, with `--allow-empty` when only the message changes; keep the subject unless the rename is the
   point. Land it with step 2:
   `F=$(mktemp) && { printf 'amend! %s\n\n' "$(git log -1 --format=%s <sha>)"; cat <new message>; } > "$F" && git commit -F "$F"`.
3. Retarget a marker at `HEAD` (only on a sync or promotion candidate, or your unpushed commit), keeping its prefix and
   body; `<target>` is the commit it must name:
   `S=$(git log -1 --format=%s <target>); git log -1 --format=%B | S="$S" perl -pe '$. == 1 and s/^(\w+)! .*/$1! $ENV{S}/' | git -c core.hooksPath=/dev/null commit -q --amend --allow-empty -F -`.

### 4. Feature branches

1. Create: `git switch -c feature/<name> origin/staging`, or `git branch -m feature/<name>` when your branch is
   already `origin/staging` plus the feature's commits. First push after the go: `git push -u origin feature/<name>`.
2. Land: if `git merge-base --is-ancestor origin/staging origin/feature/<name>`,
   `git branch land/feature/<name> origin/feature/<name>`; else build it with step 5. Check as in step 2 with the
   range `origin/staging..land/feature/<name>`, which is what lands, then one push after the go; the lease covers only
   the feature branch, so `staging` takes only a fast-forward:

    ```bash
    git push --atomic --force-with-lease=feature/<name>:<old origin sha> origin \
        land/feature/<name>:refs/heads/feature/<name> land/feature/<name>:refs/heads/staging
    ```

### 5. Rebase after the parent moved

`<B>` follows `<P>`: feature branches and your own branch follow `staging`, parents first. `staging` follows `main`
only to finish a sync or promotion that pushed `main` without it, with that operation's `backup/main-pre-<op>-<d>` as
old base (say so in the report); otherwise ask, as `staging` only fast-forwards between them.

1. Old base `<old>`: `git merge-base origin/<P> origin/<B>` if `<P>` only fast-forwarded; after a sync or promotion
   rewrote it, `git merge-base backup/<P>-pre-<op>-<d> origin/<B>` (older backups of `<P>` next, newest first);
   fallback `git merge-base --fork-point origin/<P> origin/<B>`.
2. `git log --oneline <old>..origin/<B>` lists only `<B>`'s own commits. If it holds the docs commit itself
   (`git log --format=%s <old>..origin/<B> | grep -Fx 'flavour: document the fork for contributors and agents'`),
   try the next base. If none passes, `<B>` is a rewritten copy: cherry-pick only its own commits onto `origin/<P>`.
3. Back up and rebase a candidate (your own unpushed branch rebases in place, without either). Skip the backup when
   the sync or promotion that moved `<P>` made `backup/<B>-pre-<op>-<d>`; any other taken name: ask.

    ```bash
    git branch backup/<B>-pre-rebase-<d> origin/<B> && git branch land/<B> origin/<B>
    GIT_LFS_SKIP_SMUDGE=1 git -c core.hooksPath=/dev/null rebase --onto origin/<P> <old> land/<B>
    ```

    Commits the parent has drop as empty. Conflicts are mostly docs fixups: keep both sides, check formatting,
    `git add`, `GIT_EDITOR=true git -c core.hooksPath=/dev/null rebase --continue`.

4. `git range-diff <old>..origin/<B> origin/<P>..land/<B>`: explain every `!`, `<` and `>`; series-check as in step 2.
5. After the go, all moved branches in one push:
   `git push --atomic --force-with-lease=<B>:<old origin sha> ... origin land/<B>:refs/heads/<B> ...`.

### 6. Move the branches a push changed

For each pushed branch `<b>`, `<old>` is the origin SHA the push replaced (its lease or step 1's `REF`); the `REF`
line or `git worktree list` gives the worktree `W` holding it. Move `W` only if
`git --no-optional-locks -C W status --short` prints nothing and `git -C W merge-base --is-ancestor HEAD <old>`
succeeds (it holds nothing the push did not carry): `git -C W merge --ff-only origin/<b>` after a fast-forward,
`git -C W reset --keep origin/<b>` after a force-push. Otherwise leave it and report the command.

- `~/repos/trezor-suite-dark` (standing permission): if
  `git diff --name-only <old> origin/<b> -- yarn.lock .gitmodules submodules` prints anything, ask the owner to run
  `git submodule update --init --recursive`, `git lfs pull upstream` and `yarn` there.
- Another session's worktree: only while that session is idle; if unsure, leave it.
- Checked out nowhere: `git merge-base --is-ancestor <b> <old> && git branch -f <b> origin/<b>`.

### 7. CI on a candidate (standing permission)

For heavy checks, syncs and promotions: `<ci>` is `ci/<op>-<branch>` (`/` in the branch as `-`), several in one push.
Retry `gh run list` until the run appears. A changed candidate: once its run finished, delete its `ci/*`, push again.

```bash
git push origin <candidate>:refs/heads/<ci> [...]
gh run list --repo mroz22/trezor-suite-dark --branch <ci> --commit <candidate sha> --json databaseId,status,conclusion,url
gh run watch <databaseId> --repo mroz22/trezor-suite-dark --exit-status --interval 60   # in the background
git push origin --delete <ci> [...]                                                  # once finished, pass or fail
```

### 8. Finish

1. Back on your branch, delete each `land/*` you made once it equals its origin ref; undo your WIP commit.
2. `git log --oneline <your branches> --not --remotes=origin` lists your commits on no origin ref; for each,
   `git cherry -v origin/staging <b>` shows `-` if it landed under another SHA, else say why it stays local.
3. A feature branch failing `git merge-base --is-ancestor origin/staging origin/feature/<name>` lags behind
   `staging`: one question, A) rebase it now with step 5, B) leave it. Older `backup/*` go into the report.

## Gates

Show the exact command, with full SHAs in leases, before asking.

1. Each push or force-push of `staging` or a feature branch, and deleting one on GitHub, needs the owner's go. His
   message asking for that push ("pushni to i na origin") is the go only for a push that just fast-forwards; a
   force-push needs a go after its exact command was shown. "Dej to do staging" starts steps 2-3, it is not the go.
2. A new fork commit: its content agreed with the owner before it is pushed or lands on `staging`.
3. A draft PR only on his request, its body opening with the agent prefix AGENTS.md requires:
   `gh pr create --repo mroz22/trezor-suite-dark --base staging --draft --head feature/<name> ...`.
4. No go needed (standing permissions): `ci/*` push and delete; moving his checkout as in step 6 after a push he
   approved. Moving it before a push, to try a build, needs his OK.

## Report

- Each touched branch, local and origin, before and after; worktrees moved or the command left; backups made; every
  series-check line other than `REF` and `OK`; checks run (command and result, CI link) and not run; step 8's list.
- Decisions as numbered questions with lettered options ("1. `feature/x` is on staging: A) delete it on origin and
  locally, B) keep it"); the older backups as one question.
