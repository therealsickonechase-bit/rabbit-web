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

## Recovery and receiving on Google Cloud (set up 2026-10-16)

**What "recovery" can and cannot mean here.** The key was generated inside a hardware security module and can never be exported. There is no seed phrase and no backup file, by design. So the funds are recoverable only while two things exist: the Google Cloud project and the key version. Nothing can rebuild the key from a backup. The plan is therefore (1) do not lose the key by accident, (2) never keep more in the wallet than you could afford to lose, and (3) move savings out to an address you control elsewhere.

**Protections in place** (script: `scripts/powershell/Setup-GcpWalletRecovery.ps1`, safe to re-run, prints a status report):
- A **project lien** blocks deleting the project (which would destroy the key) until you remove the lien on purpose: `gcloud alpha resource-manager liens list`, or the Liens API.
- A **destroy delay of 30 days** on both keys: a destroyed key version can be restored in that window (`gcloud kms keys versions restore 1 --key maxwell-donations --keyring rabbit-wallet --location us-west2`).
- An **email alert** ("RabbitOS: a wallet key was changed") on any destroy, restore, update, create or permission change on key ring rabbit-wallet.
- **Nobody and nothing can sign** with the donation key. Only the separate anchoring key (fee money only) has a service account signer. Data Access audit logs record every signing request.
- The project has **one Owner** (your Google account). If that account is lost or locked, the key is unreachable. Decision for you: add a second Owner you trust (a second Google account you control, with its own recovery methods) with `gcloud projects add-iam-policy-binding rabbitsoftware-io --member user:SECOND_ACCOUNT --role roles/owner`. Also keep the recovery phone and email of your Google account current and use a hardware security key on it.

**What you do to limit the loss**
1. Treat the wallet as a **receiving account**, not savings. After each meaningful receipt, sweep it to an address you control elsewhere (a hardware wallet you hold a seed for) with the withdrawal tool: add that address to `~/RabbitOS/wallet-destinations.json`, run `node withdraw.mjs eth|btc ... --to ADDRESS --sweep` as a dry run, then `--broadcast`.
2. Do the **small round-trip test** first (receive a tiny amount, sweep it back out) so the whole path is proven before real money arrives.
3. If the alert email arrives and you did not cause it, restore any destroyed key version at once (command above) and review the Admin Activity log.

**Receiving, and the Google Cloud receiving account.** Receiving needs only the public addresses; anyone can send at any time and the key controls the funds. The Google Cloud side that sees and records what arrives is the Cloud Run job `rabbit-wallet-watch` (script: `Setup-GcpWalletWatch.ps1`, every 30 minutes). It reads public networks only, has no signing permission, and writes a **private** record to `gs://rabbitsoftware-io-reports/wallet/state.json` (balances, total ever received on Bitcoin, last 50 receipts). When money arrives it logs `wallet_received` and emails you ("RabbitOS: money arrived at a wallet address"). It also watches the two anchoring fee accounts, so you are told when you fund them. Read the record with: `gcloud storage cat gs://rabbitsoftware-io-reports/wallet/state.json`.
