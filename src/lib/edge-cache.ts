// A small Worker-side cache for the public, read-only API routes.
//
// Why not just a Cloudflare Cache Rule: these routes echo the caller's Origin in Access-Control-Allow-Origin and send "Vary: Origin", and the
// Cloudflare CDN cache ignores Vary: Origin, so a plain rule could serve one website's CORS header to another. Here the cache key is the URL
// plus a "variant" (the allowed origin, or empty), so each origin gets its own copy.
//
// Only successful (200) responses that already ask for shared caching (they carry s-maxage) are stored. Anything else, and any request
// when the cache is not available (local development, tests), simply runs the normal handler.

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

const ORIGINAL = 'X-Original-Cache-Control'

/** The Workers cache (caches.default) when it exists. */
export function workerCache(): CacheLike | null {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches
  return c?.default ?? null
}

export async function edgeCached(request: Request, variant: string, ttlSeconds: number, build: () => Promise<Response>, cache: CacheLike | null = workerCache()): Promise<Response> {
  if (!cache || request.method !== 'GET') return build()
  const u = new URL(request.url)
  u.searchParams.set('__variant', variant)                                  // part of the cache key only; never sent anywhere
  const key = new Request(u.toString(), { method: 'GET' })

  try {
    const hit = await cache.match(key)
    if (hit) {
      const h = new Headers(hit.headers)
      const original = h.get(ORIGINAL)
      if (original) h.set('Cache-Control', original)
      h.delete(ORIGINAL)
      h.set('X-Edge-Cache', 'HIT')
      return new Response(hit.body, { status: hit.status, headers: h })
    }
  } catch { /* a cache failure must never break the API */ }

  const res = await build()
  const cc = res.headers.get('Cache-Control') ?? ''
  if (res.status === 200 && /s-maxage/i.test(cc)) {
    try {
      const copy = res.clone()
      const h = new Headers(copy.headers)
      h.set(ORIGINAL, cc)
      h.set('Cache-Control', `public, max-age=${ttlSeconds}`)             // how long the Workers cache keeps it
      await cache.put(key, new Response(copy.body, { status: 200, headers: h }))
    } catch { /* ignore */ }
  }
  const out = new Headers(res.headers)
  out.set('X-Edge-Cache', 'MISS')
  return new Response(res.body, { status: res.status, headers: out })
}
