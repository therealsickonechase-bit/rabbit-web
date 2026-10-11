import { redirect } from 'next/navigation'

// Sign-in and sign-up are one passwordless form now.
export default function SignUpPage() {
  redirect('/login')
}
