// In-silico CRISPR helpers for the explorer. Text-only: nothing here designs a lab procedure.
//
// Facts used: SpCas9 reads a 20-nt protospacer followed by an NGG PAM and cuts the DNA 3 bases before the PAM
// (between protospacer positions 17 and 18). Real repair outcomes vary a lot; the edits below are the simplest
// textbook cases (delete n bases, insert bases at the cut) and are for illustration.

export interface GuideRow {
  id: string
  meta: { transcript: string; strand: string; position: number; guide: string; pam: string } & Record<string, unknown>
}

/** SHA-256 over the guides in the same one-line-per-guide format crispr_data.py logs to the audit chain. */
export async function guideDigest(rows: GuideRow[]) {
  const lines = rows
    .map((r) => `${r.id}|${r.meta.transcript}|${r.meta.strand}|${r.meta.position}|${r.meta.guide}|${r.meta.pam}`)
    .sort()
  const bytes = new TextEncoder().encode(lines.join('\n'))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const GUIDE_LEN = 20
export const CUT_AFTER = 17   // the cut falls between protospacer index 16 and 17 (0-based), i.e. 3 bases before the PAM

export type Edit = { type: 'none' } | { type: 'delete'; n: number } | { type: 'insert'; bases: string }

export interface EditResult {
  before: string
  after: string
  /** index in `before` where the cut falls */
  cut: number
  /** deleted range in `before` (empty when none) */
  deleted: { start: number; end: number }
  /** inserted range in `after` (empty when none) */
  inserted: { start: number; end: number }
  lengthChange: number
  /** a change of a multiple of 3 keeps the reading frame (only meaningful inside a coding region) */
  keepsFrame: boolean
}

export function validBases(s: string) {
  return /^[ACGT]{1,10}$/.test(s)
}

/** Apply a simple edit at the cut site of a window that has the guide starting at `guideOffset`. */
export function applyEdit(window: string, guideOffset: number, edit: Edit): EditResult {
  const cut = guideOffset + CUT_AFTER
  let after = window
  let deleted = { start: cut, end: cut }
  let inserted = { start: cut, end: cut }
  if (edit.type === 'delete') {
    const n = Math.max(0, Math.min(Math.floor(edit.n), 10, window.length - cut))
    after = window.slice(0, cut) + window.slice(cut + n)
    deleted = { start: cut, end: cut + n }
    inserted = { start: cut, end: cut }
  } else if (edit.type === 'insert') {
    if (!validBases(edit.bases)) throw new Error('Insert 1 to 10 bases from A, C, G, T.')
    after = window.slice(0, cut) + edit.bases + window.slice(cut)
    inserted = { start: cut, end: cut + edit.bases.length }
  }
  const lengthChange = after.length - window.length
  return { before: window, after, cut, deleted, inserted, lengthChange, keepsFrame: lengthChange % 3 === 0 }
}
