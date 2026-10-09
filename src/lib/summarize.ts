// Server-side port of research_agents/research_summarizer.py: summarize ONLY records that are
// already in the database, and label the result as AI interpretation.

export const MODEL = 'claude-sonnet-5-5'

export const DISCLAIMER =
  'This is an AI-generated interpretation of the real records stored for this topic — not a new source, ' +
  'not verified independently, and not a substitute for reading the primary trials and papers yourself. ' +
  'The model was only given those records and was told not to add anything beyond them.'

interface RecordRow {
  id: string
  source: string
  title: string
  meta: Record<string, unknown> | null
}

const LABEL: Record<string, string> = {
  trial: 'TRIALS',
  pubmed: 'ARTICLES',
  stjude: 'ST. JUDE-AFFILIATED PAPERS',
  stjude_dataset: 'ST. JUDE-CONNECTED PUBLIC DATASETS',
  europepmc: 'EUROPE PMC',
  nih_grant: 'NIH GRANTS',
  clinvar: 'CLINVAR VARIANTS',
  crispr_trial: 'CRISPR TRIALS',
  crispr_paper: 'CRISPR PAPERS',
  crispr_preprint: 'CRISPR PREPRINTS',
}

export function buildPrompt(topic: string, biomarker: string | null, records: RecordRow[]) {
  const lines = [
    `Here is REAL data already retrieved for condition='${topic}'${biomarker ? `, biomarker='${biomarker}'` : ''}.`,
    'Summarize ONLY what is listed below, in plain language, for someone trying to quickly understand the current ' +
      'research landscape. Do not state or imply anything about trials, papers, or variants not explicitly listed here. ' +
      'If a category is empty, say so plainly rather than filling it in.',
  ]
  const groups = new Map<string, RecordRow[]>()
  for (const r of records) {
    if (r.source === 'topic_summary') continue
    groups.set(r.source, [...(groups.get(r.source) ?? []), r])
  }
  for (const [source, rows] of groups) {
    lines.push('', `${LABEL[source] ?? source.toUpperCase()} (${rows.length}):`)
    for (const r of rows.slice(0, 15)) {
      const m = r.meta ?? {}
      const extra = [m.status, m.classification, m.pub_date ?? m.pub_year, m.journal].filter(Boolean).join(', ')
      lines.push(`  - ${r.title} [${r.id}]${extra ? ` (${extra})` : ''}`)
    }
  }
  return lines.join('\n')
}

const API = 'https://api.anthropic.com/v1'

function headers(key: string) {
  return { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
}

/** Free call: confirms the key is accepted without generating anything. */
export async function keyIsValid(key: string) {
  const res = await fetch(`${API}/models?limit=1`, { headers: headers(key) })
  return res.status === 200 ? true : res.status === 401 || res.status === 403 ? false : null
}

export async function summarize(key: string, prompt: string, system?: string, maxTokens = 600) {
  const res = await fetch(`${API}/messages`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('')
  if (!text) throw new Error('Anthropic API returned no text')
  return text
}
