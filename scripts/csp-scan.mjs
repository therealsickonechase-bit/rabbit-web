// CSP scan: loads each app page in a real browser (Microsoft Edge, headless) and lists every Content-Security-Policy violation the page reports. GET only, clicks nothing.
//   npm install playwright-core --no-save      (once; it is not a dependency of the app)
//   BASE=https://app.rabbitsoftware.io PAGES=/dashboard,/brain node scripts/csp-scan.mjs     (Git Bash on Windows: prefix MSYS_NO_PATHCONV=1 when passing PAGES)
// Zero violations on a page means its policy can be enforced (add it to ENFORCED_CSP_PATHS in src/lib/security-headers.ts). Needs Edge or set EDGE_PATH.
const { chromium } = await import('playwright-core').catch(() => { console.error('Install it first: npm install playwright-core --no-save'); process.exit(2) })

const BASE = process.env.BASE || 'https://app.rabbitsoftware.io'
const PAGES = (process.env.PAGES || '/dashboard,/research,/ask,/brain,/twin,/connections,/memory,/crispr,/collections,/tasks,/agents,/chain,/ledger,/data,/cloudshell-public,/commands,/downloads,/guide,/login').split(',')
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const results = []
for (const path of PAGES) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const violations = []
  const consoleErrors = []
  await page.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ directive: e.effectiveDirective, blocked: String(e.blockedURI).slice(0, 120), disposition: e.disposition, sample: String(e.sample || '').slice(0, 60) }))
  })
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 140)) })
  let status = 0
  try {
    const r = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 })
    status = r ? r.status() : 0
    await page.waitForTimeout(2500)
    violations.push(...await page.evaluate(() => window.__csp).catch(() => []))
  } catch (e) { consoleErrors.push('load: ' + String(e.message).slice(0, 100)) }
  results.push({ path, status, violations, consoleErrors: consoleErrors.filter((t) => /Content Security|Refused|violat/i.test(t)).slice(0, 5), otherErrors: consoleErrors.length })
  await context.close()
}
await browser.close()
for (const r of results) {
  const uniq = [...new Map(r.violations.map((v) => [v.directive + '|' + v.blocked, v])).values()]
  console.log(`${r.path.padEnd(20)} ${r.status}  violations: ${uniq.length}${r.otherErrors ? `  (other console errors: ${r.otherErrors})` : ''}`)
  for (const v of uniq.slice(0, 6)) console.log(`     ${v.disposition}  ${v.directive}  <- ${v.blocked}${v.sample ? '  [' + v.sample + ']' : ''}`)
}
