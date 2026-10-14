// Maxwell chain block validation for the public ledger mirror. Pure, no imports, so Node tests and chain-ledger.ts can load it.
//
// A Maxwell block is { index, timestamp, transactions[], previous_hash, nonce, hash } and nothing else. The mirror is a copy of
// the owner's public-safe Maxwell chain, NOT consensus: the server checks shape, size and linkage, not proof of work.
// (The Python side, research-agents/maxwell_chain_sync.py, recomputes each block hash before it sends anything.)

export const MAXWELL_TABLE = 'maxwell_chain'
export const MAXWELL_ZERO = '0'.repeat(64)
export const MAXWELL_KEYS = ['index', 'timestamp', 'transactions', 'previous_hash', 'nonce', 'hash'] as const
export const MAX_BLOCK_BYTES = 20_000
export const MAX_TRANSACTIONS = 20
export const MAX_TX_FIELDS = 12
export const MAX_TX_STRING = 1_000
export const MAX_INDEX = 1_000_000_000

/** Same pattern as FORBIDDEN_KEY in chain-ledger.ts (a test keeps the two equal). Maxwell keys that match are refused, not silently dropped. */
export const MAXWELL_FORBIDDEN = /subject_name|subject_dob|^dob$|date_of_birth|contact_record|api_key|key_hash|key_prefix|user_setting|guest_pass|passcode|password|secret|encrypted|private_key|ciphertext/i

const HEX64 = /^[0-9a-f]{64}$/
const TX_KEY = /^[A-Za-z0-9_]{1,40}$/

export interface MaxwellBlock {
  index: number
  timestamp: number
  transactions: Record<string, string | number>[]
  previous_hash: string
  nonce: number
  hash: string
}

export type BlockCheck = { ok: true; block: MaxwellBlock } | { ok: false; reason: string }

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const safeInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max

/** Strict check. Returns a fresh object holding only the six allowed keys. */
export function validateMaxwellBlock(input: unknown): BlockCheck {
  if (!isPlain(input)) return { ok: false, reason: 'block must be an object' }
  const keys = Object.keys(input)
  for (const k of keys) if (!(MAXWELL_KEYS as readonly string[]).includes(k)) return { ok: false, reason: `unexpected field ${k.slice(0, 40)}` }
  for (const k of MAXWELL_KEYS) if (!(k in input)) return { ok: false, reason: `missing field ${k}` }
  const b = input
  if (!safeInt(b.index, MAX_INDEX)) return { ok: false, reason: 'index must be a whole number from 0' }
  if (typeof b.timestamp !== 'number' || !Number.isFinite(b.timestamp) || b.timestamp < 0) return { ok: false, reason: 'timestamp must be a non-negative number' }
  if (!safeInt(b.nonce)) return { ok: false, reason: 'nonce must be a whole number from 0' }
  if (typeof b.previous_hash !== 'string' || !HEX64.test(b.previous_hash)) return { ok: false, reason: 'previous_hash must be 64 lowercase hex characters' }
  if (typeof b.hash !== 'string' || !HEX64.test(b.hash)) return { ok: false, reason: 'hash must be 64 lowercase hex characters' }
  if (!Array.isArray(b.transactions)) return { ok: false, reason: 'transactions must be a list' }
  if (b.transactions.length > MAX_TRANSACTIONS) return { ok: false, reason: `at most ${MAX_TRANSACTIONS} transactions per block` }
  const txs: Record<string, string | number>[] = []
  for (const t of b.transactions) {
    if (!isPlain(t)) return { ok: false, reason: 'a transaction must be an object' }
    const tk = Object.keys(t)
    if (tk.length > MAX_TX_FIELDS) return { ok: false, reason: `at most ${MAX_TX_FIELDS} fields per transaction` }
    const out: Record<string, string | number> = {}
    for (const k of tk) {
      if (!TX_KEY.test(k)) return { ok: false, reason: 'transaction field names must be letters, digits or underscore' }
      if (MAXWELL_FORBIDDEN.test(k)) return { ok: false, reason: `transaction field ${k} is not allowed on the public ledger` }
      const v = t[k]
      if (typeof v === 'string') {
        if (v.length > MAX_TX_STRING) return { ok: false, reason: `transaction field ${k} is too long` }
        out[k] = v
      } else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
      else return { ok: false, reason: `transaction field ${k} must be a string or a number` }
    }
    txs.push(out)
  }
  if (b.index === 0 && b.previous_hash !== MAXWELL_ZERO) return { ok: false, reason: 'block 0 must follow the all-zero hash' }
  const block: MaxwellBlock = { index: b.index, timestamp: b.timestamp, transactions: txs, previous_hash: b.previous_hash, nonce: b.nonce, hash: b.hash }
  if (new TextEncoder().encode(JSON.stringify(block)).length > MAX_BLOCK_BYTES) return { ok: false, reason: `block is larger than ${MAX_BLOCK_BYTES} bytes` }
  return { ok: true, block }
}
