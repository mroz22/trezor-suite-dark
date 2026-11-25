# Coinjoin service is suite

## Testing against a public coordinator

Suite has no default coordinator for Bitcoin and Testnet. Coinjoin works only in the desktop app with Tor enabled, and signing needs firmware 2.7.2 or newer, or 1.13.0 or newer on Trezor Model One.

Each network lists the coordinators it can mix through in `coordinators` of `COINJOIN_NETWORKS` (`suite/coinjoin/src/config.ts`), the first one is the default. The coinjoin settings of a Privacy account show the coordinator in use after the other settings: its address, its identifier (the `CoordinationIdentifier` of its rounds, which Suite commits to in ownership proofs), the highest coordinator fee a session authorizes and the fewest inputs of a round. With more than one listed, the user chooses one there once Custom is chosen; with Recommended, the settings show the values in use and cannot be changed. The choice applies to all Privacy accounts of the network, is kept across restarts and cannot change while a coinjoin session of the network exists, paused ones included. A coordinator that is no longer listed falls back to the default one. A coordinator passed at startup as below replaces the chosen one for that launch.

1. Run `yarn suite:dev:desktop`. It also rebuilds the main process, where the coinjoin client runs. Quit the Electron app it opens (Cmd+Q on macOS), the dev server keeps running.

1. Start Electron with the coordinator. Use `.test.` instead of `.btc.` for Testnet. The override applies only to this launch.

    ```bash
    yarn workspace @suite-app/desktop-app dev:run \
        '--state.wallet.coinjoin.debug.coinjoinConfigOverride.btc.coordinatorUrl=https://<coordinator>/wabisabi/' \
        '--state.wallet.coinjoin.debug.coinjoinConfigOverride.btc.wabisabiBackendUrl=https://<coordinator>/'
    ```

    > Override both urls. Without `wabisabiBackendUrl` the coordinator version is not requested and Suite reports stub values, so the debug panel links to a non-existent WalletWasabi build and the zkSNACKs legal documents version you agree to is a constant instead of the one the coordinator publishes.
    >
    > The main process whitelists only the coordinator host and its subdomains, so the backend url has to live there too. A sibling host (`api.example.com` next to `coord.example.com`) is blocked with `Request blocked, not whitelisted domain`.

    Suite skips rounds whose announced minimum number of inputs (`MinInputCountByRound`) is below 21 on Bitcoin and 2 on Testnet and Regtest. The skip shows only as `Skipping round` in the info log. Before it registers outputs and again before it signs, Suite also refuses a round that has fewer inputs than this minimum or only inputs of its own accounts. Add `'--state.wallet.coinjoin.debug.coinjoinConfigOverride.btc.minInputCount=<count>'` to the command to change the minimum for one launch.

    Suite checks that the id of each round is the hash of the round parameters, as WalletWasabi clients do since version 2.3.0, and that the round names the coordinator Suite commits to in ownership proofs (`coordinatorName`). It skips any other round with `Its id does not match its parameters and coordinator` in the warn log, and it leaves a round it joined when the parameters of the round change.

    When the coordinator provably lies in a round Suite joined, for example about the round parameters, the inputs or the outputs of the user or the ownership proofs of other participants, Suite ends the coinjoin sessions of all accounts of that network, paused ones included, as cancelling coinjoin does, and shows an error toast. The warn log shows `Stopping all accounts. Coordinator misbehaved`. Coinjoin starts again only when the user starts it.

## Development

For development and e2e purposes you can use local version of coinjoin backend (`Regtest` only).

Suite refuses a coinjoin whose inputs all belong to its own accounts, so a regtest round needs at least one input of another participant, for example of a second Suite instance.

Coordinators older than WalletWasabi 2.3.0, such as the one of the local backend, compute the id of a blame round before they set its input registration timeout. Suite skips their blame rounds as rounds whose id does not match their parameters and releases the inputs that wait for them.

1. run `./docker/docker-coinjoin-backend.sh`

    > If you are using `trezor-user-env` make sure that it's started with `-r` option (disabled regtest)
    >
    > Pull and run docker image of https://github.com/trezor/coinjoin-backend
    >
    > Backend control panel (faucet) should be accessible at `http://localhost:8080/`

1. Run suite, go to settings and enable `Debug mode` (click 5 times on the "Settings" header)

    Suite authorizes a coordinator fee of at most 0.1% and skips rounds with a higher fee. The skip shows only as `Fees to high` in the info log. If the backend coordinator charges more (the WalletWasabi default is 0.3%), start the desktop app as in [Testing against a public coordinator](#testing-against-a-public-coordinator) with a higher cap for regtest:

    ```bash
    yarn workspace @suite-app/desktop-app dev:run \
        '--state.wallet.coinjoin.debug.coinjoinConfigOverride.regtest.maxCoordinatorFeeRate=0.003'
    ```

1. go to Settings > Crypto tab and enable `Bitcoin Regtest` and set custom backend to `http://localhost:19121/` (default)

    > Optionally disable other coins
    >
    > Coinjoin accounts are not using this backend but you want to have all Regtest accounts synchronized with the same bitcoind

1. Access coinjoin account

## A round without a device

`yarn workspace @trezor/coinjoin test:regtest` runs a whole round against the backend above
with throwaway taproot keys: it registers two inputs, confirms them, decomposes the amounts,
reissues and registers every output, signs and waits for the coordinator to broadcast. Every
credential is built by `packages/coinjoin/src/client/credentials.ts` and every decomposition
by `@trezor/coinjoin-strategy`, so it is the check that the client's credential requests are
accepted on the wire — the unit vectors only compare parsed values. The ownership proofs and
witnesses are signed locally instead of by a Trezor, so it does not replace one manual pass
through the UI with a device.

> The published backend image ships Bitcoin Knots v25.1.knots20231115, whose build expiry has
> passed, so its `bitcoind` needs `-softwareexpiry=0` to start at all.
