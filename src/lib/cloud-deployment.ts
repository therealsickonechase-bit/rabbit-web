export function cloudDeployment(mode: string | undefined) {
  if (mode === 'cloud-supabase') return { name: 'rabbit-web-cloud-supabase', accessMode: 'supabase' as const, isolated: true as const }
  if (mode === 'cloud-access') return { name: 'rabbit-web-cloud-access', accessMode: 'cloudflare-access' as const, isolated: true as const }
  if (mode === undefined || ['production', 'development', 'local-primary'].includes(mode)) {
    return { name: 'rabbit-web', accessMode: 'local-only' as const, isolated: false as const }
  }
  throw new Error('Unknown deployment mode. Use local-primary, cloud-supabase or cloud-access; no auth fallback is allowed.')
}
export const accessApplication = {
  CLOUD_TOOLS_ACCESS_ISSUER: 'https://rsi-helloworld.cloudflareaccess.com',
  CLOUD_TOOLS_ACCESS_AUD: 'c54bc88d3c2d9dacfda3c613f4c8c029a5c0220263524fd4f0fde66968e6581a',
}
// Public entry points of the deployed isolated consoles. The local-only main console links here instead of proxying.
export const ownerConsoles = [
  { accessMode: 'supabase', label: 'Supabase sign-in console', url: 'https://rabbit-web-cloud-supabase.rabbitsoftware-gateway.workers.dev/cloud-login' },
  { accessMode: 'cloudflare-access', label: 'Cloudflare Access console', url: 'https://rabbit-web-cloud-access.rabbitsoftware-gateway.workers.dev/cloudshell' },
] as const
const emptyPolicy = {
  CLOUD_TOOLS_ALLOWED_EMAILS: '',
  CLOUD_TOOLS_AGENT_ID: 'local-vault-agent',
  CLOUD_TOOLS_AGENT_SCOPES: 'shell.execute,vault.submit,vault.read',
  CLOUD_TOOLS_ACCESS_ISSUER: process.env.CLOUD_TOOLS_ACCESS_ISSUER ?? accessApplication.CLOUD_TOOLS_ACCESS_ISSUER,
  CLOUD_TOOLS_ACCESS_AUD: process.env.CLOUD_TOOLS_ACCESS_AUD ?? accessApplication.CLOUD_TOOLS_ACCESS_AUD,
  CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME: process.env.CLOUD_TOOLS_ACCESS_AGENT_COMMON_NAME ?? '',
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  RABBIT_CLOUDSHELL_URL: 'https://rabbitsoftware-cloudshell.rabbitsoftware-gateway.workers.dev',
  VAULT_AGENT_URL: process.env.VAULT_AGENT_URL ?? '',
  VAULT_AGENT_ROOTS: 'Cloud Agents/Knowledge/,Agents/,Workers/',
}

// Edit each instance's nonsecret policy separately after operator approval.
export const cloudConsolePolicies = {
  supabase: { ...emptyPolicy, CLOUD_TOOLS_ALLOWED_EMAILS: 'ringquistchase@gmail.com' },
  'cloudflare-access': { ...emptyPolicy, CLOUD_TOOLS_ALLOWED_EMAILS: 'ringquistchase@gmail.com' },
}
