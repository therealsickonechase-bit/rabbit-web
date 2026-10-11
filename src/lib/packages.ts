// Public downloads: checks that run in the owner's browser before a file is made public, and small helpers for the public page. Pure functions, tested.
// Whatever is uploaded becomes visible to the whole internet, so the checks are conservative: only plain data and archive types, a size cap, a
// licence is required, and text files are scanned for things that look like keys or secrets before they leave the computer.

export const MAX_BYTES = 50 * 1024 * 1024          // matches the storage bucket limit set in the migration
export const BUCKET = 'packages'

export const LICENCES = ['CC0-1.0 (public domain)', 'US Government work (public domain)', 'CC-BY-4.0', 'MIT', 'Apache-2.0', 'GPL-3.0-or-later'] as const

/** Archives and plain data/documents. Programs and scripts are not accepted here (put those in a zip and say so in the description). */
export const ALLOWED_EXT = [
  'zip', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz',
  'csv', 'tsv', 'json', 'jsonl', 'txt', 'md', 'pdf',
  'fa', 'fasta', 'fna', 'faa', 'fq', 'fastq', 'gb', 'gbk', 'gff', 'gff3', 'vcf', 'bed', 'sam',
  'png', 'jpg', 'jpeg', 'svg', 'webp',
] as const

const BLOCKED_NAME = /(^|[\\/])(\.env(\..*)?|id_rsa|id_ed25519|credentials|secrets?\.[a-z]+|.*\.(pem|key|p12|pfx|kdbx))$/i
const TEXT_EXT = new Set(['csv', 'tsv', 'json', 'jsonl', 'txt', 'md', 'fa', 'fasta', 'fna', 'faa', 'gb', 'gbk', 'gff', 'gff3', 'vcf', 'bed', 'svg'])

export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')

/** A safe object name: letters, digits, dot, dash, underscore; no paths. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').replace(/_{2,}/g, '_').slice(0, 120)
  return cleaned || 'package'
}

export const humanSize = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)

export interface FileCheck { ok: boolean; problems: string[]; warnings: string[] }

export function checkFile(name: string, size: number): FileCheck {
  const problems: string[] = [], warnings: string[] = []
  const ext = extOf(name)
  if (BLOCKED_NAME.test(name)) problems.push('This file name looks like a key, credential or settings file. It is never published.')
  if (!(ALLOWED_EXT as readonly string[]).includes(ext)) problems.push(`.${ext || '(none)'} files are not accepted. Allowed: ${ALLOWED_EXT.join(', ')}.`)
  if (size <= 0) problems.push('The file is empty.')
  if (size > MAX_BYTES) problems.push(`The file is ${humanSize(size)}; the limit is ${humanSize(MAX_BYTES)}.`)
  if (['zip', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'].includes(ext)) warnings.push('Archives cannot be scanned here. Open it yourself first and make sure it holds nothing private (keys, .env files, personal or medical data).')
  return { ok: problems.length === 0, problems, warnings }
}

/** Things that look like secrets or personal identifiers. Names only (never the matched text) so the message cannot leak the secret. */
const SECRET_PATTERNS: [string, RegExp][] = [
  ['a Supabase secret key (sb_secret_...)', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['an Anthropic or OpenAI style key (sk-...)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['a Hugging Face token (hf_...)', /\bhf_[A-Za-z0-9]{20,}/],
  ['a GitHub token', /\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a signed token (JWT)', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['a password or secret assignment', /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9/+_-]{12,}/i],
  ['an email address', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ['a US social security number', /\b\d{3}-\d{2}-\d{4}\b/],
]

export function scanText(text: string): string[] {
  const found: string[] = []
  for (const [label, rx] of SECRET_PATTERNS) if (rx.test(text)) found.push(label)
  return found
}

export const isTextFile = (name: string) => TEXT_EXT.has(extOf(name))

export interface PackageMeta { title: string; description: string; licence: string }

export function checkMeta(m: PackageMeta): string[] {
  const out: string[] = []
  if (m.title.trim().length < 3 || m.title.length > 120) out.push('Title must be 3 to 120 characters.')
  if (m.description.trim().length < 10 || m.description.length > 2000) out.push('Description must be 10 to 2000 characters.')
  if (!(LICENCES as readonly string[]).includes(m.licence)) out.push('Choose a licence.')
  return out
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Public download address. `?download=` makes the storage service send the file as an attachment, so a browser never renders it as a page. */
export function publicUrl(supabaseUrl: string, path: string, downloadName: string) {
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}?download=${encodeURIComponent(downloadName)}`
}
