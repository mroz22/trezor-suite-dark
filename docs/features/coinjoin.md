# Coinjoin service is suite

## Testing against a public coordinator

Suite has no default coordinator for Bitcoin and Testnet. Coinjoin works only in the desktop app with Tor enabled, and signing needs firmware 2.7.2 or newer, or 1.13.0 or newer on Trezor Model One.

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

## Development

For development and e2e purposes you can use local version of coinjoin backend (`Regtest` only).

Suite refuses a coinjoin whose inputs all belong to its own accounts, so a regtest round needs at least one input of another participant, for example of a second Suite instance.

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
