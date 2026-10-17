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

## Done on 2026-10-17

- **Back on GitHub, private.** `Publish-MirrorsToGithub.ps1` created 21 new **private** repositories under `therealsickonechase-bit` and pushed every branch and tag from the mirrors (verified: all private, every head commit matches the mirror). Repos that already existed were skipped, and nothing was overwritten. `MaxwellDNA` and `-rabbit-web` have no commits upstream, so they were not created. Make one public later on GitHub if you want that. The script has `-WhatIf`, `-Only` and `-Exclude`; log in `~\RabbitOS\logs\github-publish-<date>.log`.
- **Maxwell package modules in `research-agents`** (from `Maxwell-blockchain/full_stack_complete_package.zip`, hardened, 9 tests in `test_maxwell_package_modules.py`):
  - `vcf_parser.py` reads standard single-sample VCF files (streams large files, tolerates malformed lines and short ANN fields).
  - `clinvar_adapter.py` turns any NCBI SPDI string into a variant (the original held one hard-coded record).
  - `trial_matcher.py` matches ClinicalTrials.gov records to an age / sex / gene / condition profile (whole-word gene matching, months-based ages).
  - `variant_types.py` holds the shared `Variant` record.
  These handle personal genetic data and a personal profile: no network, no files written, run on the PC only.

## Not brought in yet

About 35 other modules from the package remain in the cloud bundle and the private GitHub repo: `pedigree_privacy`, `research_consent`, `crispr_design`, `beacon_api`, `storage_backend`, `patient_dashboard`, `minhash_similarity`, `external_provider_adapter`, and the audit and test runners. Pick the ones you want next.
