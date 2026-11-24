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

Commit SHAs change on every rebase, so refer to fork commits by subject, not by SHA.

### Fork commits

| Commit subject (`flavour: …`)                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| document the fork for contributors and agents             | This file, the Suite Dark section at the top of `AGENTS.md` and the Suite Dark intro of `README.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| remove the upstream workflows                             | Deletes every upstream workflow in `.github/workflows/` (list them with `git diff --diff-filter=D --name-only develop..main -- .github/workflows`). They need upstream secrets, runners and repository checks; on the fork several fail or run daily crons. `.github/actions/` stays for the fork's own workflow. `develop` keeps them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| check the fork on every push                              | `.github/workflows/suite-dark-check.yml`, see CI under Working here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| brand the desktop app as Suite Dark                       | Release app id `io.suitedark.app` and profile directory `suitedark-desktop` (current builds add `.dev`/`-dev`, see Postponed), product name `Suite Dark`, installer names `SuiteDark-…`, Linux executable `suitedark`, app name `Suite Dark` (`APP_NAME_BARE` in the tray; `APP_NAME` in menu, window title and THP pairing name adds ` Dev`/` Local` outside codesign builds), `suitedark://` URI scheme replacing `trezorsuite://` (OAuth "Go back" link), Linux autostart file `Suite-Dark.desktop`, Bitcoin-orange palette overlay (`packages/theme/src/palette.suite-dark.ts`), orange app icons and macOS tray icon.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| stop reporting anything to Trezor servers                 | Sentry DSN empty; analytics off and the consent screen skipped (`enabled: false, confirmed: true`); the desktop analytics service never reports, including upstream `force` events; Analytics row removed from Settings > General; message system defaults to the config bundled at build time (`configSource: 'local'`, see Known gaps); `DESKTOP_AUTO_UPDATER: false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| start with Tor and discreet mode on                       | Defaults for fresh profiles. Tor is switchable in Settings > General, discreet mode with the sidebar "Hide balances" button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| remove promotional banners                                | Dashboard promo carousel (both home layouts), onboarding survey banner, dashboard footer (app store badges, desktop app button, Refer-a-Friend), Trezor shop banners (`areNoDeviceEshopBannersDisabled` defaults to `true` for fresh profiles).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| mix through the kruw.io coinjoin coordinator              | The btc coordinator list in `suite/coinjoin/src/config.ts`: `https://coinjoin.kruw.io/wabisabi/` first, so the default, and `https://api.opencoordinator.org/wabisabi/` (OpenCoordinator, checked over Tor on 2026-11-22: default identifier, no fee, at least 21 inputs, Taproot), which the user can choose in the coinjoin settings. Upstream lists none since the public coordinators shut down; testnet still has none. No `wabisabiBackendUrl` for either: kruw runs no WalletWasabi backend, so the coordinator version falls back to the client's stub values, and OpenCoordinator's backend would make Suite ask again for the zkSNACKs legal documents. `maxCoordinatorFeeRate: 0` for both: they charge no coordinator fee, so a session authorizes none and a round with a fee is skipped (upstream-bound commits cap it at 0.1 % for any coordinator). Hides the bundled "Coinjoin was discontinued" message `dbfce56e-6b9b-4f88-8acc-38b9bc5dabeb` through `SUITE_DARK_HIDDEN_MESSAGE_IDS` in `packages/suite/src/middlewares/suite/messageSystemMiddleware.ts`, for every config source. |
| call the experimental password manager "Password manager" | English titles of the experimental feature and its page; the feature stays experimental with no menu item. Upstream does not save the experimental toggle (`packages/suite/src/actions/suite/storageActions.ts`), so it is off after every restart.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| default to the dark theme                                 | Fresh profiles: renderer `theme.variant: 'dark'` with `autodetect.theme: false` (does not follow the OS), main-process `themeSettings` default `'dark'`; light and system stay selectable. `packages/suite/mocks/mockInitialAppState.ts` keeps upstream tests on light.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| keep the local development profile separate               | `yarn suite:dev:desktop` uses `suitedark-desktop-local` instead of upstream's `@trezor/suite-desktop-local`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| remove user feedback forms                                | Nothing is sent to `data.trezor.io/suite/{feedback,bugs}`. `@suite/feature-feedback` exports a `FeedbackCard` and `FeedbackFormManager` that render nothing and a sidebar-banner selector that returns `false` (Earn, trading and feature ratings, also future upstream cards built on them). The Guide "Help us improve" entries are removed (their strings from `messages.ts` only; locale files keep the keys). The home asset table rating card is not rendered. `sendFeedbackThunk` rejects without a request and shows the send-error toast, so a new upstream form that calls it directly still shows and fails; hide its entry point in this commit. Support and forum links stay.                                                                                                                                                                                                                                                                                                                                                                                                              |
| hide trading                                              | Buy, Sell, Swap and Concierge are hidden, with their KYC steps. `selectIsRegionRestricted` (`suite/regions/src/regionsSelectors.ts`) always returns true through `IS_TRADING_HIDDEN` in `trading.suite-dark.ts`. Every desktop trading entry point reads it (sidebar Swap, Buy/Sell in page headers, account trade box, token rows, empty states, Earn Buy buttons, Alt+B/C/X), and `TradingRouteGuard` shows "Trading is not available in Suite Dark." (English only) on every `wallet-trading-*` page. The dashboard catalog request stops with it. The Guide drops its Buy, Sell & Swap category, Settings its SLIP-24 toggle. Upstream trading UI tests mock `IS_TRADING_HIDDEN` to `false`.                                                                                                                                                                                                                                                                                                                                                                                                        |

## Upstream first

The owner's plan for the project (2026-11-20): Suite Dark is where features land that upstream Trezor Suite has no
time or energy for. Each one is built here until it is finished and works, then shown to the upstream team to
convince them to take it. Whatever a feature needs that upstream could take on its own, above all refactoring, goes
upstream separately and as early as possible. That keeps the fork small and the feature's final upstream pull
request small. Fixes and hardening of upstream code go upstream first, before refactors and features. Commits are
therefore split by where they are going:

| Kind              | Subject                                   | Last line of the message | Goes upstream                                                          |
| ----------------- | ----------------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| Upstream fix      | upstream style, e.g. `fix(coinjoin): …`   | `Upstream: fix`          | first, as soon as it is finished and tested in the fork, as its own PR |
| Upstream refactor | upstream style, e.g. `refactor(suite): …` | `Upstream: refactor`     | as soon as possible, as its own PR                                     |
| Upstream feature  | upstream style, e.g. `feat(coinjoin): …`  | `Upstream: feature`      | once it is finished and works in the fork                              |
| Flavour           | `flavour: …`                              | none                     | never                                                                  |

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
- Order on `main`: the docs commit, upstream fixes, upstream refactors, upstream features, the other flavour
  commits; an upstream-bound commit that another one needs goes before it.
- `Upstream: fix`, `Upstream: refactor` or `Upstream: feature` is a git trailer, alone in the last paragraph of the
  message. List the commits with `git log --oneline --grep '^Upstream:' develop..main`. Do not put upstream issue or
  pull request numbers in fork commit messages (GitHub shows such references upstream); track them in the table
  below. Refer to pull requests of other projects without `#` (`WalletWasabi PR 13658`), GitHub would link them.
- Sending one upstream: the owner decides when, and only the owner's request for that specific pull request allows
  pushing to `trezor/trezor-suite` or opening it. Prepare it on a branch from upstream `develop` with the commit
  cherry-picked and the `Upstream:` trailer removed, then follow upstream's own `AGENTS.md`. When upstream merges
  it, the next sync drops the fork commit, by itself if the content is identical, otherwise drop it by hand and
  resolve the later commits. If upstream declines a fix or a feature, it becomes a flavour commit
  (`flavour: …`, no trailer).

Upstream-bound commits on `main`, with subject, kind, upstream pull request and status. The two WalletConnect commits
(2026-11-21, Privacy accounts stay out of WalletConnect) were opened upstream together as one pull request. The chain
ID fix (2026-11-22) answers a review on that pull request and went into it as a third commit; it goes before the other
two in the series, because the switch-account preselection of the first one needs it. The
coinjoin commits (2026-11-21, defences of the client against a malicious coordinator) are a stack: each applies to
plain `develop` together with the coinjoin commits listed above it, so offer them upstream in this order. The
trading catalog fix (2026-11-21) stops the Tokens tab and the asset detail header from loading the trading catalog
from `exchange.trezor.io` where `selectIsRegionRestricted` hides trading, as the dashboard already does; Suite Dark
needs it for "hide trading". The coordinator list (2026-11-21: the Status fix, the selector refactor and the feature)
builds on the coinjoin commits, so offer it after them, in this order. The read-only recommended settings
(2026-11-23) build on the coordinator list. The range slider fix (2026-11-24) stands alone: the coinjoin setup
sliders painted over the sticky account tabs when the page scrolled. The Status fix went upstream alone on
2026-11-23, on plain `develop` and with only its own test; when upstream merges it, drop the fork commit by hand,
because its test in the fork sits next to the round id test of an earlier coinjoin commit.

| Subject                                                                     | Kind     | Upstream PR                                                | Status      |
| --------------------------------------------------------------------------- | -------- | ---------------------------------------------------------- | ----------- |
| `fix(walletconnect): match Ethereum session chains by chain ID`             | fix      | [35337](https://github.com/trezor/trezor-suite/pull/35337) | open        |
| `fix(walletconnect): keep coinjoin accounts out of WalletConnect sessions`  | fix      | [35337](https://github.com/trezor/trezor-suite/pull/35337) | open        |
| `fix(suite): hide the WalletConnect menu item on coinjoin accounts`         | fix      | [35337](https://github.com/trezor/trezor-suite/pull/35337) | open        |
| `fix(coinjoin): cap the authorized coordinator fee at 0.1%`                 | fix      | none                                                       | not offered |
| `fix(coinjoin): skip rounds and refuse coinjoins with too few inputs`       | fix      | none                                                       | not offered |
| `fix(coinjoin): apply fee and parameter limits to blame rounds`             | fix      | none                                                       | not offered |
| `fix(coinjoin): verify own inputs and outputs before signing`               | fix      | none                                                       | not offered |
| `refactor(utxo-lib): export BIP340 Schnorr signature verification`          | refactor | none                                                       | not offered |
| `fix(coinjoin): verify other participants' ownership proofs`                | fix      | none                                                       | not offered |
| `fix(coinjoin): check blame round inputs against the failed round`          | fix      | none                                                       | not offered |
| `fix(coinjoin): verify round id against round parameters`                   | fix      | none                                                       | not offered |
| `fix(coinjoin): stop mixing when the coordinator lies`                      | fix      | none                                                       | not offered |
| `fix(coinjoin): never reuse output scripts after a failed round`            | fix      | none                                                       | not offered |
| `fix(coinjoin): keep change of regular sends off burned coinjoin addresses` | fix      | none                                                       | not offered |
| `fix(suite): skip the trading catalog request in restricted regions`        | fix      | none                                                       | not offered |
| `fix(components): keep the range slider beneath sticky bars`                | fix      | none                                                       | not offered |
| `fix(coinjoin): end rounds that disappear from the status`                  | fix      | [35387](https://github.com/trezor/trezor-suite/pull/35387) | open        |
| `refactor(coinjoin): read the client settings through one selector`         | refactor | none                                                       | not offered |
| `feat(coinjoin): choose the coinjoin coordinator from a list`               | feature  | none                                                       | not offered |
| `feat(coinjoin): show the recommended coinjoin settings read-only`          | feature  | none                                                       | not offered |

## Development branches

`main` is the stable branch: the owner's friends use it and releases will come from it. New work reaches it only
after it has been in daily use on a development branch, and only when the owner promotes it.

- Each developer has a personal development branch `<github-login>/next`; the owner's is `mroz22/next`. It usually
  carries several features at once. The developer builds the desktop app from it and uses that build every day, which
  is the main test of the work; CI checks every push. Short-lived topic branches `<github-login>/<topic>` work the
  same way.
- A development branch is `main` plus commits on top, never a rewritten copy of the series. Then
  `git log --oneline main..<branch>` is exactly the pending work, and moving to a new `main` takes one command.
    - New work: commits as they should land on `main`, split as in Upstream first, each feature in its own commits so
      it can be promoted alone. Upstream-bound commits sit on top like the rest; promotion moves them to their place in
      the series.
    - Changes to a commit that is already on `main`, this file included: a `fixup!` commit for it,
      `git commit --fixup=<that commit on main>`. When its message changes too, make an `amend!` commit instead:
      the subject `amend! <subject of that commit>`, a blank line, then the whole new message, written with
      `git commit -F` (`--fixup=amend:` needs an editor). Promotion folds it in. Autosquash finds the target by its
      subject: a `fixup!` or `amend!` that names an old subject stays unfolded without an error, so rename pending
      ones when a target is renamed.
- After `main` moves (a sync or a promotion), rebase every development branch onto it:
  `git rebase --onto main "$(git merge-base --fork-point main <branch>)" <branch>`. `--fork-point` finds the old
  `main` the branch was built on in the reflog of `main` (in a clone that only fetches, use `origin/main`). Commits
  that `main` now contains become empty and are dropped, so only the unpromoted work stays. Push the rebased branch
  with `--force-with-lease`.
- Promotion, of the commits the owner picks: rebuild `main` in the series order with them in place. On a detached
  `develop`, cherry-pick the docs commit, the upstream-bound commits (those on `main`, then the promoted ones), the
  other flavour commits (likewise) and the promoted `fixup!` and `amend!` commits, then fold them with
  `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash develop` (plain `git rebase --autosquash` folds nothing before
  Git 2.44). `git log --oneline -E --grep='^(fixup|amend|squash)! ' develop..HEAD` must be empty, and
  `git range-diff develop..main develop..HEAD` must show only the promoted changes. Move `main` there, push with the
  owner's permission, then rebase the development branches.

## Decisions already taken

Ask the owner before reversing any of these.

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
  its transaction id, and removing that breaks voting. The website lists this traffic; keep both in sync.
- Kept on purpose: the backend User-Agent `Trezor Suite <version>` (blends in with Trezor Suite users) and the
  SatoshiLabs copyright and author. `process.env.VERSION` has no suffix, because it is sent in the backend User-Agent.
- Coinjoin: upstream Privacy accounts plus the kruw.io default coordinator (tested by the owner), with the
  client-side defences against a malicious coordinator listed under Upstream first (2026-11-21): a coordinator fee
  cap of 0.1 % for any coordinator and none for the listed ones (kruw and OpenCoordinator), at least 21 inputs on
  mainnet (2 on test networks), no solo
  coinjoins, checks of the round id, of the ownership proofs and inputs of other participants, of own inputs and
  outputs and of blame rounds, output scripts never reused after a failed round except in its blame rounds, outputs
  only on change addresses up to the last used one plus 20 (the discovery lookout of 50 stays), and mixing stops
  with an error message when the coordinator provably lies. Coordinators older than WalletWasabi 2.3.0 lose their
  blame rounds.
  Users choose the coordinator from the list in the build, in a Privacy account's Coinjoin setup, one choice per
  network for all its Privacy accounts, and the choice is kept
  (2026-11-21). The Coinjoin setup always shows its settings, the coordinator included: Recommended shows the
  values a session uses, read-only, and keeps the network's coordinator choice; Custom makes them editable
  (2026-11-23). No automatic switch to another coordinator, no detection of a coordinator that stops responding
  while Suite runs (only the check when the client starts, the rest goes to the log) and no custom coordinator
  address for now. Which coordinators the list names is the owner's decision; OpenCoordinator was added on
  2026-11-22. Suite Dark contacts it only once the user chooses it.
- Password manager: upstream's Dropbox-based experimental feature, only renamed.
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
- Token definitions are still fetched from `data.trezor.io/suite/definitions`.
- Containerised Linux autostart (`process.env.container`) still runs `flatpak run io.trezor.suite`.
- Trading is hidden, not removed. Its return links stay upstream's `trezorsuite://{buy,sell,exchange}-redirect`
  and http-receiver keeps its trading routes, unused while trading is hidden; the debug-only account tab Trade
  (`wallet-trade`) opens an empty page, and the Debug settings keep the trade API server select. Some texts still
  mention buying or swapping (Activate assets modal, network reserve, staking hints, the bundled release notes).
- The Earn yield API types (`suite-common/earn-stablecoin-defs`) carry KYC fields that nothing reads yet; an upstream
  Earn KYC step would need hiding.
- The coinjoin defences are covered by unit tests only and have not run against kruw yet. In the first session,
  watch the coinjoin log for skipped rounds (`Skipping round`, a round id that does not match its parameters, a min
  input count below 21) and for refused ownership proofs; any of them on every round means a check refuses kruw.
- OpenCoordinator was only checked through its status on 2026-11-22 and has not mixed with Suite Dark, and changing
  the coordinator in the Coinjoin setup (`CoinjoinService.replaceClient`) has not run in the desktop app yet.

## Working here

- Branches (owner's decision): `develop` is an exact mirror of upstream `develop`, locally and on `origin`; it only
  ever moves by fast-forward and never gets a fork commit. `main` carries the fork series, is the stable branch and the default branch on
  GitHub; work happens on development branches (see Development branches). `gh-pages` holds the website (see below). Never use GitHub's "Sync fork" button on `main`: it would merge
  upstream into the series.
- Remotes: `upstream` is `trezor/trezor-suite` (fetches `develop` only, push disabled), `origin` is
  `mroz22/trezor-suite-dark` (`main` and `develop`).
- Fresh clone: `git clone -b main git@github.com:mroz22/trezor-suite-dark.git`,
  `git remote add -t develop upstream https://github.com/trezor/trezor-suite.git`,
  `git remote set-url --push upstream DISABLED`, `git fetch upstream`, `git branch develop origin/develop`, then the
  README steps from `git submodule update --init --recursive`. Git LFS objects are upstream's and the fork changes
  none; the fork serves them too, so `git lfs pull` works from either remote.
- Nx affected commands, `yarn format` and `yarn format:verify` compare against `origin/develop`, the mirror, so they
  cover exactly the fork's changes as long as `origin/develop` equals the local `develop`; otherwise pass
  `NX_BASE=develop`. Use `--base=<commit before your change>` for one change.
- CI: on `main` and every branch made from it, `.github/workflows/suite-dark-check.yml` is the only workflow; the
  upstream ones are deleted. It runs on every push to any branch except `develop` and `gh-pages`, so pushing a
  feature branch is enough and no pull request is needed. It fails if another workflow file exists or if one of its
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
- New fork change: check "Decisions already taken" first, split it as in Upstream first and build it on a
  development branch (see Development branches). Promotion puts a `flavour: …` commit at the end of the
  series and an upstream-bound commit after the docs commit and before the first other flavour commit. The matching
  documentation (table row, the upstream list, Decisions, Known gaps, README intro when the user-visible feature
  list changes) goes into the docs commit, as a `fixup!` while the work is on a development branch. Later fixes go
  inside the owning commit.
- Fold a fix into fork commit `T` (agents cannot use interactive rebase):

    ```bash
    git branch backup/main-<date> main
    # commit the fix on top of main; call it F
    git checkout --detach T
    git cherry-pick --no-commit F && git commit --amend --no-edit
    git cherry-pick T..F~1          # the later fork commits, without F (skip if T is the last one)
    git branch -f main HEAD && git checkout main
    git diff F main                 # must be empty
    ```

    Keep the backup branch until the owner has seen the result.

- Sync with upstream: `git branch backup/main-<date> main`, `git fetch upstream develop:develop` (fast-forward only),
  `git rebase develop main`, and resolve each conflict in the fork commit where the rebase stops. Most stops are in
  `flavour: remove the upstream workflows`, whenever upstream edited a workflow. There, delete every upstream
  workflow in one go, the conflicted and the newly added ones (the fork's own file does not exist yet at that point):
  `find .github/workflows -maxdepth 1 -type f ! -name 'suite-dark-*' -print0 | xargs -0 git rm -q`, then
  `GIT_EDITOR=true git rebase --continue`. Never keep upstream's file. If the rebase did not stop there but that
  `find` lists files afterwards, fold their removal into that commit with the recipe above. Then
  `git submodule update --init --recursive`, `git lfs pull upstream` and `yarn`. Audit the upstream delta
  (`git diff <old develop>..develop`) for `data.trezor.io`, `services.trezor.io`, `cdn.trezor.io`, `sentry`,
  `analytics`, `FeedbackCard`, `sendFeedbackThunk`, `Banner`, `configSource`, `isCodesignBuild`, `wallet-trading` and
  `loadInitialDataThunk` (a trading entry point or catalog request must read `selectIsRegionRestricted`); after a
  `GITBOOK_REVISION` bump, check that the Guide category `/4_buy-sell-and-exchange`, which `guideReducer.ts` drops,
  still has that id. Neutralise each new surface inside the fork commit that owns its area, or list it on the
  website. Run the checks, update this file if a fork commit changed, and ask before pushing both in one command:
  `git push --force-with-lease=main:<old origin/main> origin develop main` (`develop` only fast-forwards).
- Checks: CI runs them (see CI), but run them locally before asking to push:
  `NX_NO_CLOUD=true ESLINT_RULE_SET=all yarn nx run-many --targets=lint:js,type-check,test:unit --projects=<names> --no-tui`
  with the package names behind `git diff --name-only develop..main`. Affected runs with `NX_BASE=develop` are impractical: the fork changes
  `@trezor/theme` and `@trezor/urls`, so they select about 260 projects. A changed default can break tests far from
  the edited file, so include `@trezor/suite` and `@suite-app/app`. A jest worker crash (`SIGSEGV`) under load is not
  a failure; rerun that test file alone. Tests that import the Guide
  need its generated content: `yarn workspace @suite/app-assets build:lib` (also part of `yarn build:essential`).
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
- Pull requests: fork changes land as commits on `main`. Open a pull request only when the owner asks, against `main`
  of `mroz22/trezor-suite-dark`, and never merge it on GitHub (a merge or squash breaks the series). Do not reference
  `trezor/trezor-suite` issues, pull requests or people in it (GitHub shows such references upstream).
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
  worktree (`git worktree add ../suite-dark-pages gh-pages`), commit there and push with the owner's permission. It
  loads nothing from other hosts; keep it that way (no fonts, scripts or analytics). Its feature and network lists
  must match this file and the fork commits; update it when a fork change alters what users see or what the app
  sends. Its build steps are host-native only: Yarn installs native modules for the build machine.
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
`suite-extension-dark` (password autofill extension) and `relay-dark` (Evolu relay).
