import { redirect } from 'next/navigation'
import { getSessionRole } from '@/lib/auth/session'

export default async function Home() {
  const { isOwner } = await getSessionRole()
  redirect(isOwner ? '/dashboard' : '/research')
}
