// Security headers for every response the console sends. Pure data, tested in tests/security-headers.test.mjs; next.config.ts applies it.
//
// Enforced everywhere: HSTS, nosniff, no framing, referrer policy, permissions policy.
// Content-Security-Policy: ENFORCED on the public pages (ENFORCED_CSP_PATHS), which were loaded in a real browser and produced no violations,
// and Report-Only everywhere else: the signed-in pages use inline scripts, Supabase, Hugging Face, GitHub and WebSockets to services on the
// visitor's own computer and cannot be exercised automatically, so violations are shown in the browser console instead of breaking anything.
// When the console stays quiet while using Brain Network, add the remaining paths to ENFORCED_CSP_PATHS or switch CSP_HEADER.

export interface HeaderRule { key: string; value: string }

/** Where the page may load things from and connect to. Keep every entry justified by a feature. */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  // inline scripts: the page payload; Turnstile: the sign-in check; wasm-unsafe-eval: WebAssembly (3D and signal processing)
  // static.cloudflareinsights.com: Cloudflare Web Analytics, which Cloudflare adds to every page (found by loading the live pages in a browser)
  'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com'],
  'style-src': ["'self'", "'unsafe-inline'"],
  // illustrations arrive as data: URLs, pictures from the Hugging Face Space as https, exports as blob:
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'media-src': ["'self'", 'blob:', 'data:'],
  'connect-src': [
    "'self'",
    'https://*.supabase.co', 'wss://*.supabase.co',           // sign-in session, storage, realtime
    'https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.space', 'wss://*.hf.space',   // the image Space (gradio client)
    'https://raw.githubusercontent.com',                       // the Michelle avatar model
    'ws://127.0.0.1:*', 'ws://localhost:*',                    // EEG bridge, data hub, WiFi bridge, twin relay on this computer
    'wss:',                                                    // a twin relay behind TLS
    'https://cloudflareinsights.com',                          // where the Web Analytics beacon reports
  ],
  'frame-src': ['https://challenges.cloudflare.com'],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
}

export const cspValue = (d: Record<string, string[]> = CSP_DIRECTIVES) => Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ')

/** Report-Only for now. Change to 'Content-Security-Policy' once the browser console shows no violations. */
export const CSP_HEADER = 'Content-Security-Policy-Report-Only'

/** Public pages where the CSP is enforced (not just reported). Each was loaded in a headless browser with no violations. */
export const ENFORCED_CSP_PATHS = ['/login', '/signup', '/guide', '/guest', '/auth/confirm']

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()'

export function securityHeaders(): HeaderRule[] {
  return [
    // one year; no includeSubDomains or preload on purpose, so other subdomains are not affected
    { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
    { key: CSP_HEADER, value: cspValue() },
  ]
}

/** What next.config.ts applies: everything everywhere, plus the enforced CSP on the public pages. (Both CSP headers can be present on those pages; they carry the same policy.) */
export function nextHeaderRules(): { source: string; headers: HeaderRule[] }[] {
  return [
    { source: '/:path*', headers: securityHeaders() },
    ...ENFORCED_CSP_PATHS.map((source) => ({ source, headers: [{ key: 'Content-Security-Policy', value: cspValue() }] })),
  ]
}

/** The `_headers` file for static files, which do not go through the app. CSP is left to the page responses.
 *  vinext writes its own `_headers` (one-year immutable caching for hashed files under /_next/static/) and a file in `public/` REPLACES it, so that rule
 *  must be repeated here. Without it every visit revalidated every script (seen on 2026-10-11 after the first headers deploy). */
export const STATIC_CACHE_RULE = ['/_next/static/*', '  Cache-Control: public, max-age=31536000, immutable']

export function staticHeadersFile(): string {
  const rules = securityHeaders().filter((h) => !h.key.startsWith('Content-Security-Policy'))
  return [
    '# Static file headers. Generated from src/lib/security-headers.ts: run `node scripts/write-static-headers.mjs`.',
    '# Hashed build files are cached for a year (the vinext rule, repeated because this file replaces it).',
    ...STATIC_CACHE_RULE,
    '',
    '# Security headers for every static file.',
    '/*',
    ...rules.map((h) => `  ${h.key}: ${h.value}`),
    '',
  ].join(String.fromCharCode(10))
}
