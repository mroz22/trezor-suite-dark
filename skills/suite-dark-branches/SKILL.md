---
name: suite-dark-branches
description: Everyday Suite Dark branch work, which pushes work on feature/<name> branches and opens their pull requests into staging for the owner to merge, lands commits on staging directly when he asks for that push, writes fixup!/amend! commits that autosquash folds, rebases feature branches after staging moved, runs CI on a candidate and moves branches checked out in other worktrees. Use when the owner says "dej to do staging", "dostan to do staging", "dostat do staging", "pushni to i na origin", "zkonsoliduj nad aktualni staging", "zkus svou praci zkonsolidovat nad aktualni staging", "main i staging se posunuly", "udelej na to feature vetev", "prerebasuj feature vetev nad staging", before any push of staging or a feature branch, and before a session ends with unpushed commits.
---

# Suite Dark branches

Rules: the Suite Dark section of `AGENTS.md` (permissions, standing permissions) and `SUITE_DARK.md` (Upstream
first; Development branches: markers, backups, old bases, worktrees, atomic pushes; Working here: Checks).

## When to use

Landing, fixing a commit, following a parent that moved, after every push, before a session ends. Rebuilding
`staging` and folding markers of commits on `main` or `staging` are syncs (`suite-dark-sync`) and promotions
(`suite-dark-promote`), never this.

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
- `MISSING`, `NESTED` on a commit of `main` or `staging`: report; the next sync or promotion retargets or drops them
  with the owner.
  `UNFOLDED` (a marker on `main`): report; the next promotion folds or retargets it (a sync's step 6 fold may take it
  earlier). On your other commits: step 3. `UPSTREAM-*`: the next sync drops that commit, so ask before adding a
  marker that targets it.
- A feature failing `git merge-base --is-ancestor origin/staging origin/feature/<name>` lags behind `staging`, and its
  lines include commits of an older `staging`: rebase it with step 5 before you push anything to it.

### 2. Push commits to a branch

`<T>` is your `feature/<name>`; `staging` only through step 4.4, after its open pull request check. Replays run
without hooks; new commits keep them.

1. Build `land/<T>`: `git branch land/<T> <your newest commit>` if your branch is `origin/<T>` plus exactly your
   commits; else `GIT_LFS_SKIP_SMUDGE=1 git switch -c land/<T> origin/<T>` and
   `git -c core.hooksPath=/dev/null cherry-pick --allow-empty <oldest>^..<newest>` (or the SHAs in order).
   `--allow-empty` keeps a message-only `amend!`; never `--skip` a stop on one.
2. Check: `git log --oneline origin/<T>..land/<T>` is exactly what lands, split as Upstream first says, one docs fixup
   per feature where possible, its body naming the work it documents. `series-check.sh --main origin/main land/<T>`
   prints an `OK` for every marker you add and no `MISSING`, `NESTED` or `UNFOLDED` line step 1 did not print
   (`UPSTREAM-*` lines alone exit 1: report them). New commits only: append
   `| grep -F -f <(git log --format=%h origin/<T>..land/<T> | cut -c1-7)`. Checks: Working here in `SUITE_DARK.md`, or
   step 7.
3. After the go (gate 1): `git push origin land/<T>:refs/heads/<T>`. Without a force Git takes only a fast-forward;
   if rejected, fetch and rebuild on the new `origin/<T>`. Then steps 6 and 8.

### 3. Fix a commit on `main` or `staging` with `fixup!` or `amend!`

A commit on `origin/main` or `origin/staging`, also under another SHA after a Rebase and merge
(`git branch -r --contains <sha> --list origin/main origin/staging` prints something, or
`git cherry origin/staging <sha> <sha>^` prints a `-` line), gets a marker as below. Fix any other commit of yours in
place, on your own feature branch too: `git commit --fixup=<sha>`, then
`GIT_SEQUENCE_EDITOR=: git -c core.hooksPath=/dev/null rebase -i --autosquash <sha>^`. A feature branch already on
`origin` is backed up first (`backup/<branch>-pre-rebase-<d>`) and then needs a force-push (gate 1).

1. Target the original commit by its exact subject, never a marker. Exactly one SHA must come out:
   `S=$(git log -1 --format=%s <sha>); git log --format='%H %s' develop..origin/staging | S="$S" awk 'substr($0, 42) == ENVIRON["S"] { print $1 }'`.
2. Content only: `git commit --fixup=<sha>`. The message changes too: an `amend!` (Development branches), never with
   `--cleanup=verbatim`, with `--allow-empty` when only the message changes; keep the subject unless the rename is the
   point. Land it with step 2:
   `F=$(mktemp) && { printf 'amend! %s\n\n' "$(git log -1 --format=%s <sha>)"; cat <new message>; } > "$F" && git commit -F "$F"`.
3. Retarget a marker at `HEAD` (only on a sync or promotion candidate, or your own commit not on `main` or
   `staging`), keeping its prefix and body; `<target>` is the commit it must name:
   `S=$(git log -1 --format=%s <target>); git log -1 --format=%B | S="$S" perl -pe '$. == 1 and s/^(\w+)! .*/$1! $ENV{S}/' | git -c core.hooksPath=/dev/null commit -q --amend --allow-empty -F -`.

### 4. Feature branches

Every change lands on `staging` from a feature branch, through a pull request the owner merges.

1. Create: `git switch -c feature/<name> origin/staging`, or `git branch -m feature/<name>` when your branch is
   already `origin/staging` plus the feature's commits. First push after the go: `git push -u origin feature/<name>`.
2. Into `staging`, when the owner asks to put the work there ("dej to do staging", "dostan to do staging"; gate 1):
   the branch must contain the current `origin/staging` (else step 5 first). Check it as in step 2.2 with the range
   `origin/staging..feature/<name>` and push it: a new branch with `git push -u origin feature/<name>`, one that only
   gained commits as in step 2.3, one that step 5 rebased with step 5.5's lease-pinned push, which needs its own go
   (gate 1). Then open the pull request. Write its body to a file whose first line is the agent prefix `AGENTS.md`
   requires, and say what the branch changes and what was checked:

    ```bash
    gh pr create --repo mroz22/trezor-suite-dark --base staging --head feature/<name> --title '<summary>' --body-file <file>
    ```

    The owner merges it with "Rebase and merge"; an agent never merges it. If `staging` moves first, rebase the branch
    with step 5 and push it again (a force-push: gate 1).

3. After the merge: `git fetch --prune origin`; `git cherry origin/staging feature/<name>` prints only `-` lines, as
   every commit landed under a new SHA. Take the branch out of every worktree that has it checked out: your own with
   `git switch -c <next branch> origin/staging`, another one only when it is clean and its session idle, with
   `git -C <W> switch -q --detach origin/staging`. Then `git branch -D feature/<name>`. If `origin/feature/<name>`
   still exists, ask once whether to delete it (`git push origin --delete feature/<name>`).
4. Only when the owner asks to push it to `staging` directly, without a pull request: first
   `gh pr list --repo mroz22/trezor-suite-dark --head feature/<name> --state open` must print nothing, because pushing
   a branch with an open pull request to `staging` merges it, which agents never do. Then, if
   `git merge-base --is-ancestor origin/staging origin/feature/<name>`,
   `git branch land/feature/<name> origin/feature/<name>`; else build it with step 5. Check as in step 2 with the
   range `origin/staging..land/feature/<name>`, which is what lands, then one push after the go; the lease covers only
   the feature branch, so `staging` takes only a fast-forward:

    ```bash
    git push --atomic --force-with-lease=feature/<name>:<old origin sha> origin \
        land/feature/<name>:refs/heads/feature/<name> land/feature/<name>:refs/heads/staging
    ```

5. Some of a feature's commits early: cherry-pick them onto a new feature branch of their own (4.1) with their own
   docs fixup, and tell the feature's agent which text to drop from its docs fixup on its next rebase (step 5).

### 5. Rebase after the parent moved

`<B>` follows `<P>`: feature branches and your own branch follow `staging`, parents first. `staging` follows `main` only
to finish a sync or promotion that pushed `main` without it, with that operation's `backup/main-pre-<op>-<d>` as old
base (say so in the report); otherwise ask, as `staging` only fast-forwards between them. Leave another session's
feature branch whose agent is working right now, a running session in the worktree that has it checked out (Conductor
shows the session state; if unsure, ask the owner): report it as lagging, with its old base, for that agent to rebase,
and if it has an open pull request, tell the owner not to merge it before that.

1. Old base `<old>`: `git merge-base origin/<P> origin/<B>` if `<P>` only fast-forwarded; after a sync or promotion
   rewrote it, `git merge-base backup/<P>-pre-<op>-<d> origin/<B>` (with its `-2`, `-3` variants; older backups of
   `<P>` next, newest first);
   fallback `git merge-base --fork-point origin/<P> origin/<B>`.
2. `git log --oneline <old>..origin/<B>` lists only `<B>`'s own commits. If it holds the docs commit itself
   (`git log --format=%s <old>..origin/<B> | grep -Fx 'flavour: document the fork for contributors and agents'`),
   try the next base. If none passes, `<B>` is a rewritten copy: cherry-pick only its own commits onto `origin/<P>`.
3. Back up and rebase a candidate (your own branch that is on no origin ref rebases in place, without either). Skip
   the backup when the sync or promotion that moved `<P>` made `backup/<B>-pre-<op>-<d>`; if
   `backup/<B>-pre-rebase-<d>` exists, use `<d>-2`, `<d>-3`.

    ```bash
    git branch backup/<B>-pre-rebase-<d> origin/<B> && git branch land/<B> origin/<B>
    GIT_LFS_SKIP_SMUDGE=1 git -c core.hooksPath=/dev/null rebase --onto origin/<P> <old> land/<B>
    ```

    On your own feature branch add `-i --autosquash --empty=drop` with `GIT_SEQUENCE_EDITOR=:`: markers of the
    feature's own commits fold, markers of commits on `main` or `staging` stay. Commits the parent has drop as empty.
    Conflicts are mostly docs fixups: keep both sides, minus the text `<P>` already has for commits that dropped (they
    landed early), check formatting, `git add`, `GIT_EDITOR=true git -c core.hooksPath=/dev/null rebase --continue`.

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

1. Back on your branch, delete each `land/*` you made, pushed or not; undo your WIP commit.
2. `git log --oneline <your branches> --not --remotes=origin` lists your commits on no origin ref; for each,
   `git cherry -v origin/staging <b>` shows `-` if it landed under another SHA, else say why it stays local.
3. A feature branch failing `git merge-base --is-ancestor origin/staging origin/feature/<name>` lags behind
   `staging`: one question, A) rebase it now with step 5, B) leave it; one whose session is running is only
   reported. The older `backup/*` that SUITE_DARK.md (Development branches) does not keep go into the report.

## Gates

Show the exact command, with full SHAs in leases, before asking.

1. Each push or force-push of `staging` or a feature branch, and deleting one on GitHub, needs the owner's go. His
   message asking for that push ("pushni to i na origin") is the go only for a push that just fast-forwards or
   creates the branch; a force-push needs a go after its exact command was shown. "Dej to do staging" (or another
   request to put the work into `staging`) is the go for step 4.2: pushing the feature branch when that push creates
   it or only adds commits, and opening its pull request. It is not a go to force-push it or to push `staging`.
2. A new fork commit: its content agreed with the owner before it is pushed or lands on `staging`.
3. A pull request only on his request ("dej to do staging" is one), its body opening with the agent prefix
   `AGENTS.md` requires. Agents never merge it, and never push to `staging` a branch that has an open one.
4. No go needed (standing permissions): `ci/*` push and delete; moving his checkout as in step 6 after a push he
   approved. Moving it before a push, to try a build, needs his OK.

## Report

- Each touched branch, local and origin, before and after; worktrees moved or the command left; backups made; every
  series-check line other than `REF` and `OK`; checks run (command and result, CI link) and not run; step 8's list.
- Decisions as numbered questions with lettered options ("1. `feature/x` is on staging: A) delete it on origin and
  locally, B) keep it"); the older backups SUITE_DARK.md does not keep as one question.
