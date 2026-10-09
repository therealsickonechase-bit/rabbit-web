# Connecting rabbitsoftware.io to RabbitOS

RabbitOS exposes one public, read-only feed so the marketing site can show live research and proof of integrity
without signing anyone in.

```
GET https://app.rabbitsoftware.io/api/public/research-feed
```

Cached for 5 minutes. Browsers on `rabbitsoftware.io` and `www.rabbitsoftware.io` may call it (CORS); others
can still call it server-side.

## What it returns
```json
{
  "generated_at": "2026-10-09T12:00:00Z",
  "counts": { "pubmed": 8, "clinvar": 10, "crispr_paper": 5, "crispr_guide": 30, "...": 0 },
  "topics": { "explored": 2, "queued": 3 },
  "chain": { "audit_head_seq": 117, "audit_head_hash": "…", "audit_head_time": "…" },
  "crispr": { "guides": 30, "logged_guides": 30, "guide_digest": "…", "logged_at": "…" },
  "recent": [ { "id": "…", "source": "crispr_paper", "title": "…", "url": "https://…", "first_seen_at": "…" } ]
}
```
Only public literature titles and links, counts, and the audit chain's newest hash. No accounts, chats, notes,
twin data or contact records.

## Drop-in snippet for the site
```html
<section id="live-research" hidden>
  <h2>Live from the research agents</h2>
  <p id="lr-summary"></p>
  <ul id="lr-list"></ul>
  <p><small>Audit chain head: <code id="lr-hash"></code></small></p>
  <a href="https://app.rabbitsoftware.io/signup">Open RabbitOS</a>
</section>
<script>
  fetch('https://app.rabbitsoftware.io/api/public/research-feed')
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d) => {
      const total = Object.entries(d.counts).filter(([k]) => k !== 'crispr_guide').reduce((s, [, n]) => s + n, 0)
      document.getElementById('lr-summary').textContent =
        `${total} research records, ${d.crispr.guides} CRISPR guide candidates, ${d.topics.explored} topics explored.`
      const ul = document.getElementById('lr-list')
      for (const r of d.recent.slice(0, 8)) {
        const li = document.createElement('li')
        const a = document.createElement('a')
        a.textContent = r.title            // textContent, never innerHTML: titles come from outside sources
        if (/^https?:\/\//.test(r.url || '')) a.href = r.url
        li.append(a)
        ul.append(li)
      }
      document.getElementById('lr-hash').textContent = (d.chain.audit_head_hash || '').slice(0, 16) + '…'
      document.getElementById('live-research').hidden = false
    })
    .catch(() => {})   // the section simply stays hidden
</script>
```

## Notes
- Cloudflare Bot Fight Mode is on for the zone. Browser calls pass; scripted callers with an unusual
  User-Agent may be challenged. If the site fetches server-side, send a normal User-Agent.
- If you would rather not make the feed public, delete the route and the one line in `src/proxy.ts`.
