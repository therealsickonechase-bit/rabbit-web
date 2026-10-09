import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  // The ingest endpoint authenticates with its own request signature, not a user session.
  if (request.nextUrl.pathname.startsWith('/api/ingest')) return supabaseResponse

  // Refresh session if expired
  const { data: { user } } = await supabase.auth.getUser()

  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
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
