// Minimal typing for the one thing the app imports from the Workers runtime. Declared here, not taken
// from .cloudflare/types, because that folder is generated and gitignored.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>
}
