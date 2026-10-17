# GitHub mirrors in Google Cloud

The GitHub organisation `rabbitsoftware-io` is administered by an account GitHub has suspended, and `therealsickonechase-bit` is not a member, so the org-admin sync (`sync-github-vault.py`) can no longer pass its admin check. The history it had already mirrored is kept and moved into Google Cloud so nothing depends on GitHub or that account.

## The pathway

```
<vault>\GitHub Live\Repositories\rabbitsoftware-io\<repo>     (34 full-history mirrors, never changed)
        │  scripts/github-bundles.py   (rabbitsoftware-cloudflare)   one verified git bundle per repo + manifest.json
        ▼
%LOCALAPPDATA%\RabbitOS\github-bundles\<owner>\<repo>.bundle
        │  Backup-GithubMirrors.ps1    (rabbit-web)                  gcloud storage rsync, nothing deleted
        ▼
gs://rabbitsoftware-io-vault-private/github-bundles/               private, versioned
        │  Restore-GithubMirror.ps1                                 size + SHA-256 checked against the manifest, then git clone
        ▼
a normal working folder (no GitHub, no account)
```

- Scheduled task **RabbitOS GitHub Mirrors to Google Cloud**: daily 03:00, 1 hour limit. Repos whose refs did not change are skipped. **RabbitOS GitHub Vault Sync** (the org-admin sync) is disabled, not deleted.
- `manifest.json` records, per repo: head commit, commit count, refs digest, bytes, SHA-256, and one root hash over all bundles.
- Taken on 2026-10-17: 31 repos bundled (1.47 GB). `MaxwellDNA` and `-rabbit-web` are empty on GitHub (no commits), so there is nothing to bundle.

```powershell
pwsh -File scripts\powershell\Backup-GithubMirrors.ps1 -WhatIf     # plan
pwsh -File scripts\powershell\Backup-GithubMirrors.ps1             # bundle + upload
pwsh -File scripts\powershell\Restore-GithubMirror.ps1 -List       # what is in the cloud
pwsh -File scripts\powershell\Restore-GithubMirror.ps1 -Repo Maxwell-blockchain -Target C:\Users\odaat\Projects\Maxwell-blockchain
```

Tested: a restore of `Maxwell-blockchain` from the cloud copy had the same head commit (`bdfcc1d4`) as the original mirror.

## What exists only in these mirrors

12 of the 34 repos also exist under `therealsickonechase-bit` (rabbit-web, rabbitsoftware-cloudflare, research-agents, chat-scripts, dna-chain, email-app, rabbitos-vault, ...). The other 22 do not:

| Repo | Contents |
|---|---|
| `Maxwell-blockchain` | one zip, the August 2026 full-stack package: ~40 Python modules (ClinVar adapter, VCF parser, trial matcher, CRISPR design, pedigree privacy, research consent, beacon API, storage backend, dashboards, audits) with tests and reports. None of those files exist in the current projects. |
| `brainflow`, `ml5-data-and-models`, `ISLES_2022_FT` | forks / datasets (2,454, 685 and 23 files) |
| `vault-local`, `vault-claude`, `vault-libraries`, `vault-agents` | vault content (41,786 / 2,847 / 82 / 77 files) |
| `vault-secrets` | `secrets.7z` (private; kept as the owner chose, in the private bucket only) |
| `-Medical-Satellite-Integration-`, `gprobe`, `nodeweaverapp`, `Lovableai`, and 7 near-empty repos | small projects and placeholders |

## Next steps (not done yet)

- Bring chosen Maxwell package modules into `research-agents` with tests (the package is the starting point; today's `maxwellblockchain.py` does not include them).
- Put chosen mirrors back on GitHub under `therealsickonechase-bit` as **private** repos (needs an explicit go-ahead; it publishes code to a new place).
