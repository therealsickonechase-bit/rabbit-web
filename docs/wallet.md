# The RabbitSoftware wallet: how it works and how to use it

> **Donations are paused (2026-10-16).** The donate page, `wallet.json`, the front-page block and the app card are removed while `workers/wallet/donations.json` says `"open": false`. The key and addresses still exist and are unchanged. To reopen: set `open` to true, run `node workers/wallet/build-donate.mjs`, restore the page text edits from git history (commit "Pause donations"), then deploy the site and the app.

Receive addresses are on https://rabbitsoftware.io/donate (and in the RabbitOS app once deployed). The code is `workers/wallet` in rabbitsoftware-cloudflare.

## What it is
- **One key** inside a Google Cloud hardware security module (HSM): `projects/rabbitsoftware-io/locations/us-west2/keyRings/rabbit-wallet/cryptoKeys/maxwell-donations`, version 1, algorithm secp256k1.
- **Two addresses from that one key:** Bitcoin native SegWit (`bc1q...`) and Ethereum mainnet (`0x...`). `workers/wallet/wallet.json` holds the public record and a signed proof of control.
- **Nobody holds the private key.** It cannot be exported or read. Only an identity with signing rights on the key can ask the HSM to sign, and today that is nobody except you as project owner through your own sign-in. Every signing request is written to the audit log (Cloud Logging, `data_access`).
- **No seed phrase exists.** You cannot restore this wallet from words. It lives as long as the Google project and key version live (a destroyed key version is recoverable for 30 days). See "Recovery" below.

## Withdrawing (`workers/wallet/withdraw.mjs`)
Run from `workers/wallet` on your PC, signed in with `gcloud auth login` as yourself.

```
node withdraw.mjs status
node withdraw.mjs eth --to 0x... --amount 0.01                 # dry run: shows the plan, signs nothing
node withdraw.mjs eth --to 0x... --amount 0.01 --sign          # signs and prints the raw transaction, sends nothing
node withdraw.mjs eth --to 0x... --amount 0.01 --broadcast     # asks you to retype the destination, then sends
node withdraw.mjs btc --to bc1q... --amount 0.001 [--fee-rate 12] [--sign | --broadcast]
node withdraw.mjs btc --to bc1q... --sweep                     # everything, minus the fee
```

### Guards you cannot skip
- The destination must be in **your allowlist** `%USERPROFILE%\RabbitOS\wallet-destinations.json` (see `wallet-destinations.example.json`). Otherwise add `--new-destination`, and then sending requires retyping the **whole** address.
- Per-withdrawal limits (default 0.1 ETH, 0.01 BTC) and fee limits (200 gwei, 200 sat/vB). Raise them in the same file under `limits`.
- Ethereum **mainnet only**, plain transfers only. Bitcoin: native SegWit destinations only (`bc1q...`); only **confirmed** coins are spent; change returns to the wallet; transactions are replaceable (RBF) so a stuck fee can be raised.
- Sending needs a real terminal. You retype the last 8 characters of the destination (or the whole address if it is new) and the word `SEND`.
- The raw transaction is built and checked on your PC; the HSM only signs a 32-byte hash. After signing, the tool verifies the signature belongs to the wallet key before it will use it.
- Every signing and sending is logged to `%USERPROFILE%\RabbitOS\logs\wallet-withdrawals.log`: ids, addresses and amounts only.

### The first real use (do this before relying on it)
1. Send a **small** test amount (for example 0.005 ETH and 0.0002 BTC) to the donate addresses from a wallet you already trust.
2. `node withdraw.mjs status` should show it (Bitcoin after 1 confirmation).
3. Put a destination you control (a hardware wallet is best) in the allowlist file.
4. Dry run, then `--sign`, then `--broadcast` back to your own wallet. Check the transaction on the explorer link it prints.
5. Only then promote the donate page.

## Recovery (decide this before real money arrives)
The weak point is that there is exactly one copy of the key and it is inside one Google project. Options, from simplest:
- **Sweep regularly** to a hardware wallet you hold yourself, and keep only a small working balance here.
- Put the project and key on a break-glass plan: a second Google owner, billing alerts on, and a reminder never to delete the project or the key ring (the key ring cannot be deleted, but a key version can be destroyed).
- Add a second, independent receiving address on the donate page later if you want an offline copy.

## What was verified (2026-10-15)
- Address derivation against published Ethereum, Bitcoin (BIP173) and keccak test vectors.
- The signing hashes against the EIP-155 example and the BIP143 native SegWit example.
- Signing through the real HSM key: the Ethereum sender recovers to the wallet address, and Bitcoin input signatures verify against the wallet key.
- Nothing has been sent from the wallet, because it holds nothing yet. The first real send is the test in the section above.
