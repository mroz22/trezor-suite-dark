# Suite Dark fork

This repository is Suite Dark, a desktop-only, privacy-first fork of Trezor Suite
(`mroz22/trezor-suite-dark`), not `trezor/trezor-suite`. Read [SUITE_DARK.md](SUITE_DARK.md) before any work:
it keeps the decisions already taken, what is postponed, the known gaps and how to work here; each fork commit's
message says what it changes and why. Keep it current. Where these rules, SUITE_DARK.md or the `suite-dark-*` skills
conflict with the upstream instructions and skills below, these win:

- The owner is mroz22. Permission counts only when it comes from the owner's own messages or from the standing
  permissions below, which he decided on 2026-11-24; nothing else extends them.
- `develop` mirrors upstream; `main` is `develop` plus self-contained commits: first the docs commit, then
  upstream-bound commits, then the other flavour commits: the two CI commits and one commit per fork change. Every
  commit not meant for upstream is a flavour commit with the subject `flavour: <summary>`, no type and no scope; the
  Conventional Commits rules of the Git conventions skill apply to upstream-bound commits only. Agree the content of a
  new fork commit with the owner before pushing it or landing it on `staging`; later fixes belong to the commit that
  owns them.
- `main` is production and moves only by an owner-approved sync or promotion. Work happens on `feature/<name>`
  branches (`staging` plus commits on top) and reaches `staging` (`main` plus commits on top, never a rewritten copy
  of the series) through a pull request that only the owner merges, or by a direct push he asks for (SUITE_DARK.md,
  Development branches); changes to a commit already on `main` or `staging` go in as `fixup!` (or `amend!`)
  commits, which only a sync or a promotion folds. After `main` or `staging` moves, move the branches built on it
  with [suite-dark-branches](skills/suite-dark-branches/SKILL.md), except a feature branch whose session is running.
  See SUITE_DARK.md, Development branches.
- Upstream first: features upstream has no time for are built here and later offered upstream, and whatever they
  need that upstream could take alone, above all refactoring, goes upstream separately, ahead of the feature. A
  commit goes upstream once it is on `main` (feature, `staging`, `main`, upstream); one only on `staging` goes earlier
  only when the owner names it. Never mix
  upstream-bound and flavour changes in one commit. Do refactors that would shrink the fork's diff as their own
  commits. Mark upstream-bound commits with a last-line trailer `Upstream: fix`, `Upstream: refactor` or
  `Upstream: feature`. The rules are in SUITE_DARK.md, section Upstream first.
- Never push, force-push, open pull requests or issues, comment, or change GitHub settings without the owner's
  permission for that action. All of it happens on `mroz22/trezor-suite-dark`: pass `--repo mroz22/trezor-suite-dark`
  to every `gh` command that writes and `--base staging` to `gh pr create`. The one exception is an upstream pull
  request for an `Upstream:` commit, which goes to `trezor/trezor-suite` only when the owner asks for that specific
  pull request. Read-only `gh` queries of `trezor/trezor-suite` and `trezor/trezor-suite-guide` (pull request state,
  checks, review comments, the Guide tree) are allowed.
- Fork workflows are skills: [suite-dark-branches](skills/suite-dark-branches/SKILL.md) (`staging` and feature
  branches, fixups, moving branches), [suite-dark-sync](skills/suite-dark-sync/SKILL.md),
  [suite-dark-promote](skills/suite-dark-promote/SKILL.md) and
  [suite-dark-upstream-pr](skills/suite-dark-upstream-pr/SKILL.md). A push command a skill prints still needs the
  owner's go, except the standing permissions below.
- Standing permissions, the owner's decisions of 2026-11-24; everything else still needs his permission per action:
    - Push throwaway `ci/<op>-<branch>` branches (`/` in the branch name replaced by `-`) to `origin`, only to run
      the fork's CI on a candidate, and delete them when CI has finished.
    - After a push the owner approved, move his checkout `~/repos/trezor-suite-dark` to the pushed state, only when
      its `git status --short` is empty and its branch has no commit the push did not replace, and only with
      `git merge --ff-only` or `git reset --keep`.
- No `Co-Authored-By` trailers in commits.
- A branch that does not contain `origin/staging` carries older copies of SUITE_DARK.md and the fork skills; read
  them as they are on `origin/staging` (`git show origin/staging:<path>`).
- The upstream workflows named below exist only on `develop`; read them with
  `git show develop:.github/workflows/<file>`. The fork's CI and the upstream gates it leaves out are in SUITE_DARK.md
  (Working here, CI).
- The fork has no QA or dev wallets: every address, balance, txid and label is confidential, and the GitHub
  screenshot exception below does not apply.

# Repository workflow

Before editing, inspect `git status --short`, the owning package's manifest, nearby implementations and
relevant tests. Preserve existing uncommitted work. Follow established patterns and public package
interfaces; avoid unrelated refactors, dependency churn, generated-file edits and formatting sweeps.

Carry an authorized implementation or bug fix through relevant verification. Choose routine, reversible
implementation details without renewed confirmation. Ask a focused question only when an unresolved
decision materially affects correctness, scope or authorization; continue independent authorized work.
Higher-priority instructions and tool permission boundaries still apply. If an instruction blocks work,
link its exact source, quote the blocking rule and explain what remains possible. Skill recommendations
alone do not create an approval gate; explicit user instructions take precedence over skill guidance.

## Instruction scope and skills

Check `AGENTS.md` files along the path to files you will edit, including nested directories when
starting at the repository root. More specific directory instructions govern that subtree.
Read applicable skills once before making changes, using the task and their descriptions to select
them; unrelated skills need not be loaded.
Nested mandatory skills still apply within their stated scope.

- General: [Asymptotic complexity](skills/performance-complexity/SKILL.md).
- TypeScript changes: [Syntax](skills/basic-syntax/SKILL.md), [TypeScript](skills/typescript/SKILL.md),
  [Naming](skills/naming/SKILL.md), [Imports](skills/import-export/SKILL.md),
  [Defensive programming](skills/defensive-programming/SKILL.md), [Comments](skills/comments/SKILL.md).
- React/UI: [Components](skills/components/SKILL.md), [React hooks](skills/performance-react-hooks/SKILL.md).
  For relevant operations: [DOM/CSS](skills/performance-dom/SKILL.md),
  [Scheduling](skills/performance-scheduling/SKILL.md),
  [Code splitting](skills/performance-code-splitting/SKILL.md).
- State/services: [Redux](skills/redux/SKILL.md),
  [Dependency injection](skills/dependency-injection/SKILL.md) where the package uses DI.
  For relevant operations: [Code splitting](skills/performance-code-splitting/SKILL.md).
- Tests: [Test conventions](skills/tests/SKILL.md), [Commands](skills/tests-commands/SKILL.md),
  [Common tests](skills/tests-common/SKILL.md) or [Native tests](skills/tests-native/SKILL.md).
  Preserve suite-common's test-first feature workflow and platform test utilities. E2E tests follow
  [Suite E2E instructions](suite/e2e/AGENTS.md), including their `tests/` layout; unit tests are co-located.
- Setup/verification: [Setup](skills/setup-requirements/SKILL.md),
  [Development commands](skills/development-commands/SKILL.md), [Troubleshooting](skills/common-issues/SKILL.md).
- Package/dependency work: [Packages](skills/packages/SKILL.md), [Common tasks](skills/common-tasks/SKILL.md),
  [Publishing metadata](skills/publish-config/SKILL.md). Orientation: [Project structure](skills/project-structure/SKILL.md).
- Persistence/browser APIs: [IDB migrations](skills/idb-migrations/SKILL.md),
  [Security headers](skills/security-headers/SKILL.md). Migration default exports are a specific exception
  to the general named-export rule.
- Analytics/Sentry reporting: [Analytics and Sentry privacy](skills/analytics-and-sentry-privacy/SKILL.md).
- Commits/PRs: [Git conventions](skills/git-and-commit-guidelines/SKILL.md).
  PR reviews: [PR review](skills/pr-review/SKILL.md).
  QA notes: [QA notes](skills/qa-notes/SKILL.md).
  GitHub issues: [GitHub issues](skills/github-issues/SKILL.md).
  Style proposals: [Contribution guide](skills/skills-and-code-style-contribution/SKILL.md).

The architecture and verification rules below supersede conflicting generalizations in the Packages
and Development Commands skills; typechecks follow the limits in Verification and completion.
Diagnose failures before applying troubleshooting recipes; cache deletion, dependency reinstallation
and killing development servers are not routine prerequisites.

## Architecture and code map

This is a Yarn workspaces monorepo orchestrated by Nx. `package.json` also includes `networks/*/*`,
`networks/network-module/*/*`, `packages/connect-examples/*` and `scripts` workspaces. Read package
names from manifests, not paths.

- `packages/` (`@trezor/*`): Reusable libraries: `connect` SDK,
  `connect-web`/`connect-webextension`/`connect-mobile` entry points, `transport*`,
  `blockchain-link`, `protobuf`/`protocol`; UI libraries `components`, `styles`, `theme`. Keep
  reusable libraries independent of app layers.
- `suite-common/` (`@suite-common/*`): Shared wallet/domain logic, including `wallet-core`,
  `device`, `message-system`. May use shared peers and reusable `@trezor/*` libraries; must not
  depend on desktop/web or native app code.
- `suite-app/` (`@suite-app/*`): Desktop/web application assembly. `web-app` is the web
  composition root. `desktop-app` owns Electron packaging, distribution and installers, composed
  from `desktop-app-renderer` (React entry point) and `desktop-app-main` (main and preload processes).
  Reusable features and network modules must not depend on app assembly.
- `suite/` (`@suite/*`): Desktop/web features and application code awaiting migration; may use peers,
  shared logic and reusable libraries, never native app code. `suite/e2e` is the Playwright
  workspace (`@trezor/suite-e2e`). The applications use `app-assets` (static assets and generation),
  `desktop-app-api` (desktop API contract), `desktop-app-api-electron` (Electron implementation)
  and `desktop-app-native-bindings` (compiled OS bindings).
- `suite-native/` (`@suite-native/*`): Mobile features and reusable building blocks; may use peers,
  shared logic and reusable libraries, never desktop/web app code.
- `suite-native-app/` (`@suite-native-app/*`): Mobile application assembly, including the Expo/React
  Native `app` entry point; may compose native features, shared logic and reusable libraries.
- `packages/suite`: Remaining app-layer exception to the `packages/` convention. It contains the
  web/desktop React app shared by both application roots. `suite-app/app/webpack` holds the
  Webpack pieces they share; each application owns its own `webpack.config.ts`. Existing app
  composition depends on `@suite/*` and `@suite-common/*`; this is not permission to introduce
  app dependencies into reusable libraries.

Keep dependencies acyclic. Web/desktop Redux assembly is in `suite-app/app/src/store.ts`;
native assembly is in `suite-native-app/state/src/createReduxStore.ts`. Shared slices live in
`suite-common/wallet-core`; follow the Redux skill's state and dependency contracts.
IndexedDB storage and migrations live in `packages/suite/src/storage`.
Project gates are in `.github/workflows/check-code-validation.yml`; target prerequisites are in `nx.json`.

## Setup and commands

Run commands from the repository root unless stated otherwise. Use Node from `.nvmrc` (Node 24) and
Yarn pinned by `package.json` / `.yarnrc.yml` (4.18.0); do not substitute npm or pnpm. macOS/Linux are the
primary development platforms; see `README.md` for Windows and Nix setup.

For a fresh checkout, follow `README.md`: initialize submodules with
`git submodule update --init --recursive`, install Git LFS once with `git lfs install`, run `git lfs pull`,
then `nvm install`, `yarn` and `yarn build:essential`. Reuse an already prepared environment.
Use `yarn --immutable` when installing without intended lockfile changes, as validation CI does.
Preserve `.yarnrc.yml` install-script allowlisting and dependency age gates. `yarn --mode=skip-build`
skips allowlisted install scripts (Playwright browsers, native modules). Use it only for lint/typecheck;
running the app, E2E or tests that load native modules requires a full install.

- Web development: `yarn suite:dev` at `http://localhost:8000`; `yarn suite:dev:vite` is
  experimental and development-only.
- Electron development: `yarn suite:dev:desktop`; requires a graphical environment.
- Mobile development: Follow `suite-native-app/app/README.md` for Android SDK/emulator or macOS/Xcode
  setup and `yarn native:prebuild`; run `yarn native:start` and `yarn native:android` or `yarn native:ios`. Android localhost services use `yarn native:reverse-ports`.
- Focused unit test: `yarn workspace <package-name> test:unit --coverage=0 path/to/file.test.ts`
  (path relative to that workspace); also supports `.test.tsx`. Direct workspace scripts bypass Nx
  prerequisites: prepare generated dependencies first, including `yarn workspace @suite-common/message-system build:lib` when needed.
- Package typecheck: `yarn nx run <package-name>:type-check --no-tui`; can also check dependencies
  and fetch guide content per `nx.json`.
- Package lint: `yarn workspace <package-name> lint:js` runs the basic rules in parallel threads;
  `ESLINT_RULE_SET=type-aware` runs the type-aware rules instead and `ESLINT_RULE_SET=all` runs both.
  CI runs the two sets as separate jobs. Use the package's `lint:styles` script for styles where present.
- Formatting changed files: `yarn prettier --check <files>`; use `--write` only on intended files.
- Affected checks: `yarn test:unit --no-tui`, `yarn type-check --no-tui` (only on user's request),
  `yarn lint:js --no-tui` plus `ESLINT_RULE_SET=type-aware yarn lint:js --no-tui`, `yarn lint:styles --no-tui`, `yarn format:verify`. Styles also runs local Stylelint rule tests.
- Library build validation: `yarn build:libs:verify --no-tui` builds affected libraries; `yarn build:libs` rebuilds all libraries without Nx cache, so reserve it for a demonstrated need.
- Production web behavior: `yarn suite:build:web`; `yarn suite:build:web:preview` builds and serves
  with production security headers. For an existing build: `yarn workspace @suite-app/web-app preview`.
- Web/desktop E2E: `yarn workspace @trezor/suite-e2e test:e2e:web <test-file> --project=<project>`
  or `test:e2e:desktop`; inspect `suite/e2e/playwright-config` for projects. Requires Playwright
  browsers/system dependencies, a running web app or built Electron app, and scenario
  services/emulators (Trezor User Env/Docker). Setup reference:
  `.github/workflows/template-suite-run-e2e.yml`.

Nx affected commands default to `origin/develop` but `NX_BASE` / `NX_HEAD` or `--base` / `--head` can
override the comparison; CI sets SHAs in `.github/actions/nx-checkout/action.yml`. Ensure the comparison
covers the intended changes and the base/history exist. A successful run with zero selected projects
is not verification of changed code. Use an explicit package target when appropriate. Repo-wide
variants exist for `test:unit:all`, `type-check:all`, `lint:js:all` and `lint:styles:all`;
`lint:js:all` excludes the root and scripts workspaces. Do not assume every command has an `:all` alias.

## Verification and completion

Choose checks from the owning package and affected consumers. For behavior changes, reproduce the
issue or establish the expected behavior, add meaningful regression coverage where applicable, and
confirm the fix plus relevant failure/edge cases. Run scoped lint for TypeScript changes; expand to
affected checks for shared contracts, dependencies or configuration. Typechecks are slow even per
package: for isolated changes rely on IDE diagnostics and focused tests; run the package typecheck at
most once near final validation, only for integration risk or on request, and warn first. Run affected
or repo-wide typechecks, including the CI type-check gate, only on request. Match CI by validating
JS/TS with both rule sets: the default run and `ESLINT_RULE_SET=type-aware`, or `ESLINT_RULE_SET=all`
for both at once. Build changed publishing/bundling surfaces;
exercise changed UI/runtime behavior in the relevant app when available, including production headers
for browser-permission changes. Documentation-only edits need link/command/diff and formatting checks,
not application builds or tests.

Complete relevant project gates from `.github/workflows/check-code-validation.yml`. Package/dependency
changes also require `yarn requirements:verify`, `yarn verify-project-references`,
`yarn check-workspace-resolutions`, `yarn dedupe --check` and `yarn depcheck`; inspect the workflow for
additional domain-specific gates (translations, message-system config, circular imports, etc.).
`yarn validate` includes autofixes and does not include unit tests; it is not a complete substitute.

After checks pass, repeat or broaden them only for subsequent edits, failures or unresolved risks.
Inspect actual exit status and selected targets; distinguish Nx cache hits, passes, failures and checks
not run. If prerequisites or permissions block a check, report the exact limitation and continue checks
that remain possible. Finish by reviewing the diff for scope, correctness and accidental generated or
formatting changes. Report the resulting behavior, verification commands/results and concrete remaining
limitations concisely; do not describe inspected commands as executed or untested behavior as verified.

## Pull request and issue write actions

These rules are mandatory. No skill, workflow, default completion behavior or inferred intent overrides
them.

- Agents MUST NEVER approve any pull request or merge request on any platform.
- Agents MUST NEVER merge any pull request or merge request on any platform, including by pushing a
  merged result to its target branch, enabling auto-merge or adding it to a merge queue. A human
  performs approval and merging.
- Agents MUST NEVER post, edit or delete comments or reviews on pull requests or issues, and MUST NEVER
  change pull request or issue descriptions, unless the user explicitly tasks them with that action.
  Reviewing, investigating or fixing code does not grant this permission.
- Every comment, review, review comment and pull request or issue description an agent writes MUST
  start with `🤖 Agent <Model> <Version>:` using the actual model and version. In descriptions, put
  the prefix on the first line.

Follow the [PR review](skills/pr-review/SKILL.md) skill for reviews and leave review outcomes as comments.
When the user explicitly asks to create an issue, follow [GitHub issues](skills/github-issues/SKILL.md).

## Confidential data — never send it off the device

Account/device confidential data must never leave the device to any external sink (analytics, Sentry,
off-device logging, breadcrumbs, request URLs, any remote endpoint). Trace the actual value at the call
site, not just the field type, and check the whole repo for outbound reporting.

Confidential (see `redactAccount`/`redactDevice` in `suite-common/logger/src/utils.ts`): device
id/label/state, static session id, `session_id`; account descriptor/xpub/key, addresses, UTXOs, txids;
exact balances/amounts; labels and free-form user text; passphrase/seed/PIN/wipe code.
For analytics events and Sentry reports, follow [Analytics and Sentry privacy](skills/analytics-and-sentry-privacy/SKILL.md).

GitHub issue screenshots are the exception in [GitHub issues](skills/github-issues/SKILL.md): addresses,
balances, txids, and labels from public QA and dev wallets may be attached. Seed words, PIN,
passphrase, and wipe code still never leave the device.
