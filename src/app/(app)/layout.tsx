import { notFound } from 'next/navigation'

// Public paths are rewritten to /workspace. Legacy account pages must never run.
export default function LegacyAccountLayout(): never {
  notFound()
}
