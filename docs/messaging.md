# RabbitSoftware messaging guide

> **Update 2026-10-16: the two main repositories are public** (github.com/therealsickonechase-bit/rabbit-web and rabbitsoftware-cloudflare) under UPL-1.0, an OSI-approved open-source license. "Open source" is now accurate for those two repositories only; keep saying "source code is public" and avoid implying the other projects, the data, the vault or the wallet key are open.

> **Status 2026-10-16: donations are OPEN on the site and in the app, but not yet promoted.** Do not push donations in outreach until the checklist below is done (the small round-trip test, the legal and tax stance, privacy page).

For anyone who writes about, presents, or answers questions about RabbitSoftware (the project, at rabbitsoftware.io) and RabbitOS (the hosted workspace, at app.rabbitsoftware.io). The public versions of this material are the pages
[story.html](../../rabbitsoftware-cloudflare/site/story.html), [blockchain.html](../../rabbitsoftware-cloudflare/site/blockchain.html) and [press.html](../../rabbitsoftware-cloudflare/site/press.html). Where this guide and a page differ, the page wins; fix the guide.

## The one idea
**Software you can check, not just trust.** Sources stay attached to answers, personal data stays on your device, and a public record of what changed can be verified by anyone.

## Who it is for
| Audience | What they want to know | Lead with |
|---|---|---|
| Curious researchers and students | Can I explore public biomedical literature with sources, without handing over my files? | RabbitOS opens with no account; every record links to its source; local tools stay local. |
| Developers and technical readers | What is the chain really? Can I check it myself? | The status page, the chain explainer's "check it yourself" steps, the throwaway cloud terminal. **Do not say "open source" while the repositories are private** (checked 2026-10-15: the organisation has no public repos). |
| Blockchain-curious readers | Is this a coin? Is it decentralized? | No coin. A tamper-evident log with Bitcoin timestamps. Plainly not a decentralized public blockchain. |
| Journalists and partners | Who is behind it and what is true? | The press kit: facts, limits, what we do and do not claim, and how to verify. |
| Potential donors | What does my gift do? Is it safe? | Voluntary gifts to hosting and development; not an investment; how to verify the addresses. |

## The story, in the owner's words only
The public story is built from the author page (`about.html`), which the owner reviewed and approved. Use its framing and quote it; do not add claims.
- **Why it exists:** make research easier to explore without making privacy, transparency or access an afterthought.
- **The three principles:** evidence should be traceable; uncertainty should be visible; people choose what happens to their information.
- **The person:** Chase Allen Ringquist, creator and maintainer. His personal reflection is on the author page and is marked as his account, not verified research. Do not restate its ages, medical events or sensor details in marketing.
- **Gap for the owner:** a short first-person note in your own words (a few sentences) for the press kit and the donate page. Nothing here should be written for you.

## Messages (say these)
1. **Check the work.** Every answer keeps its source; every change leaves a record anyone can verify.
2. **Your data stays yours.** Personal data stays on your device; the public chain holds only fingerprints and public records.
3. **Honest about limits.** Research prototypes are labeled; AI summaries are labeled unverified; a timestamp shows when, not whether it is true.
4. **Checkable.** The status page, ledger, Maxwell chain and Bitcoin timestamps are public, so claims can be tested. (Source code is licensed UPL-1.0 but the repositories are private right now; say "licensed", not "open source".)

## Words to use and not use
| Use | Avoid (and why) |
|---|---|
| tamper-evident, publicly checkable | decentralized, trustless, unhackable, immutable (not true: one operator, detectable not impossible) |
| timestamped through Bitcoin | "secured by Bitcoin", "on the Bitcoin blockchain" (only a fingerprint is witnessed) |
| research tooling, not clinical software | cure, diagnose, treat, therapy, "medical-grade" |
| voluntary donation toward running costs | invest, returns, token, coin, presale, "support our crypto" |
| AI summaries are unverified | "AI-verified", "AI-validated" |
| the Maxwell chain mirrors research records | "our blockchain network", "miners" (it has one operator) |
| experimental / prototype | breakthrough, revolutionary, first-ever (unless sourced) |

## Short answers
- **Is it a cryptocurrency?** No. No token, sale or price.
- **Is it decentralized?** No. There is one operator. Copies and Bitcoin timestamps make quiet rewriting detectable.
- **What does Bitcoin do here?** It is an independent witness: a fingerprint of the ledger and Maxwell heads is timestamped through OpenTimestamps.
- **Does it store my health data?** No. Personal data never goes on the public chain; EEG, wearable and lab data stay on your computer.
- **Is it medical software?** No. It does not diagnose, recommend treatment or edit DNA.
- **Who pays for it?** The owner, plus voluntary donations toward hosting and development.

## Before you promote donations (checklist)
- [ ] **Withdrawal tool tested with a small real amount.** The tool is built and checked against published test vectors and the real key (`docs/wallet.md`), but no real funds have moved yet. Do the first small round trip before promoting donations.
- [ ] **A recovery plan.** The wallet key lives in a Google Cloud hardware module and has **no seed phrase**; it cannot be exported or "restored from words". It exists only while the Google project and key version exist, and Google keeps a destroyed key recoverable for 30 days. Decide how to limit that risk (for example sweep larger balances to a hardware wallet you hold yourself, or add a second recovery path).
- [ ] **Legal and tax stance.** Decide what you are (individual or organization), whether donations are taxable income, and whether anything on the page should say more than "not tax-deductible unless this page says so". This is the owner's decision; get advice for your jurisdiction.
- [ ] **Privacy policy updated.** `privacy.html` should mention the donate page, that addresses are public, and what the site does and does not log. (Already on the owner's to-do list.)
- [ ] **A line on how funds are used,** and a promise to keep it true. Optional: a short yearly note.
- [ ] **Contact and reporting paths work** (contact@rabbitsoftware.io, reporting.html).
- [ ] **RabbitOS app deployed** so the donate card and page exist there too.

## Content ideas (each must be checkable against a source)
1. "How to verify the RabbitSoftware ledger in five minutes" (the chain page's steps, with screenshots).
2. "What a Bitcoin timestamp does and does not prove" (explain OpenTimestamps with a real proof from the anchor index).
3. "Why our AI summaries are labeled unverified" (the policy and an example).
4. "A tour of the status page" (what each light means, including the research line).
5. "Running the research agents locally" (setup guide and what stays on your machine).
6. "Where the money goes" (once there is something real to report).

## Facts the owner still has to supply
- A first-person paragraph for the press kit.
- Public social handles and a newsletter address, if any.
- Whether an organization exists, and its name, for the footer and the donate page.
- Any partners, citations or press you want listed (only with their permission).
