import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Pages anyone may open without being signed in (the account forms and the emailed-link landing page).
const PUBLIC_PATHS = ['/login', '/signup', '/forgot-password', '/auth/confirm', '/guide']
const isPublicPath = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const path = request.nextUrl.pathname

  // These endpoints authenticate with their own request signature, not a user session.
  if (path.startsWith('/api/ingest') || path.startsWith('/api/auth/send-email')) return supabaseResponse
  // Public, read-only feed for rabbitsoftware.io (public literature titles, counts and chain heads only).
  if (path === '/api/public/research-feed') return supabaseResponse

  // Refresh session if expired
  const { data: { user } } = await supabase.auth.getUser()

  if (!user && !isPublicPath(path)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Signed in but never confirmed their email: clear the session and send them to the login page.
  // Who may see what (owner vs member) is enforced by the database, not here.
  if (user && !user.email_confirmed_at) {
    await supabase.auth.signOut({ scope: 'local' })
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = '?error=unconfirmed'
    const rejected = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((c) => rejected.cookies.set(c))
    return rejected
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
