# Suite Dark

Suite Dark is a desktop-only, privacy-first fork of [Trezor Suite](https://github.com/trezor/trezor-suite),
maintained by [mroz22](https://github.com/mroz22) in [mroz22/trezor-suite-dark](https://github.com/mroz22/trezor-suite-dark).
It is an acknowledged fork; the Trezor Suite authors allowed its distribution. It is not a SatoshiLabs product.

This file is the project's memory. Read it before working here, keep it current when a decision or a fork
commit changes, and do not repeat research it already answers. Notes outside this file (agent memory, the
git-excluded `.context/`) are not authoritative; move a decision here or drop it.

## How the fork is built

`develop` mirrors `trezor/trezor-suite` `develop`. `main` is `develop` plus a short, linear series of fork
commits, one self-contained change each: the documentation commit first, so the rules come before the changes,
then upstream-bound commits (see Upstream first), then the other flavour commits. The series is the whole difference
from upstream:

```bash
git log --oneline --reverse develop..main   # the fork commits
git diff develop..main --stat               # the complete list of files the fork adds or changes
git grep -n "Suite Dark"                    # fork comments and brand strings; deletions, icons and translations show only in the diff
```

Commit SHAs change on every rebase, so refer to fork commits by subject, not by SHA. What each fork commit
changes and why is in its message; this file keeps what git does not: decisions, postponed work, known gaps and
how to work here.

## Upstream first

The owner's plan for the project (2026-11-20): Suite Dark is where features land that upstream Trezor Suite has no
time or energy for. Each one is built here until it is finished and works, then shown to the upstream team to
convince them to take it. Whatever a feature needs that upstream could take on its own, above all refactoring, goes
upstream separately, as its own pull request, ahead of the feature. That keeps the fork small and the feature's final
upstream pull request small. Fixes and hardening of upstream code go upstream first, before refactors and features.

Every commit takes the same path (owner, 2026-11-25): `feature/<name>` → `staging`, where it is in daily use → `main`,
and an upstream-bound one then → upstream. An upstream pull request is cut from a commit that is already on `main`:
fixes first, then refactors and features, each after the commits it builds on. A commit that is only on `staging` goes
upstream earlier only when the owner names it, for example a fix upstream users need now or a refactor upstream needs
early. Commits are split by where they are going:

| Kind              | Subject                                   | Last line of the message | Goes upstream, once on `main`             |
| ----------------- | ----------------------------------------- | ------------------------ | ----------------------------------------- |
| Upstream fix      | upstream style, e.g. `fix(coinjoin): …`   | `Upstream: fix`          | first, as its own PR                      |
| Upstream refactor | upstream style, e.g. `refactor(suite): …` | `Upstream: refactor`     | as its own PR, before the feature's PR    |
| Upstream feature  | upstream style, e.g. `feat(coinjoin): …`  | `Upstream: feature`      | once it is finished and works in the fork |
| Flavour           | `flavour: …`                              | none                     | never                                     |

- Every commit not meant for upstream is a flavour commit: the docs commit, the two CI commits and every fork
  change. Its subject is `flavour: <summary>`, with no type and no scope; upstream's `COMMITS.md` applies only to
  upstream-bound commits. List the flavour commits with `git log --oneline develop..main | grep ' flavour: '`.
- Never mix destinations in one commit. If a feature needs a refactor, the refactor is its own
  `Upstream: refactor` commit and the feature commit builds on it.
- Look for refactors that would shrink the fork's diff later: a config option, an overridable default, one place for
  a value that is now hard-coded in several, a render site the fork can switch off. Do each as its own
  `Upstream: refactor` commit even when no feature needs it yet, and say in the body which flavour commit gets
  smaller once upstream has it.
- An upstream-bound commit must stand on plain `develop`: it applies without any flavour commit; contains no
  Suite Dark names, `suitedark` values or `Suite Dark:` comments; follows upstream's `COMMITS.md` (Conventional
  Commits, no `!` after the type); and passes upstream's checks for the packages it touches. A flavour commit may
  build on an upstream-bound commit, never the other way round.
- Order on `main`, the one rule for every sync and promotion: the docs commit; then the upstream-bound commits in
  dependency order (a commit that another one needs goes before it), with fixes before refactors before features only
  among commits that do not depend on each other; then the other flavour commits. A promoted commit goes after the
  existing commits of its group (the upstream-bound ones, or the other flavour commits), not sorted into them, unless
  a dependency forces an earlier place; the kind order applies among the promoted ones.
- `Upstream: fix`, `Upstream: refactor` or `Upstream: feature` is a git trailer, alone in the last paragraph of the
  message. List the commits with `git log --oneline --grep '^Upstream:' develop..main`. Do not put upstream issue or
  pull request numbers in fork commit messages (GitHub shows such references upstream). Refer to pull requests of
  other projects without `#` (`WalletWasabi PR 13658`), GitHub would link them.
- Sending one upstream: the owner decides when, and only the owner's request for that specific pull request allows
  pushing to `trezor/trezor-suite` or opening it. Steps:
  [suite-dark-upstream-pr](skills/suite-dark-upstream-pr/SKILL.md). When upstream merges it, the next sync drops the
  fork commit. If upstream declines a commit, the owner decides whether it is dropped, kept upstream-bound for a later
  attempt, or made a flavour commit (an `amend!` to `flavour: …` without the trailer). It can become flavour only when
  no upstream-bound commit builds on it; the next promotion moves it after the upstream-bound commits.

The upstream pull requests are not tracked here. `git log --oneline --reverse --grep '^Upstream:' develop..main`
lists the upstream-bound commits on `main` in series order (`develop..staging` adds the ones still waiting for a
promotion); suite-dark-upstream-pr step 1 shows the fork commits one builds on (same files and the symbols it uses).
The pull request of a commit and its state:
`S=$(git log -1 --format=%s <sha>); gh pr list --repo trezor/trezor-suite --author mroz22 --state all --search "\"$S\" in:title"`.
The owner's other
upstream pull requests share the author, so an unfiltered list does not show the fork's; a pull request retitled in
review is found only by its new title.

## Development branches

`main` is production: the owner's friends use it and releases will come from it. New work reaches it only after it
has been in daily use on `staging`, and only when the owner promotes it.

- `staging` is the next `main`. The owner builds the desktop app from it and uses that build every day, which is the
  main test of the work; CI checks every push. Work reaches it through pull requests that the owner merges (next
  bullet). An agent pushes `staging` itself only in a sync or a promotion, or when the owner asks for that push
  (suite-dark-branches step 4.4). Between syncs and promotions it only moves forward.
- `feature/<name>` holds every change, small ones included: `staging` plus the change's commits. It lands through a
  pull request against `staging` (owner, 2026-11-25): when the owner asks to put the work into `staging` ("dej to do
  staging"), the agent brings the branch onto the current `staging`, pushes it and opens the pull request; a
  force-push of a branch already on `origin` still needs his go for the command shown. The owner
  merges it on GitHub with "Rebase and merge", never "Create a merge commit" or "Squash and merge", which break the
  series. Rebase and merge gives the commits new SHAs, so the branch is deleted after the merge. An agent never pushes
  to `staging` a branch that has an open pull request: GitHub would mark it merged, and agents never merge
  (`AGENTS.md`). Branches in `trezor/trezor-suite` for upstream pull requests keep the form `mroz22/<topic>`; locally
  such a branch is `upstream-pr/<topic>`, which never goes to `origin`.
- `staging` is `main` plus commits on top, and a feature branch is `staging` plus commits on top, never a rewritten
  copy of the series. Then `git log --oneline main..staging` is exactly the pending work, and moving to a new base
  takes one command.
    - New work: commits as they should land on `main`, split as in Upstream first, each feature in its own commits so
      it can be promoted alone. Upstream-bound commits sit on top like the rest; promotion moves them to their place in
      the series.
    - Changes to a commit that is already on `main` or `staging`, this file included: a `fixup!` commit for it,
      `git commit --fixup=<that commit>`. When its message changes too, make an `amend!` commit instead:
      the subject `amend! <subject of that commit>`, a blank line, then the whole new message, written with
      `git commit -F` (`--fixup=amend:` needs an editor). Only a sync or a promotion folds them, on its candidate.
      Always name the original commit by its exact subject, never another `fixup!` or `amend!`. Git folds a nested
      marker only when the original is in the same rebase, and it also accepts a subject prefix or a SHA, so a marker
      that names an old or wrong subject stays unfolded without an error or folds into the wrong commit.
      `series-check.sh` (suite-dark-branches) reports such markers, and a sync or promotion retargets them, also when a
      fold renames their target. A commit that is only on a feature branch is fixed in place by that feature's agent,
      which folds its markers when it rebases the branch (suite-dark-branches step 5); `ci/*` branches do not count.
      Documentation changes are docs `fixup!` commits, one per feature where possible, with a body naming the work
      they document. A promotion copies the picked work's text onto `main`, splitting a fixup that covers more, and
      keeps the rest on `staging` (suite-dark-promote steps 3-4).
- Every operation that rewrites branches (`sync`, `promote`, `rebase`) first makes a backup of each branch it moves:
  `backup/<branch>-pre-<op>-<yyyymmdd>`, with the branch name as is (`backup/staging-pre-sync-20261125`,
  `backup/feature/pay-in-coinjoin-pre-promote-20261125`); a second operation on the same day appends `-2`, `-3` to
  all its backup names. Keep the newest backup of each branch, and every `backup/staging-*` that a feature branch is
  still built on, because it is that branch's old base: for some feature or workspace branch `<f>`, local or
  `origin/feature/*`, `git merge-base --is-ancestor $(git merge-base <backup> <f>) origin/staging` fails. At the end of
  each operation, list the other older ones and ask the owner once whether to delete them.
- Set work aside with a WIP commit, never `git stash`: all worktrees share one stash. A branch checked out in another
  worktree (`git worktree list`) moves only when that worktree is clean, only with `git merge --ff-only` or
  `git reset --keep`; never `git branch -f`, `update-ref` or `reset --hard` on it.
- After `main` moves (a sync or a promotion), `staging` moves onto it, then every feature branch onto `staging`, except
  one whose agent is working right now: a running session in the worktree that has the branch checked out (Conductor
  shows it; if unsure, ask the owner); a sync also leaves one still built on an earlier, rewritten `staging`
  (suite-dark-sync precondition 4). That branch is left alone and reported as lagging, with its old base, and its
  agent rebases it; if it has an open pull request, the report tells the owner not to merge it before that. Commits that
  the new base now contains drop out, so only the unpromoted work stays. The old base is the parent's backup from that
  operation; `git merge-base --fork-point` is only the fallback. A promotion rebuilds `staging` instead of rebasing
  it. Steps: [suite-dark-branches](skills/suite-dark-branches/SKILL.md).
- Promotion, of the commits the owner picks: `main` is rebuilt on `develop` in the series order (see Upstream first)
  with them in place and their `fixup!` and `amend!` commits folded. It ends with no marker left and differs from the
  old `main` only by the promoted changes. Steps: [suite-dark-promote](skills/suite-dark-promote/SKILL.md).
- A push that moves several branches is one `git push --atomic`, and each rewritten branch is pinned to the commit it
  replaces with `--force-with-lease=<ref>:<sha>`.

## Decisions already taken

Ask the owner before reversing any of these.

- Simplest version that works (2026-11-21): offer the minimal version of a change first and list the extras
  (failover, runtime detection, more options) as optional, with their size; build them only when the owner asks.
- Desktop only. Web and mobile are not built, released or checked at runtime. Fork edits in shared code
  (`suite-common/*`, `packages/suite`) also change their behaviour (analytics and message-system defaults, discreet
  mode, `sendFeedbackThunk`); keep their unit tests and lint passing.
- Not Bitcoin-only. All upstream networks, Earn, WalletConnect and NFTs stay.
- No trading (2026-11-21). Buy failed on macOS: Invity rejects the `suitedark://` return link ("Following trade
  parameters are invalid: returnUrl"). Instead of fixing it the fork goes back to the old fork's choice and hides
  Buy, Sell, Swap and Concierge with their KYC steps. The upstream code stays; one switch hides it.
- Privacy: no analytics, crash reports or feedback reach Trezor servers, not even data the upstream privacy rules call
  non-sensitive; no remote message-system configuration, no feedback forms, no promotional banners, Tor and discreet
  mode on by default. Functional traffic stays: blockchain backends, fiat rates, token definitions, firmware,
  Earn data, the country lookup and image proxy on `services.trezor.io`, Blockaid checks through
  `cdn.trezor.io`. One exception the fork keeps for now: a TRX vote in Earn is registered with Trezor's Earn server by
  its transaction id, and removing that breaks voting. The website lists this traffic as it is on `main` (Working
  here, Website).
- Kept on purpose: the backend User-Agent `Trezor Suite <version>` (blends in with Trezor Suite users) and the
  SatoshiLabs copyright and author. `process.env.VERSION` has no suffix, because it is sent in the backend User-Agent.
- Coinjoin: upstream Privacy accounts plus the kruw.io default coordinator (tested by the owner), with the client-side
  defences against a malicious coordinator, each its own upstream-bound commit (2026-11-21): a coordinator fee cap of
  0.1 % for any coordinator (the fork's coordinator list allows 0 %, no fee, for kruw and OpenCoordinator), at least 21
  inputs on mainnet (2 on test networks), no solo coinjoins, checks of the round id, of the ownership proofs and inputs
  of other participants, of own inputs and outputs and of blame rounds, output scripts never reused after a failed round
  except in its blame rounds, outputs only on change addresses up to the last used one plus 20 (the discovery lookout of
  50 stays), and mixing stops with an error message when the coordinator provably lies. Coordinators older than
  WalletWasabi 2.3.0 lose their blame rounds. Users choose the coordinator from the list in the build, in a Privacy
  account's Coinjoin setup, one choice per network for all its Privacy accounts, and the choice is kept (2026-11-21).
  The Coinjoin setup always shows its settings, the coordinator included: Recommended shows the values a session uses,
  read-only, and keeps the network's coordinator choice; Custom makes them editable (2026-11-23). No automatic switch to
  another coordinator, no detection of a coordinator that stops responding while Suite runs (only the check when the
  client starts, the rest goes to the log) and no custom coordinator address for now. Which coordinators the list names
  is the owner's decision; OpenCoordinator was added on 2026-11-22. Suite Dark contacts it only once the user chooses
  it.
- Password manager: upstream's Dropbox-based experimental feature, only renamed. Upstream does not save the
  experimental toggle (`packages/suite/src/actions/suite/storageActions.ts`), so it is off after every restart.
- Minimal diff: prefer a default, flag or render site over editing many upstream lines; put fork-only values in
  overlay files; start fork comments with `Suite Dark:` and explain why. No new dependencies, packages or IndexedDB
  migrations without the owner: `yarn.lock` conflicts on every sync, and a fork migration raises the database version
  so later upstream migrations with a lower version never run. Adjust the existing tests a fork change breaks; add a
  new test only where nothing else guards the fork behaviour.

## Postponed

Do not start these without the owner. "Content first, then the update and release process."

- Release and update process: own update feed, a release flag instead of `IS_CODESIGN_BUILD`, a GPG key for update
  signatures, a stable self-signed macOS identity, version suffix in Settings, release builds in CI, hosting. Until then the
  auto-updater is off and every build is a non-codesign build: app name `Suite Dark Dev` (window title, menu, THP
  pairing; product and bundle name stay `Suite Dark`), app id `io.suitedark.app.dev`, profile `suitedark-desktop-dev`,
  DevTools enabled, and upstream development endpoints wherever upstream switches on `isCodesignBuild()` (for example
  the `develop` channel of token definitions and the Suite Sync relay `suite-sync-dev.suite.sldev.cz`). The bundled
  message-system config is signed with the development key, which only a non-codesign build accepts.
- Features of the old fork, each a separate decision: password manager on Suite Sync (with a Dropbox import and a
  relay choice), verified contacts, installing Firmware Dark from Settings, the password-autofill browser extension.
  Dropped: WARD, NIP-17 chat, linky, satellites, connection requests, AuthLabel, appSecrets.
- Further coinjoin defences (2026-11-20): a spot check of other participants' inputs against Blockbook (new metadata
  for SatoshiLabs, little gain), polling the coordinator status under its own Tor identity with `RoundCheckpoints`,
  and a mining fee cap that does not come from the coordinator's data.

## Known gaps

Not handled yet; fixing any of them is a fork change for the owner to approve.

- `trezorsuite://` links never reach Suite Dark (`suite-app/desktop-app/uriSchemes.json` registers `suitedark`
  instead): `hid-bridge` (Model One fund-recovery page), `bridge-requested-by-a-3rd-party`, `walletconnect` and
  `anchor-` open Trezor Suite if it is installed. The upstream `hid-bridge` check in `custom-protocols.ts` cannot fire.
- Coin URI schemes (`bitcoin:` …) are claimed by both Suite Dark and Trezor Suite on every start.
- Defaults apply to fresh profiles and stay reversible: Debug settings can switch the message system to remote
  (saved; data.trezor.io is fetched again), and the `--enable-updater` switch turns the updater on against Trezor's
  feed `data.trezor.io/suite/releases/desktop/latest`, which is also the electron-builder `publish.url`.
- Refer-a-Friend turns on with debug mode alone: upstream removed its own flag on 2026-11-24 and plans to roll it out
  to everyone. With debug mode on, the sidebar shows it, and its page sends `GET v1/program` to SatoshiLabs'
  development server `dev.trezorio.sldev.cz`, the default for builds that are not codesigned (all Suite Dark builds).
  When upstream drops the debug-mode condition, the fork needs its own switch.
- Token definitions are still fetched from `data.trezor.io/suite/definitions`.
- Containerised Linux autostart (`process.env.container`) still runs `flatpak run io.trezor.suite`.
- Trading is hidden, not removed. Its return links stay upstream's `trezorsuite://{buy,sell,exchange}-redirect`
  and http-receiver keeps its trading routes, unused while trading is hidden; the debug-only account tab Trade
  (`wallet-trade`) opens an empty page, and the Debug settings keep the trade API server select. Some texts still
  mention buying or swapping (Activate assets modal, network reserve, staking hints, the bundled release notes).
- The Earn yield API types (`suite-common/earn-stablecoin-defs`) carry KYC fields that nothing reads yet; an upstream
  Earn KYC step would need hiding.
- The coinjoin defences have run against kruw in one successful round on the staging build (2026-11-25) and
  otherwise only in unit tests. If rounds are skipped, the coinjoin log says why (`Skipping round`, a round id that
  does not match its parameters, a min input count below 21, refused ownership proofs).
- OpenCoordinator was only checked through its status on 2026-11-22 and has not mixed with Suite Dark, and changing
  the coordinator in the Coinjoin setup (`CoinjoinService.replaceClient`) has not run in the desktop app yet.
- Pay in coinjoin has run end to end only on regtest with the Firmware Dark emulator (2026-11-25), not with kruw, on
  mainnet or on a real Model T yet, and the history shows no line for a payment.

## Working here

- Branches (owner's decision): `develop` is an exact mirror of upstream `develop`, locally and on `origin`; it only
  ever moves by fast-forward and never gets a fork commit. `main` carries the fork series, is the stable branch and the default branch on
  GitHub; work happens on `feature/<name>` branches and reaches `staging` through pull requests (see Development
  branches). `gh-pages` holds the website (see below). Never use GitHub's "Sync fork" button on `main`: it would merge
  upstream into the series.
- Remotes: `upstream` is `trezor/trezor-suite` (fetches `develop` only, push disabled), `origin` is
  `mroz22/trezor-suite-dark` (all its branches: `+refs/heads/*:refs/remotes/origin/*`).
- Fresh clone: `git clone -b main git@github.com:mroz22/trezor-suite-dark.git`,
  `git remote add -t develop upstream https://github.com/trezor/trezor-suite.git`,
  `git remote set-url --push upstream DISABLED`, `git fetch upstream`, `git branch develop origin/develop`, then the
  README steps from `git submodule update --init --recursive`. Git LFS objects are upstream's and the fork changes
  none; the fork serves them too, so `git lfs pull` works from either remote.
- Nx affected commands, `yarn format` and `yarn format:verify` compare against `origin/develop`, the mirror, so they
  cover exactly the fork's changes as long as `origin/develop` equals the local `develop`. Affected runs over the
  whole fork are impractical (see Checks); use `--base=<commit before your change>` for one change.
- CI: on `main` and every branch made from it, `.github/workflows/suite-dark-check.yml` is the only workflow; the
  upstream ones are deleted. It runs on every push to any branch except `develop` and `gh-pages`, so CI needs no
  pull request. It fails if another workflow file exists or if one of its
  pinned action SHAs is no longer pinned anywhere upstream (then take upstream's current pin). Then it runs a
  hardened `yarn --immutable` install (the lockfile check); ESLint with all rules, Stylelint, type-check and unit
  tests of the packages with changed files plus `@trezor/suite` and `@suite-app/app`, against the merge base with
  upstream `develop`; formatting of the fork's files; the message-system config validation, the translation checks
  and the React Compiler check. A changed shared root file (`yarn.lock`, `.yarnrc.yml`, `nx.json`, root configs,
  `patches/`, root `package.json` beyond its description) only raises a warning; run affected checks locally then.
  CI uses no Nx Cloud (`NX_NO_CLOUD`) and no SafeDep telemetry, has a read-only `GITHUB_TOKEN` (`contents: read`)
  and fetches Git LFS objects only for `@trezor/network-cardano` tests; keep LFS out where possible, its bandwidth is
  limited. GitHub-hosted runners are free for this public repository; add no self-hosted runner, because a pull
  request from any fork could run code on it. `develop` keeps upstream's workflows: its pushes start upstream runs
  whose jobs skip on upstream's repository checks. Never open a pull request against `develop`.
  Upstream gates CI leaves out still apply to package, dependency and shared-code changes; run them locally:
  `yarn verify-project-references`, `yarn depcheck`, `yarn dedupe --check`, `yarn check-workspace-resolutions`,
  `yarn build:libs:verify`, `scripts/circular-dependencies/check-circular-dependencies.sh`,
  `scripts/ci/list-missing-dependencies.sh`, `yarn test:unit:native` for shared code, and one
  `yarn requirements:verify --only=<name>` per requirement except `connect-workflow-paths` (plain
  `yarn requirements:verify` stops there, it reads deleted workflows; the names are in
  `packages/requirements/src/requirements`). The repository's Actions settings are the owner's.
- New fork change: check "Decisions already taken" first, split it as in Upstream first and build it on a feature
  branch (see Development branches). The matching documentation (Decisions, Known gaps, README intro when the
  user-visible feature list changes) is a docs `fixup!` on that branch.
- Sync with upstream: the steps are in [suite-dark-sync](skills/suite-dark-sync/SKILL.md), with the list of patterns
  the audit looks for. `develop` only fast-forwards (see Branches). Resolve each conflict in the fork commit where the
  rebase stops. Most stops are in `flavour: remove the upstream workflows`, whenever upstream edited a workflow.
  There, delete every upstream workflow in one go, the conflicted and the newly added ones (the fork's own file does
  not exist yet at that point):
  `find .github/workflows -maxdepth 1 -type f ! -name 'suite-dark-*' -print0 | xargs -0 git rm -q`, then
  `GIT_EDITOR=true git rebase --continue`. Never keep upstream's file. If the rebase did not stop there but that
  `find` lists files afterwards, fold their removal into that commit with a `fixup!` on the candidate and autosquash.
  Every sync audits the upstream delta for new traffic to Trezor servers, telemetry, feedback forms, banners and
  trading entry points. Neutralise each new surface inside the fork commit that owns its area, or list it on the
  website. Run the checks, update this file if a fork commit changed, and ask before the push.
- Checks: CI runs them (see CI), but run them locally before asking to push. A change only to the docs commit's
  files (`SUITE_DARK.md AGENTS.md README.md skills/suite-dark-* .claude/skills`) needs prettier on the changed `.md`
  files, and for a changed script `bash -n` plus one run; CI covers the rest. Throttle the code checks, because a
  full parallel run stalls the machine and every other session. `$P` holds the package names behind
  `git diff --name-only develop..HEAD` plus `@trezor/suite` and `@suite-app/app`, because a changed default can break
  tests far from the edited file:
  `NX_NO_CLOUD=true ESLINT_RULE_SET=all nice -n 10 yarn nx run-many --targets=lint:js,lint:styles,type-check --projects=$P --parallel=1`,
  then the same with `--targets=test:unit` and `-- --maxWorkers=2` for Jest. Pass `--no-tui` or `--output-style`,
  never both: Nx rejects the pair. This covers less than CI, which also runs the hardened install, formatting, the
  translation checks, the message-system config validation and the React Compiler check: when a sync or a
  promotion cannot use CI, run those from `suite-dark-check.yml` too or report them as not run. Affected runs with
  `NX_BASE=develop` are impractical: the fork changes widely shared inputs (`@trezor/theme`, `@trezor/utxo-lib`,
  `yarn.lock`), so they select most projects. Tests that import the Guide need its
  generated content; build it once with `yarn workspace @suite/app-assets build:lib` (also part of
  `yarn build:essential`). A jest worker crash (`SIGSEGV`) or a timeout under load counts as a failure only if the test
  file also fails when rerun alone. A workspace without `node_modules` needs nothing for git-only work; for formatting
  it may borrow prettier from the owner's checkout when `yarn.lock` is equal
  (`~/repos/trezor-suite-dark/node_modules/.bin/prettier --stdin-filepath <file> < <file> | diff - <file>`); tests
  need a full `yarn --immutable`, run with `/bin` ahead of coreutils' `gnubin` in `PATH` (GNU `cp` breaks the
  install). Heavy checks can run on CI instead: push the candidate to a throwaway `ci/<op>-<branch>` branch (`/` in
  the branch name becomes `-`, e.g. `ci/sync-staging`) and delete it when CI has finished (standing permission, see
  `AGENTS.md`).
  Check runtime behaviour in `yarn suite:dev:desktop` (profile `suitedark-desktop-local`, on macOS in
  `~/Library/Application Support/`; move it aside to test fresh-profile defaults). For privacy changes, confirm in the
  renderer DevTools Network tab that the request is gone; main-process requests do not show there. Record what you
  checked in the commit body.
- Tests that encode fork behaviour: `suite-common/message-system/src/messageSystemActions.test.ts` sets
  `configSource: 'remote'`; `packages/suite/src/middlewares/onboarding/onboardingMiddleware.test.ts` keeps analytics
  unconfirmed; `suite/coinjoin/src/config.test.ts` expects the btc list kruw then OpenCoordinator, both with no
  coordinator fee and no backend;
  `packages/suite/mocks/mockInitialAppState.ts` keeps the light theme for upstream tests;
  `suite-common/assets/src/homeAssetTableFeedbackThunks.test.ts` expects that nothing is sent. The two device-connect
  eShop tests in `suite/flags/src/flagsSlice.test.ts` now pass trivially. `suite/regions/src/regionsSelectors.test.ts`
  expects every language to be restricted; the upstream tests of trading UI (`Navigation.test.tsx`,
  `TradingRouteGuard.test.tsx`, `TradingFormEmbed.test.tsx`, `AssetDetailActions.test.tsx`, `TokensTable.test.tsx`)
  mock `IS_TRADING_HIDDEN` to `false`.
- A test fails in a package you did not edit: check the known failures below, then run it on `develop`. If it fails
  there too, it is upstream's. If not, adapt the test or shared mock inside the fork commit that changed the
  behaviour and add it to the list above.
- Known failures that are not the fork's: `clearAppData › removes user data directory` in
  `suite-app/desktop-app-main/src/libs/user-data.test.ts` on macOS (no `setLoginItemSettings` mock), and the T3W1
  case of `DashboardPromoBanner.test.tsx`, which can time out when the machine is busy.
- Upstream e2e tests are not adjusted to the fork and are not run (for example the Guide feedback, bug-report form
  and analytics event tests).
- Translations: a new string goes to `suite/intl/src/messages.ts` only; its `defaultMessage` is shown. The app reads
  English from the bundled `suite/intl/translations/en-US.json`, which overrides `defaultMessage`, so changing an
  existing English string means editing both files. A removed string leaves `messages.ts` only. Leave all other locale
  files alone; translation syncs would conflict. CI gates: `translations:list-unused`, `translations:list-duplicates`.
- Pull requests: work reaches `staging` through a pull request from its feature branch (see Development branches),
  opened when the owner asks to put the work into `staging`, against `staging` of `mroz22/trezor-suite-dark`, its
  description opening with the agent prefix `AGENTS.md` requires. Only the owner merges it, with "Rebase and merge".
  Do not reference `trezor/trezor-suite` issues, pull requests or people in it (GitHub shows such references upstream).
- Desktop packages are built only when the owner asks: follow upstream's `build-desktop-apps.yml` (`git show develop:.github/workflows/build-desktop-apps.yml`) for one
  platform (on macOS one electron-builder run per arch); output goes to `suite-app/desktop-app/build-electron/`. Never
  publish, tag, upload or change the version.
- macOS icon: macOS 26 and later take the Dock icon from `suite-app/desktop-app/mac-icon/Assets.car`, compiled from
  `Icon.icon`. Its `Assets/lock.png` layer carries the whole tile, so recolour that layer and the `icon.json` fill
  together, then compile with Xcode 26 or later:
  `xcrun actool Icon.icon --compile <out> --app-icon Icon --include-all-app-icons --platform macosx --target-device mac --minimum-deployment-target 26.0 --output-partial-info-plist <out>/partial.plist`.
  Without a local Xcode, a temporary private repo with a `macos-26` GitHub Actions runner works; the current file
  came from Xcode 26.6 there. Older macOS versions use `suite/app-assets/files/images/desktop/512x512.icns`.
- Website: https://mroz22.github.io/trezor-suite-dark/, served by GitHub Pages (legacy branch build, works with
  Actions disabled) from the orphan branch `gh-pages`: `index.html`, `style.css`, two icons, `.nojekyll`. Edit it in a
  worktree (`git worktree add ../suite-dark-pages gh-pages`) after `git fetch origin gh-pages:gh-pages`, commit there
  and push with the owner's permission. It loads nothing from other hosts; keep it that way (no fonts, scripts or
  analytics). It describes `main`: its feature, network and commit descriptions must match this file and the fork
  commits as they are on `main`. A promotion or sync that changes what `main` users see or what the app sends proposes
  the matching website change to the owner. Its build steps are host-native only: Yarn installs native modules for
  the build machine.
- Skills: the fork's workflows are `skills/suite-dark-*/` with their `.claude/skills` symlinks, part of the docs
  commit (change them with a docs `fixup!`) and listed in `AGENTS.md`. A new one also needs a directory symlink for
  Claude Code, which `.gitignore` hides: `ln -s ../../skills/suite-dark-x .claude/skills/`, then
  `git add -f .claude/skills/suite-dark-x`; check with `git ls-files .claude/skills`.
- Setup and checks otherwise follow `AGENTS.md`.

## History and the old fork

The first Suite Dark (August to October 2026) was anonymous, Bitcoin-only and carried many experimental features.
It lived on the GitHub account `suite-dark` and later on self-hosted infrastructure under `suite-dark.com`. All of
that is gone: the GitHub account is disabled and the server was reassigned, so do not trust any `suite-dark.com`
host. The project restarted on 2026-11-17 from a fresh upstream `develop`; anonymity no longer applies.

The old code is reference material. Port it only commit by commit with the owner's approval, as a
`flavour: …` commit under the owner's current git identity, without `suite-dark.com` hosts, old `suite-dark`
GitHub references or Bitcoin-only restrictions. It lives in a local, unpublished clone on the owner's machine
(`~/repos/suite-dark-fork`), reachable from the owner's checkout as the fetch-only remote `sdref`. Its refspecs map
that clone's `origin/*` to `sdref-origin/*`, its branches to `sdref/*` and one tag to `sdref-tags/*`;
`git fetch sdref` refreshes them:

- `sdref-origin/main`: the last published state, one squash commit plus five follow-ups (version display, release CI,
  fixes) on upstream `5699c96a94`.
- `sdref-tags/pre-rebase-backup-2026-09-14`: 133 granular commits on upstream `3aef9dba82f`.
- `sdref/sd-main`: ten atomic flavour commits plus a distribution commit (branding assets, CI, website) on upstream
  `860f96c00f`.

Companion projects of the old fork, also local only: `firmware-dark` (unofficial Bitcoin-only firmware),
`suite-extension-dark` (password autofill extension) and `relay-dark` (Evolu relay). Only the pay in coinjoin branch of
`firmware-dark`, `feat/coinjoin-payment`, is published: since 2026-11-25 in the fork `mroz22/trezor-firmware`, where it
is built from.
