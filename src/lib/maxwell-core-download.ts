// The Maxwell Core download shown on the RabbitOS downloads page. The file itself lives on rabbitsoftware.io; the version and checksum are read from a small
// "latest" file published next to it, so this page cannot drift from the real download. Pure functions, tested.

export const CORE_SITE = 'https://rabbitsoftware.io'
export const CORE_LATEST_URL = `${CORE_SITE}/downloads/maxwell-core-latest.json`

export type CoreLatest = { version: string; file: string; sha256: string; bytes: number; url: string; page: string }

/** Accepts only a well-formed pointer to a zip on rabbitsoftware.io; anything else returns null and the page shows a plain link instead. */
export function parseCoreLatest(raw: unknown): CoreLatest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const { version, file, sha256, bytes } = r
  if (typeof version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) return null
  if (typeof file !== 'string' || file !== `maxwell-core-${version}.zip`) return null
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1 || bytes > 50 * 1024 * 1024) return null
  return { version, file, sha256, bytes, url: `${CORE_SITE}/downloads/${file}`, page: `${CORE_SITE}/maxwell-core` }
}

export async function fetchCoreLatest(fetchImpl: typeof fetch = fetch): Promise<CoreLatest | null> {
  try {
    const res = await fetchImpl(CORE_LATEST_URL, { signal: AbortSignal.timeout(8000), next: { revalidate: 300 } } as RequestInit)
    return res.ok ? parseCoreLatest(await res.json()) : null
  } catch { return null }
}

export type CorePlatform = { id: string; name: string; note: string; steps: string[] }

/** What to do on each system, after unzipping. Mirrors rabbitsoftware.io/maxwell-core. */
export const CORE_PLATFORMS: readonly CorePlatform[] = [
  { id: 'raspberry-pi', name: 'Raspberry Pi', note: 'Pi 3, 4, 5 or Zero 2 W with a 64-bit OS. Tested on emulated 64-bit ARM; not yet on physical Pi hardware.',
    steps: ['cd platforms/raspberry-pi', 'sudo ./setup-pi.sh --dry-run', 'sudo ./setup-pi.sh --install-node --name pi-kitchen'] },
  { id: 'linux', name: 'Linux', note: 'Debian, Ubuntu and anything with systemd.', steps: ['cd platforms/linux', 'sudo ./install.sh --dry-run', 'sudo ./install.sh', 'maxwell-cli getblockchaininfo'] },
  { id: 'windows', name: 'Windows', note: 'Windows 10 or 11, current user, no administrator rights. Needs Node.js 22.',
    steps: ['powershell -ExecutionPolicy Bypass -File platforms\windows\install.ps1 -WhatIf', 'powershell -ExecutionPolicy Bypass -File platforms\windows\install.ps1'] },
  { id: 'macos', name: 'macOS', note: 'Not yet tested on a Mac.', steps: ['cd platforms/macos', './install.sh --dry-run', './install.sh'] },
  { id: 'docker', name: 'Docker', note: 'amd64 and arm64.', steps: ['cd platforms/docker', 'docker compose up -d', 'docker compose exec maxwell-core node maxwell-core.mjs cli getblockchaininfo'] },
]

export const CORE_AFTER: readonly string[] = [
  'maxwell-core dashboard         open the desktop dashboard (http://127.0.0.1:8646/); the Maxwell Core icon does the same',
  'maxwell-core status            compare your node with the Google Cloud gateway',
  'maxwell-core open cloudshell   open the RabbitOS cloud shell',
  'maxwell-core open core         open the live view: research, networks, data and agents',
]

export const checksumCommands = (file: string) => ({
  windows: `Get-FileHash .\${file} -Algorithm SHA256`,
  linux: `sha256sum ${file}`,
  macos: `shasum -a 256 ${file}`,
})
