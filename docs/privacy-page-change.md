# Privacy page change for rabbitsoftware.io/privacy.html

Apply this to the **source** `privacy.html` of the site (not the HTML served by Cloudflare, which has email
addresses rewritten and scripts injected). It uses the page's own markup: plain `<h2>` and `<p>`.

**Status: draft. Not legal advice.** Have it reviewed for the places your visitors live (for example the EU/UK
GDPR and California's CCPA) before sign-up opens. Items in `[square brackets]` are decisions for you.

It is accurate to what the console does today. If the console changes, change the wording with it.

---

## 1. Three small edits to existing text

**a. The scope sentence** (first paragraph). Find:

```
This policy covers the website and its hosted research tools, not the unrecovered original application.
```
Replace with:
```
This policy covers the website, its hosted research tools, and the separate RabbitOS console described below, not the unrecovered original application.
```

**b. "Links and local tools"**, in the CLI paragraph. Find:

```
The CLI does not log a user into this website, which has no direct account login.
```
Replace with:
```
The CLI does not log a user into this website. The website's public pages have no account login; the separate RabbitOS console, described below, does.
```

**c. The effective date** in the eyebrow line (`Website privacy policy / effective October 8, 2026`): change it to the date
sign-up opens. Optionally widen the meta description to mention accounts.

---

## 2. New section: insert before "Original policy and questions"

```html
    <h2>RabbitOS console accounts</h2>
    <p>The RabbitOS console is a separate application at app.rabbitsoftware.io. It is the only part of this site that has accounts. Creating an account is optional and is not needed to read this website.</p>
    <p>What we collect. When you create an account we collect your email address and a password. Your password is stored only as a one-way hash, so we cannot read it. We also record when you created the account and when you last signed in. Your account is stored with Supabase, and the messages we send you are delivered through Cloudflare.</p>
    <p>What we use it for. To run your account, to send you the messages you ask for (confirming your email address and resetting your password), and to keep the service secure. We send no marketing email. We do not sell your information.</p>
    <p>Cookies. Signing in sets a session cookie so you stay signed in. It is needed for the console to work. The console sets no advertising cookies. Cloudflare may apply security checks or analytics configured by the site owner, as described above.</p>
    <p>Bot check. The sign-in and account forms use Cloudflare Turnstile to tell people from automated programs. Cloudflare processes information about your browser and connection to do this, under its own policy.</p>
    <p>Summaries and your Anthropic key. Summaries are optional. To use them you give us your own Anthropic API key. We store it encrypted, never show it back to you, and use it only to send the stored public research records for a topic to Anthropic when you press Summarize. Anthropic's policy applies to that request, and the cost is billed to your Anthropic account. The summary is saved to the console's research library, can be read by other signed-in members, and records which account requested it. It contains AI-generated text about public records, not your personal data. Summaries are limited to 20 per account per day. You can remove your key at any time in Settings.</p>
    <p>Contact record. We also keep an encrypted copy of your email address as a contact record. It exists so that we can respond to a valid legal request, such as a court order about illegal activity, and for no other purpose. It is encrypted to a key held only by the site owner. The console cannot read it back, and each time one is opened the access is logged with a reason and the legal reference. If you delete your account, we keep the contact record for 12 months and then remove it. We may also disclose information where the law requires it or where it is needed to protect someone from serious harm.</p>
    <p>Who can see what. Members can read the public research library. Members cannot see the site owner's personal or sensor data, and cannot see other members. The site owner can see a list of accounts, with email addresses, join dates, last sign-in, and whether each email is confirmed. Server error logs are kept free of email addresses and tokens.</p>
    <p>Keeping it. We keep your account details while your account exists. To delete your account, correct your details, or ask what we hold about you, email contact@rabbitsoftware.io; we aim to reply within [30 days]. The console is not intended for children under [16, or the age your lawyer advises].</p>
    <p>Provider policies: <a href="https://supabase.com/privacy">Supabase</a>, <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare</a>, and <a href="https://www.anthropic.com/legal/privacy">Anthropic</a>. Applicable rights depend on your jurisdiction and the relevant provider.</p>
```

---

## 3. Other pages that say "no account login"

These statements are about the public website and its tools, so they stay true, but a reader could now be confused.
Consider adding "(the separate RabbitOS console has accounts)" or a link to the new section:

- `recovery.html`: "the website itself has no account login", and "does not log in to accounts".
- `index.html`: "The website does not log in to accounts" (in the chain tools text).

## 4. Things to decide before publishing
- `[30 days]` reply time and `[16]` minimum age.
- Whether 12 months is the right retention for a closed account's contact record (it is also set in the database
  migration and `docs/legal-requests.md`; change all three together).
- Whether to name Anthropic's current privacy URL after checking it is still correct.
