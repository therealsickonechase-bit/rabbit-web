// Hormone context for the picture generator: where cortisol and melatonin levels come from, and how they become the words low / typical / high.
//
// Three sources, always labelled: the typical daily pattern read off the clock (a reference, NOT a measurement), levels the person picks, or a CSV
// of values they measured (lab or home test) interpolated to the time of day. Hormones are never estimated from EEG. Only the words leave the page.

import { referenceLevels, type Level } from './body-api.ts'

export interface HormoneRow { hour: number; cortisol: number | null; melatonin: number | null }
export type HormoneSource =
  | { kind: 'clock' }
  | { kind: 'manual'; cortisol: Level; melatonin: Level }
  | { kind: 'csv'; rows: HormoneRow[]; name: string }

const MAX_ROWS = 2000
const hourOf = (text: string): number | null => {
  const t = text.trim()
  if (/^\d+(\.\d+)?$/.test(t)) { const h = Number(t); return h >= 0 && h < 24 ? h : null }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t)
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return Number(m[1]) + Number(m[2]) / 60
  const iso = /T(\d{2}):(\d{2})/.exec(t)
  if (iso && Number(iso[1]) < 24) return Number(iso[1]) + Number(iso[2]) / 60
  return null
}
const value = (text: string | undefined, lo: number, hi: number): number | null | 'bad' => {
  if (text === undefined || text.trim() === '') return null
  const v = Number(text)
  return Number.isFinite(v) && v >= lo && v <= hi ? v : 'bad'
}

/** Parse a CSV with header `time,cortisol,melatonin` (either hormone column may be blank). Cortisol in ug/dL (0-100), melatonin in pg/mL (0-500). */
export function parseHormoneCsv(text: string): { ok: true; rows: HormoneRow[] } | { ok: false; error: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return { ok: false, error: 'The file needs a header row and at least one data row.' }
  if (lines.length > MAX_ROWS + 1) return { ok: false, error: `At most ${MAX_ROWS} rows.` }
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const [ti, ci, mi] = [head.indexOf('time'), head.indexOf('cortisol'), head.indexOf('melatonin')]
  if (ti < 0 || (ci < 0 && mi < 0)) return { ok: false, error: 'The header row must contain "time" and at least one of "cortisol" or "melatonin".' }
  const rows: HormoneRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',')
    const hour = hourOf(cells[ti] ?? '')
    const c = ci >= 0 ? value(cells[ci], 0, 100) : null, m = mi >= 0 ? value(cells[mi], 0, 500) : null
    if (hour === null) return { ok: false, error: `Row ${i + 1}: the time must be an hour like 8.5, HH:MM or an ISO time.` }
    if (c === 'bad' || m === 'bad') return { ok: false, error: `Row ${i + 1}: cortisol must be 0-100 ug/dL and melatonin 0-500 pg/mL.` }
    if (c === null && m === null) continue
    rows.push({ hour, cortisol: c, melatonin: m })
  }
  if (!rows.length) return { ok: false, error: 'No usable rows.' }
  return { ok: true, rows: rows.sort((a, b) => a.hour - b.hour) }
}

/** Linear interpolation of one hormone at an hour; holds the first or last value outside the sampled range. Null when the column is empty. */
export function hormoneAt(rows: HormoneRow[], hour: number, key: 'cortisol' | 'melatonin'): number | null {
  const pts = rows.filter((r) => r[key] !== null).map((r) => [r.hour, r[key] as number] as const)
  if (!pts.length) return null
  const h = ((hour % 24) + 24) % 24
  if (h <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) if (h <= pts[i][0]) { const [h0, v0] = pts[i - 1], [h1, v1] = pts[i]; return h1 > h0 ? v0 + ((h - h0) / (h1 - h0)) * (v1 - v0) : v1 }
  return pts[pts.length - 1][1]
}

export const cortisolLevel = (ug: number): Level => (ug >= 9 ? 'high' : ug <= 4 ? 'low' : 'typical')
export const melatoninLevel = (pg: number): Level => (pg >= 25 ? 'high' : pg <= 5 ? 'low' : 'typical')

/** The two words for a source at a clock hour, plus a label that says where they came from. */
export function levelsFrom(src: HormoneSource, hour: number): { cortisol: Level; melatonin: Level; label: string } {
  if (src.kind === 'manual') return { cortisol: src.cortisol, melatonin: src.melatonin, label: 'levels you chose' }
  if (src.kind === 'csv') {
    const c = hormoneAt(src.rows, hour, 'cortisol'), m = hormoneAt(src.rows, hour, 'melatonin')
    const ref = referenceLevels(hour)
    return {
      cortisol: c === null ? ref.cortisol : cortisolLevel(c), melatonin: m === null ? ref.melatonin : melatoninLevel(m),
      label: `measured values from ${src.name}${c === null || m === null ? ' (the missing hormone uses the typical daily pattern)' : ''}`,
    }
  }
  const ref = referenceLevels(hour)
  return { ...ref, label: 'typical daily pattern for the time of day (not measured)' }
}
