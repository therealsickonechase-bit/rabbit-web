import { NextResponse, type NextRequest } from 'next/server'
import { machineApi, publicApiAllowed, workspaceSection } from '@/lib/account-free'

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, '') || '/'
  const method = request.method
  if (path.startsWith('/api/')) {
    if (publicApiAllowed(path, method) || machineApi(path)) return NextResponse.next()
    return NextResponse.json(
      { error: 'Account services are disabled. Existing private data is not available in the account-free workspace.' },
      { status: 410, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return NextResponse.json({ error: 'Account actions are disabled.' }, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } })
  }
  if (['/login', '/signup', '/guest', '/members', '/guests', '/keys'].includes(path) || path.startsWith('/auth/')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }
  const section = workspaceSection(path.slice(1))
  if (section || path === '/') {
    const url = request.nextUrl.clone()
    url.pathname = `/workspace/${section ?? 'dashboard'}`
    return NextResponse.rewrite(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb)$).*)'],
}
