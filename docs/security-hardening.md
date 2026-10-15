# Security hardening checklist

From the 2026-10-15 review of Google Cloud, Cloudflare, Supabase, the repos and the owner's PC. Done in this order. Update the status as each item finishes.

| # | Item | Severity | Status | How / notes |
|---|---|---|---|---|
| 1 | Public Cloud Run services ran as the default compute account (project-wide Editor); `hello-world` unused | High | **done 2026-10-15** | `scripts/powershell/Fix-GcpDefaultAccount.ps1`. Services now run as `rabbit-web-runner` (reads only `supabase-service-role-key`) and `rabbit-standby-runner`; `hello-world` deleted; the default account keeps only `artifactregistry.writer` and `logging.logWriter` (Cloud Build runs as it). A test build passed afterwards. |
| 2 | Data Access audit logs for Cloud KMS (wallet signing) and Secret Manager (secret reads) | Medium | **done 2026-10-15** | `scripts/powershell/Enable-GcpAuditLogs.ps1`. Verified: a real `AsymmetricSign` shows in the `data_access` log with the caller. |
| 3 | Email spoofing: DMARC for rabbitsoftware.io | Medium | **done 2026-10-15 (monitoring stage)** | `_dmarc` TXT `v=DMARC1; p=none; sp=reject; rua=mailto:contact@rabbitsoftware.io; fo=1`. **Follow-up:** after 2-4 weeks of reports, check that legitimate mail passes, then change `p=none` to `p=quarantine`, later `p=reject`. SPF is still `~all`; make it `-all` once you know nothing else sends as the domain. |
| 4 | Cloudflare SSL "full" to "full (strict)"; minimum TLS 1.0 to 1.2 | Medium | **done 2026-10-15** | Zone settings. Verified all sites answer with valid certificates. Undo: set `ssl` to `full` and `min_tls_version` to `1.0` on the zone. |
| 5 | Enforce the app's Content Security Policy (it is report-only) | Lower | waiting for the app deploy | Needs the policy changed in the app and a deploy (held). Review the CSP violation reports first. |
| 6 | SSH/RDP-from-anywhere rules on the unused `default` network | Lower | **done 2026-10-15** | Deleted `default-allow-ssh` and `default-allow-rdp`. Nothing used that network. |
| 7 | Model gateway: quota behind an Origin check | Lower | **reviewed, no change** | Per visitor 20 requests/hour, 500/day for everyone, prompt and output size capped. Residual: the shared daily cap can be used up by one determined user. |
| 8 | Unused or over-broad service accounts | Lower | **done 2026-10-15** | `rabbitos-agent-worker`: unused for 30 days, all project roles removed. `github-deploy`: now `run.developer` + `artifactregistry.writer`, may act only as `rabbit-web-runner`. **Follow-up:** the workflow `deploy-cloud-run.yml` still uses a JSON key stored as the GitHub secret `GCP_CREDENTIALS` (no such key exists on Google's side now; the last runs fail at startup). Delete that secret, or move the workflow to Workload Identity Federation. |
| 9 | `rabbitsoftware-rf-nexus-preview` Worker ("RF Nexus", public) | Lower | needs your decision | Public preview app; delete it if it is stale. |
| 10 | `/api/health` reports `database: down` on `rabbit-web-workerd` (Cloud Run, experimental image) and on the Supabase console Worker | Lower | investigated, not fixed | Proven older than this work: the previous revision of `rabbit-web-workerd` gave the identical 7-second "down". The main app and the mirror report the database fine. A runtime problem in the experimental image, not a security fault. |
| 11 | Proxy VM: Secure Boot and OS Login | Lower | needs a short outage | Enabling Secure Boot means stopping the VM, which interrupts guest terminals. SSH is already identity-aware-proxy only. |
| 12 | Budget alert | Check | **verified** | "RabbitOS monthly budget", $10, alerts at 50%, 90%, 100%. (Billing commands need `--billing-project=rabbitsoftware-io`.) |
| 13 | Vault GitHub repo (in the rabbitsoftware-io organisation) is private | Check | needs you | The `gh` login on this PC is not a member of that organisation. Run it where you are signed in as a member: `gh repo view rabbitsoftware-io/obsidian-rabbitos-vault --json visibility`. |

Verified good (no action): no downloadable service-account keys; no secrets in the repos or their history; Supabase rules match the migrations; private buckets cannot be made public; no public R2 buckets;
DNSSEC on; TLS 1.3 and the standard security headers; owner shell behind Cloudflare Access; visitor shell reaches only the allowlist proxy; wallet key has no signing grants; alert policies and uptime checks active;
PC firewall and BitLocker on.
