# Suite Dark

Suite Dark is a desktop-only, privacy-first fork of [Trezor Suite](https://github.com/trezor/trezor-suite),
maintained by [mroz22](https://github.com/mroz22) in [mroz22/trezor-suite-dark](https://github.com/mroz22/trezor-suite-dark).
It is an acknowledged fork; the Trezor Suite authors allowed its distribution. It is not a SatoshiLabs product.

This file is the project's memory. Read it before working here, keep it current when a decision or a fork
commit changes, and do not repeat research it already answers. Notes outside this file (agent memory, the
git-excluded `.context/`) are not authoritative; move a decision here or drop it.

## How the fork is built

`develop` mirrors `trezor/trezor-suite` `develop`. `main` is `develop` plus a short, linear series of Suite Dark
commits, one self-contained change each: the documentation commit first, so the rules come before the changes,
then upstream-bound commits (see Upstream first), then the Suite Dark commits. The series is the whole difference
from upstream:

```bash
git log --oneline --reverse develop..main   # the fork commits
git diff develop..main --stat               # the complete list of files the fork adds or changes
git grep -n "Suite Dark"                    # fork comments and brand strings; deletions, icons and translations show only in the diff
```

Commit SHAs change on every rebase, so refer to fork commits by subject, not by SHA.

### Fork commits

| Commit subject (`feat(suite-dark): …` unless noted)               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs(suite-dark):` document the fork for contributors and agents | This file, the Suite Dark section at the top of `AGENTS.md` and the Suite Dark intro of `README.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ci(suite-dark):` remove the upstream workflows                   | Deletes every upstream workflow in `.github/workflows/` (list them with `git diff --diff-filter=D --name-only develop..main -- .github/workflows`). They need upstream secrets, runners and repository checks; on the fork several fail or run daily crons. `.github/actions/` stays for the fork's own workflow. `develop` keeps them.                                                                                                                                                                                                                                                                                                                                                                                         |
| `ci(suite-dark):` check the fork on every push                    | `.github/workflows/suite-dark-check.yml`, see CI under Working here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| brand the desktop app as Suite Dark                               | Release app id `io.suitedark.app` and profile directory `suitedark-desktop` (current builds add `.dev`/`-dev`, see Postponed), product name `Suite Dark`, installer names `SuiteDark-…`, Linux executable `suitedark`, app name `Suite Dark` (`APP_NAME_BARE` in the tray; `APP_NAME` in menu, window title and THP pairing name adds ` Dev`/` Local` outside codesign builds), `suitedark://` URI scheme replacing `trezorsuite://` (OAuth "Go back" link and trading return links, `packages/urls/src/deeplinks.ts`), Linux autostart file `Suite-Dark.desktop`, Bitcoin-orange palette overlay (`packages/theme/src/palette.suite-dark.ts`), orange app icons and macOS tray icon.                                           |
| stop reporting anything to Trezor servers                         | Sentry DSN empty; analytics off and the consent screen skipped (`enabled: false, confirmed: true`); the desktop analytics service never reports, including upstream `force` events; Analytics row removed from Settings > General; message system defaults to the config bundled at build time (`configSource: 'local'`, see Known gaps); `DESKTOP_AUTO_UPDATER: false`.                                                                                                                                                                                                                                                                                                                                                        |
| start with Tor and discreet mode on                               | Defaults for fresh profiles. Tor is switchable in Settings > General, discreet mode with the sidebar "Hide balances" button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| remove promotional banners                                        | Dashboard promo carousel (both home layouts), onboarding survey banner, dashboard footer (app store badges, desktop app button, Refer-a-Friend), Trezor shop banners (`areNoDeviceEshopBannersDisabled` defaults to `true` for fresh profiles).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| mix through the kruw.io coinjoin coordinator                      | Default mainnet coordinator `https://coinjoin.kruw.io/wabisabi/` in `suite/coinjoin/src/config.ts` (upstream ships none since the public coordinators shut down; testnet still has none). No `wabisabiBackendUrl`: kruw runs no WalletWasabi backend, so the coordinator version falls back to the client's stub values. Hides the bundled "Coinjoin was discontinued" message `dbfce56e-6b9b-4f88-8acc-38b9bc5dabeb` through `SUITE_DARK_HIDDEN_MESSAGE_IDS` in `packages/suite/src/middlewares/suite/messageSystemMiddleware.ts`, for every config source.                                                                                                                                                                    |
| call the experimental password manager "Password manager"         | English titles of the experimental feature and its page; the feature stays experimental with no menu item. Upstream does not save the experimental toggle (`packages/suite/src/actions/suite/storageActions.ts`), so it is off after every restart.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| default to the dark theme                                         | Fresh profiles: renderer `theme.variant: 'dark'` with `autodetect.theme: false` (does not follow the OS), main-process `themeSettings` default `'dark'`; light and system stay selectable. `packages/suite/mocks/mockInitialAppState.ts` keeps upstream tests on light.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| keep the local development profile separate                       | `yarn suite:dev:desktop` uses `suitedark-desktop-local` instead of upstream's `@trezor/suite-desktop-local`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| remove user feedback forms                                        | Nothing is sent to `data.trezor.io/suite/{feedback,bugs}`. `@suite/feature-feedback` exports a `FeedbackCard` and `FeedbackFormManager` that render nothing and a sidebar-banner selector that returns `false` (Earn, trading and feature ratings, also future upstream cards built on them). The Guide "Help us improve" entries are removed (their strings from `messages.ts` only; locale files keep the keys). The paid trading survey variant and the home asset table rating card are not rendered. `sendFeedbackThunk` rejects without a request and shows the send-error toast, so a new upstream form that calls it directly still shows and fails; hide its entry point in this commit. Support and forum links stay. |

## Upstream first

The owner's plan for the project (2026-11-20): Suite Dark is where features land that upstream Trezor Suite has no
time or energy for. Each one is built here until it is finished and works, then shown to the upstream team to
convince them to take it. Whatever a feature needs that upstream could take on its own, above all refactoring, goes
upstream separately and as early as possible. That keeps the fork small and the feature's final upstream pull
request small. Commits are therefore split by where they are going:

| Kind              | Subject                                                           | Last line of the message | Goes upstream                             |
| ----------------- | ----------------------------------------------------------------- | ------------------------ | ----------------------------------------- |
| Upstream refactor | upstream style, e.g. `refactor(suite): …`                         | `Upstream: refactor`     | as soon as possible, as its own PR        |
| Upstream feature  | upstream style, e.g. `feat(coinjoin): …`                          | `Upstream: feature`      | once it is finished and works in the fork |
| Suite Dark        | `feat(suite-dark): …`, `ci(suite-dark): …`, `docs(suite-dark): …` | none                     | never                                     |

- Never mix destinations in one commit. If a feature needs a refactor, the refactor is its own
  `Upstream: refactor` commit and the feature commit builds on it.
- Look for refactors that would shrink the fork's diff later: a config option, an overridable default, one place for
  a value that is now hard-coded in several, a render site the fork can switch off. Do each as its own
  `Upstream: refactor` commit even when no feature needs it yet, and say in the body which Suite Dark commit gets
  smaller once upstream has it.
- An upstream-bound commit must stand on plain `develop`: it applies without any Suite Dark commit; contains no
  Suite Dark names, `suitedark` values or `Suite Dark:` comments; follows upstream's `COMMITS.md` (Conventional
  Commits, no `!` after the type); and passes upstream's checks for the packages it touches. A Suite Dark commit may
  build on an upstream-bound commit, never the other way round.
- Order on `main`: the docs commit, upstream refactors, upstream features, Suite Dark commits.
- `Upstream: refactor` or `Upstream: feature` is a git trailer, alone in the last paragraph of the message. List the
  commits with `git log --oneline --grep '^Upstream:' develop..main`. Do not put upstream issue or pull request
  numbers in fork commit messages (GitHub shows such references upstream); track them in the table below.
- Sending one upstream: the owner decides when, and only the owner's request for that specific pull request allows
  pushing to `trezor/trezor-suite` or opening it. Prepare it on a branch from upstream `develop` with the commit
  cherry-picked and the `Upstream:` trailer removed, then follow upstream's own `AGENTS.md`. When upstream merges
  it, the next sync drops the fork commit, by itself if the content is identical, otherwise drop it by hand and
  resolve the later commits. If upstream declines a feature, it becomes a Suite Dark commit (`feat(suite-dark): …`,
  no trailer).

Upstream-bound commits on `main`: none yet. List each one here with its subject, kind, upstream pull request and
status.

## Decisions already taken

Ask the owner before reversing any of these.

- Desktop only. Web and mobile are not built, released or checked at runtime. Fork edits in shared code
  (`suite-common/*`, `packages/suite`) also change their behaviour (analytics and message-system defaults, discreet
  mode, `sendFeedbackThunk`); keep their unit tests and lint passing.
- Not Bitcoin-only. All upstream networks, Earn, Trading, WalletConnect and NFTs stay.
- Privacy: no analytics, crash reports or feedback reach Trezor servers, not even data the upstream privacy rules call
  non-sensitive; no remote message-system configuration, no feedback forms, no promotional banners, Tor and discreet
  mode on by default. Functional traffic stays: blockchain backends, fiat rates, token definitions, firmware,
  Trading and Earn data, the country lookup and image proxy on `services.trezor.io`, Blockaid checks through
  `cdn.trezor.io`. One exception the fork keeps for now: a TRX vote in Earn is registered with Trezor's Earn server by
  its transaction id, and removing that breaks voting. The website lists this traffic; keep both in sync.
- Kept on purpose: the backend User-Agent `Trezor Suite <version>` (blends in with Trezor Suite users) and the
  SatoshiLabs copyright and author. `process.env.VERSION` has no suffix, because it is sent in the backend User-Agent.
- Coinjoin: upstream Privacy accounts as they are, plus the kruw.io default coordinator (tested by the owner).
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

## Working here

- Branches (owner's decision): `develop` is an exact mirror of upstream `develop`, locally and on `origin`; it only
  ever moves by fast-forward and never gets a fork commit. `main` carries the fork series and is the default branch on
  GitHub. `gh-pages` holds the website (see below). Never use GitHub's "Sync fork" button on `main`: it would merge
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
- New fork change: check "Decisions already taken" first, then split it as in Upstream first. Append a
  `feat(suite-dark): …` commit at the end of the series, insert an upstream-bound commit after the docs commit and
  before the first Suite Dark commit, and fold the matching documentation (table row, the upstream list, Decisions, Known gaps,
  README intro when the user-visible feature list changes) into the docs commit. Later fixes go inside the owning
  commit.
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
  `ci(suite-dark): remove the upstream workflows`, whenever upstream edited a workflow. There, delete every upstream
  workflow in one go, the conflicted and the newly added ones (the fork's own file does not exist yet at that point):
  `find .github/workflows -maxdepth 1 -type f ! -name 'suite-dark-*' -print0 | xargs -0 git rm -q`, then
  `GIT_EDITOR=true git rebase --continue`. Never keep upstream's file. If the rebase did not stop there but that
  `find` lists files afterwards, fold their removal into that commit with the recipe above. Then
  `git submodule update --init --recursive`, `git lfs pull upstream` and `yarn`. Audit the upstream delta
  (`git diff <old develop>..develop`) for `data.trezor.io`, `services.trezor.io`, `cdn.trezor.io`, `sentry`,
  `analytics`, `FeedbackCard`, `sendFeedbackThunk`, `Banner`, `configSource` and `isCodesignBuild`, and neutralise
  each new surface inside the fork commit that owns its area, or list it on the website. Run the checks, update this
  file if a fork commit changed, and ask before pushing both in one command:
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
  unconfirmed; `suite/coinjoin/src/config.test.ts` expects the kruw coordinator;
  `packages/suite/mocks/mockInitialAppState.ts` keeps the light theme for upstream tests;
  `suite-common/assets/src/homeAssetTableFeedbackThunks.test.ts` expects that nothing is sent. The two device-connect
  eShop tests in `suite/flags/src/flagsSlice.test.ts` now pass trivially.
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
`feat(suite-dark): …` commit under the owner's current git identity, without `suite-dark.com` hosts, old `suite-dark`
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
