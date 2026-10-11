// Writes public/_headers (Cloudflare static-asset headers) from src/lib/security-headers.ts, so pages and static files share one definition.
//   node scripts/write-static-headers.mjs
import { writeFileSync } from 'node:fs'
import { staticHeadersFile } from '../src/lib/security-headers.ts'

writeFileSync(new URL('../public/_headers', import.meta.url), staticHeadersFile())
console.log('wrote public/_headers')
