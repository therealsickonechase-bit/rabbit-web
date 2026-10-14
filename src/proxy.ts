import { NextResponse, type NextRequest } from 'next/server'
import { legacyRedirect, machineApi, pageMethodAllowed, publicApiAllowed } from '@/lib/account-free'
import { ownerCloudApi } from '@/lib/cloud-jobs'

// Open access: pages are served directly, no login. Only the APIs listed in account-free.ts are reachable;
// ingest and agent endpoints keep their own signed/machine auth.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, '') || '/'
  const method = request.method
  if (path.startsWith('/api/')) {
    if (publicApiAllowed(path, method) || machineApi(path) || ownerCloudApi(path, method)) return NextResponse.next()
    return NextResponse.json(
      { error: 'This endpoint is not available.' },
      { status: 410, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  if (legacyRedirect(path)) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url, method === 'GET' || method === 'HEAD' ? 307 : 303)
  }
  if (!pageMethodAllowed(path, method)) {
    return NextResponse.json({ error: 'Method not allowed.' }, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb)$).*)'],
}
