# Pay in coinjoin (Suite Dark + Firmware Dark)

Status: work in progress on branches `feat/pay-in-coinjoin` (Suite Dark) and `feat/coinjoin-payment`
(Firmware Dark, `~/repos/firmware-dark`). In Suite Dark, protobuf, Connect and the coinjoin client are done (the
client part as upstream-bound commits); Suite state and UI are not. Nothing here is released.

A Privacy (coinjoin) account pays a third party from inside a coinjoin round: the payment is one more output of the
round, registered by the client like any other output, so the payee receives a coinjoin output and the payer needs
no separate transaction. Wasabi Wallet has the same feature (RPC since 2.0.6, GUI since 2.8.0).

The feature is Suite Dark only. Suite offers it only when the connected device reports
`Capability_CoinJoinPayment`, which only Firmware Dark has. Stock Trezor firmware cannot sign such a round (see
below), and a device without the capability never sees a payment.

## Decisions

Taken with the owner on 2026-11-21 and 2026-11-22.

- Goal: get the firmware part into upstream `trezor-firmware` eventually. Upstream has to see a working prototype first,
  so the feature is built now in Firmware Dark and Suite Dark. Model T is enough for the prototype.
- Why: privacy towards the payee and no change linked to the payment. The user queues a payment, starts mixing and
  ends with a fully mixed account; a normal send from mixed coins leaves change the payee knows, which has to be mixed
  again.
- Waiting is accepted: the user queues the payment and leaves the computer locked, with Suite running and the device
  connected; the payment goes out with a later round.
- Funding from private coins only (anonymity at or above the account's target), without a toggle, so a payment waits
  until enough coins are mixed. Wasabi added the same rule as an option (#14664, #14983) and its default is still
  "any coins"; the argument for always on (#14970) is that a payment's unique amount may be matched to inputs, and a
  mixed coin then reveals nothing.
- One payment per account at a time; the device holds one payment per authorization.
- Payee addresses: P2WPKH and P2TR (`bc1q…`, `bc1p…`) only, which every WalletWasabi coordinator accepts.
- Amount: at least 10,000 sats (Wasabi's minimum) and at least the round's `AllowedOutputAmounts.Min`; at most the
  private balance minus a fee reserve (the payment output and the funding inputs at the session's maximum fee rate) and
  minus 10,000 sats that stay in the account, so no remainder too small to mix is left. No "send max" in this version.
- Cancelling works like Wasabi (`PaymentBatch.AbortPayment`): Suite stops including the payment. An attempt that was
  already signed can still confirm until its anchor is spent, so Suite mixes the anchor in the next round without the
  payment, which invalidates every earlier attempt. No separate on-chain send and no device interaction. The UI says
  that an earlier attempt may still confirm until then.
- Persistence: the payment, its anchor and its signed attempts are saved on the coinjoin account. Coinjoin accounts are
  saved only for remembered devices, so pay in coinjoin is offered only on remembered wallets; otherwise a restart would
  forget a signed attempt and the anchor.
- Testing: unit tests, then regtest with the Firmware Dark emulator; the owner tests on mainnet with his own coins and
  a Model T.
- A security audit of the whole feature is a separate session; its starting points are listed under Open questions.

## Why stock firmware refuses

Coinjoin signing is pre-authorized (`AuthorizeCoinJoin`) and unattended. In `CoinJoinApprover`
(`core/src/apps/bitcoin/sign_tx/approvers.py`) every output that is not our own change is somebody else's, and the
device bounds what we lose to them:

```
our_fees = total_in - external_in - change_out
our_fees <= coordination fee + max mining fee for our weight + min(min_registrable_amount, 5000) + one output's fee
```

A payment funded by our inputs is neither change nor someone else's input, so it lands in `our_fees` and signing
fails with `Total fee over threshold.`, unless the payment is small enough to fit in that slack. A SLIP-24 payment request is rejected in coinjoin (`Unexpected payment
request.`), and the normal user-confirmed signing path would ask the user to confirm every foreign output of the
round (hundreds of screens), so neither works.

## Firmware Dark: protocol extension

Fork-only numbers are high so that they cannot collide with future upstream ones. Field numbers must stay below 256
(core decodes field tags as one byte, `common/protob/pb2py`, `decode.rs`); enum values may go up to 65535.

```protobuf
// messages-bitcoin.proto
message AuthorizeCoinJoin {
    ... upstream fields 1-8 ...
    optional CoinJoinPayment payment = 200;  // Firmware Dark: one payment the user approves for this session

    message CoinJoinPayment {
        required string address = 1;         // payee address
        required uint64 amount = 2;          // exact amount in satoshis
        required bytes anchor_prev_hash = 3; // anchor outpoint, see "Anchor"; same byte order as TxInput.prev_hash
        required uint32 anchor_prev_index = 4;
    }
}

// messages-management.proto, Features.Capability
Capability_CoinJoinPayment = 1001 [(bitcoin_only) = true];
```

### Authorization

`authorize_coinjoin` additionally, when `payment` is present:

1. Rejects an invalid address (`output_derive_script` for the coin), a zero amount, and a missing anchor or an anchor
   hash that is not 32 bytes long.
2. Checks that the message, as it will be stored, fits the authorization cache field before any screen is shown.
3. Shows the payment (address, then amount) with `trezor.ui.layouts.confirm_output` before the usual coinjoin
   confirmation. The screens send `ButtonRequest_ConfirmOutput`; the source account is shown in the info menu on
   Safe 3/5/7 and not at all on Model T. No new translation strings in the first version.

The authorization is stored as the serialized `AuthorizeCoinJoin` message in the session cache
(`APP_COMMON_AUTHORIZATION_DATA`). Upstream sizes that field at 128 bytes; Suite's authorization already takes about
80 and a payment with its anchor adds up to about 120, so Firmware Dark raises it to 256 bytes
(`storage/cache_codec.py`, `storage/cache_thp.py`).

### Signing

`CoinJoinApprover`, when the authorization has a payment:

- The payment's `script_pubkey` is derived once from the authorized address.
- In a transaction that spends the anchor (below), the first external output whose `script_pubkey` and `amount`
  both equal the payment is the payment; any further identical output is foreign as before.
- The payment output's weight is added to our weight, so the mining-fee bound covers it.
- The payment amount is excluded from our fees (`our_fees -= payment_out`). All other bounds are unchanged.
- In a transaction that does not spend the anchor, no output is the payment and everything is checked as upstream:
  a payment funded by our inputs fails with `Total fee over threshold.`, an identical output funded by somebody else
  (after the payment was made, or to a reused address) is just foreign.

A round without the payment output signs exactly as today.

### Anchor: at most one payment can confirm

A signed coinjoin never expires. A malicious coordinator can collect all our signatures of a round that carries the
payment, report the round as failed and broadcast it later, after the client has paid again in another round with
other inputs. The payee would be paid twice.

The anchor makes every transaction that carries the payment conflict with every other one:

- Suite picks the anchor, one UTXO of the account, when the payment is created, stores it with the payment and sends it
  in every `AuthorizeCoinJoin` with that payment. The device requires it and never changes it, so device and Suite
  cannot disagree about it (a device-recorded anchor would be lost to Suite when signing is interrupted after the
  device's approval, and every later payment round would then be refused).
- The payment is credited only in a transaction that spends the anchor. All such transactions spend the same outpoint,
  so at most one of them can ever confirm. After it confirms, no other transaction carrying the payment is valid.
- Byte order: `anchor_prev_hash` is the txid as displayed, like `TxInput.prev_hash`, which is
  `readOutpoint(outpoint).hash` in `packages/coinjoin`, not `.txid`.

Suite registers the anchor UTXO in every round that carries the payment; blame rounds re-register the inputs that
signed, so they keep spending it. The anchor is one of the private coins that fund the payment. If the coordinator bans
it, the payment waits, like a postponed payment in Wasabi. Cancelling is described under Decisions: the anchor is mixed
in a later round without the payment, and from then on no earlier attempt can confirm. Editing a payment keeps its
anchor: the edited payment is authorized with the same anchor, so old and new attempts still conflict.

The client holds back and mixes only the anchor of the payment Suite passes, so Suite keeps passing a payment that may
have a signed attempt, a rejected one included, until its anchor is spent, and marks it cancelled when it is no longer
wanted. A payment with another anchor must not replace it before then. Once a transaction that spends the anchor
without the payment confirms (a cancel, or a blame round that could not repeat the payment), no attempt can confirm any
more and the payment may get a new anchor.

### Security notes

- What the user can lose is unchanged except for the payment: the exact authorized amount to the authorized script,
  at most once per anchor, plus the mining fee for the payment output's weight at `max_fee_per_kvbyte`.
- A compromised host can obtain a second payment only through a second on-device approval of the payment screen with
  a different anchor (for example after `CancelAuthorization`). The device does not show the anchor, and Suite asks
  for the same screen again after every replug or restart, so such a second approval looks routine. Accepted risk in
  this version: the extra money still goes to the payee the user approved. Suite keeps re-approvals rare and says
  when one is expected; a real fix would need the device to remember payments in flash.
- If the coordinator adds an identical output funded by its own inputs instead of ours in a round that spends the
  anchor, the device credits that one; our loss is still bounded by the authorized amount and the payee is paid once.
  Suite re-authorizes without the payment once it is paid.
- The authorization lives in RAM until the device is unplugged, the authorization is cancelled, its last round is used
  or the session is evicted. After a cancel it may still hold the payment until the anchor is spent. Before signing,
  the client therefore refuses a transaction in which one of our registered outputs is missing or underpaid (the
  upstream-bound `fix(coinjoin): verify own inputs and outputs before signing`, a proven lie that stops mixing) and
  one with the payment output in a round that spends the anchor where it did not register the payment; a coordinator
  that drops our change and adds the payment instead is refused.
- The payee is not our address, so the rule that our output scripts are never reused after a failed round does not
  apply to it: after a failed round the payment is registered again, in the blame round and in later rounds, always
  with the same anchor. A coordinator that makes rounds fail can therefore link the payee to the anchor and to the
  coins that fund it. This follows from the anchor design, and Wasabi's retry rule has the same effect; accepted
  risk (owner, 2026-11-24).
- Firmware without the change ignores the unknown field: it shows no payment, authorizes, and later refuses to sign
  the payment round, which fails the round and gets our inputs banned. Suite therefore sends a payment only to a
  device that reports `Capability_CoinJoinPayment` (checked in Connect).
- Legacy (T1B1) is not built by Firmware Dark. The new fields get nanopb options so that the legacy build keeps working.

## Suite Dark

### Protobuf and Connect

- `packages/protobuf` definitions regenerated from the Firmware Dark protos, so `AuthorizeCoinJoin.payment` and
  `Capability_CoinJoinPayment` are known. Upstream protobuf syncs overwrite these generated files; the fork commit
  carries the diff.
- `TrezorConnect.authorizeCoinjoin` gets `payment?: { address; amount; anchor: { prevHash; prevIndex } }`. With a
  payment it requires the capability, and it never takes the `preauthorized` shortcut (that shortcut returns success
  for any existing authorization and would silently drop the payment): it sends a fresh `AuthorizeCoinJoin`, which
  replaces the stored authorization.

### Coinjoin client (`packages/coinjoin`)

- Payments per account (`{ id, address, amount, anchor }`) in `RegisterAccountParams` and `Account`.
- Round selection: an account with a pending payment joins a round even when all its coins are private (the v15
  middleware selector never selects such an account), funding the payment from private coins only and always registering
  the anchor UTXO. One payee script is paid at most once in a round, because the coordinator merges outputs with the
  same script, also when another account already pays it in a round that is still in input registration. A blame round
  repeats the payment only when the re-registered coins include the anchor, are all private and fund the payment;
  otherwise it re-registers them without the payment.
- Output decomposition: reserve the payment (amount plus the fee for its own output vsize) before calling the v15
  middleware `get-outputs-amounts`, as Wasabi's `PaymentAwareOutputProvider` does; handle a remainder too small to
  decompose (one change output, or leave it as fee within the device's slack).
- Output registration relies on the upstream-bound check of the round inputs before decomposition, so a refused round
  never reveals the payee. Register the payee script with its exact vsize (P2WPKH 31, P2TR 43 vbytes), never with
  another script, and never detain or burn it: only our change outputs follow the upstream-bound rule that output
  scripts are never reused after a failed round. A rejection of the payee or the amount (`AlreadyRegisteredScript`,
  `ScriptNotAllowed`, `NonStandardOutput`, `DustOutput`, `NotEnoughFunds`, `TooMuchFunds`) blocks the payment for the
  session, because WalletWasabi coordinators reject every script that was already a coinjoin output and a retry would
  fail again in every round; the round reports it in `rejectedPayments` with `isBlocked`. Any other failure
  (`WrongPhase`, `RoundNotFound`, a network error) fails only that round and the payment waits for the next one. Once a
  registration of the paying account fails, its payment registration is aborted if it was not sent yet, so the payee is
  not shown with the anchor in a round the account does not sign.
- A payment that fails in decomposition or registration fails only the paying account's inputs (the upstream-bound
  `fix(coinjoin): fail only the failing account in output registration`); the other accounts in the round still
  register their outputs and sign. A lie of the coordinator (`CoordinatorMisbehaviorError`) is never turned into the
  failure of one account: it fails every input of the round and stops mixing.
- Signing: the upstream-bound checks run first: every input we registered and every output we registered with at least
  its amount (`verify own inputs and outputs before signing`), and a valid ownership proof of every input of another
  participant (`verify other participants' ownership proofs`), which admits only P2WPKH and Taproot inputs, so the txid
  computed before signing is the txid of the broadcast transaction. The payment commit then checks the payment. A
  registered payment whose payee script is missing from the transaction is a proven lie that stops mixing: the
  coordinator accepted the output and merges outputs only by their script. It is checked first, so that a payment
  changed during the round cannot hide it. The other checks refuse the round without stopping mixing, because an exact
  amount depends on the fee rounding of the coordinator and another participant may pay the same script: the payment
  output with the exact amount, the anchor among our inputs, the payment unchanged since its registration, and no
  payment output of an account whose anchor is in the round but whose payment was not registered there (in a round
  without its anchor an identical output is foreign to the signer). It counts the payment output as ours for the "no
  registered outputs" guard and keeps it out of the liquidity clue. Only payments of accounts that still have inputs in
  the round are checked and recorded. Record the attempt (txid and our inputs) before sending signatures.
- Coordinator constraints, read from the round: `AllowedInputTypes` and `AllowedOutputTypes` (names, or NBitcoin
  ScriptType values as WalletWasabi coordinators send them: P2WPKH 4, Taproot 7), `AllowedOutputAmounts` (kruw: min
  5,000 sats), and a payee script must not be an output of another active round or an input of any round.

### Suite (`suite/coinjoin`, UI)

- Payment state on the coinjoin account (`pending` with its anchor, `in-round`, signed attempts with txid and inputs,
  `paid`, `cancelled`), persisted as an optional field of the existing `coinjoinAccounts` object: no IndexedDB
  migration. Offered only on remembered wallets.
- `authorizeCoinjoinThunk` passes the pending payment and its anchor; the session restore path does the same.
  After the payment is paid, the next authorization has no payment.
- Entry point on Privacy accounts: one payee, exact amount, no fee picker or RBF; shown only with the capability.
- During `authorizeCoinjoin` with a payment the device sends `ButtonRequest_ConfirmOutput`, which Suite routes to the
  transaction review modal today; show a dedicated "confirm the payment on your Trezor" modal instead.
- Pending payment with a cancel action on the coinjoin tab (see Decisions).
- History: show "Paid X to address" under the coinjoin row from the stored payment.

Notes for this stage, from the coinjoin client as it is now:

- Suite holds the authoritative payment state. The client keeps its blocks (`Account.blockedPaymentIds`) only per
  client instance: they are lost when the coordinator changes (`CoinjoinService.replaceClient`), when mixing stops on a
  coordinator lie (the client unregisters all accounts) and on restart. Suite persists blocking rejections
  (`rejectedPayments` with `isBlocked`), stops passing a blocked payment as pending and asks the user to cancel or edit
  it (an edit keeps the anchor); otherwise every new session repeats the rejected registration and fails the account's
  inputs. A rejection by one coordinator says nothing about another.
- Store the attempts of `CoinjoinRequestSignatureEvent.payments` before `TrezorConnect.signTransaction`.
- Coordinator change (possible only without a session of the network): the anchor and earlier attempts stay valid, an
  attempt signed at the old coordinator can still confirm until the anchor is spent. The next session authorizes the
  new coordinator with the same payment and anchor; never assign a new anchor before the anchor is spent.
- Mixing stopped on a coordinator lie: keep the payment pending with its attempts, the coordinator may hold a signed
  attempt. Point the user to cancel (mix the anchor without the payment), possibly at another listed coordinator.
  Never restart automatically.
- `authorizeCoinjoinThunk` and the session restore path pass the payment and its anchor next to the capped
  `maxCoordinatorFeeRate`. Connect ignores `preauthorized` with a payment, so a restore with a payment shows the payment
  screen on the device again. The restore registers the account only if the session still exists; keep that order.
- Pass a changed, cancelled or removed payment to the client only when no session is in a critical phase, as
  `fetchAndUpdateAccountThunk` already does for account updates; `updateClientAccountThunk` does not check this itself.
  The client refuses to sign a round whose registered payment changed, and that fails the inputs of every account in
  the round.
- Suite refuses a payee that another account of the network has pending, or cancelled with its anchor unspent. The
  client pays one script at most once per round, also across its accounts, but two payments to one script can still
  meet: in two rounds at the same time, where the coordinator rejects the second as `AlreadyRegisteredScript` and the
  client blocks it for the session, or in the round that mixes the anchor of the cancelled payment, where an output
  with the same script and amount makes the client refuse to sign, which fails the inputs of every account in the
  round.
- The client gets only the change addresses up to the last used one plus 20, and its check that the payee is not an
  own script covers only those and the utxos. Suite refuses a payee that is any address of the paying account.
- The serialized round carries the expected amounts of our outputs in `addresses`. It is local state; keep it out of
  logs and reports.

## Plan

1. Firmware Dark: protobuf, authorization, approver, cache, capability; unit tests and device tests on the emulator.
2. Suite Dark: protobuf regeneration and Connect.
3. Coinjoin client (done) and Suite state, unit tests with the mocked coordinator and middleware.
4. UI.
5. End to end on regtest: Firmware Dark emulator, the local coordinator, Suite with
   `--state.wallet.coinjoin.debug.coinjoinConfigOverride.regtest.coordinatorUrl=…`.
6. Pull requests, review, testing, merge.

## Open questions

- Models: Firmware Dark installs wipe the device; Safe 3/5 need an irreversible bootloader unlock; retail Safe 7 with
  an unofficial vendor header restarts after one hour, and the current T3W1 image is signed with development keys.
  The firmware is tested on the Model T emulator so far.
- Where Firmware Dark is hosted: its `origin` remote points at a host that no longer resolves.
- The payee receives exactly the payment amount only if the coordinator rounds the fee for the payee output down, as
  NBitcoin `FeeRate.GetFee` does on its master branch (`getMiningFee`). Check it on regtest and then with one small
  payment at kruw: a coordinator that rounds otherwise fails every payment round in the signing check.
- Security audit, starting points: the routine re-approval after a replug and a compromised host, the coordinator
  that swaps our change for the payment, a banned anchor, the payment screen wording (cancel texts of transaction
  signing).
