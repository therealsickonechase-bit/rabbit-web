// Only these email addresses may use the console (comma-separated DASHBOARD_ALLOWED_EMAILS).
// Exact match after trimming and lower-casing; an empty or missing list allows nobody.
export function isAllowedDashboardEmail(
  email: string | undefined,
  allowedEmails = process.env.DASHBOARD_ALLOWED_EMAILS ?? ''
) {
  if (!email) {
    return false
  }

  const normalizedEmail = email.trim().toLowerCase()
  const allowlist = allowedEmails
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  return allowlist.includes(normalizedEmail)
}
