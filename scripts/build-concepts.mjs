// Resolves each organ in the body model to a standard medical vocabulary ID and writes src/lib/concepts.generated.json.
//   MeSH (NLM, public, no key): looked up live at https://id.nlm.nih.gov/mesh/lookup, exact label match, so every ID in the file was returned by NLM.
//   UMLS CUI (optional): only if UMLS_API_KEY is set in your environment (never in the repo); the first exact-match concept is recorded.
// Run:  node scripts/build-concepts.mjs        (re-run any time; it rewrites the file)
import { writeFileSync } from 'node:fs'

// Organ id in the body model -> the MeSH label to look up. 'brain' is not a body-model organ but the page draws it.
const LABELS = {
  eyes: 'Eye', lungs: 'Lung', heart: 'Heart', diaphragm: 'Diaphragm', esophagus: 'Esophagus', liver: 'Liver', gallbladder: 'Gallbladder', stomach: 'Stomach',
  pancreas: 'Pancreas', spleen: 'Spleen', adrenals: 'Adrenal Glands', kidneys: 'Kidney', gut: 'Intestines', bladder: 'Urinary Bladder', muscle: 'Muscle, Skeletal',
  spinalcord: 'Spinal Cord', brain: 'Brain',
}
const key = process.env.UMLS_API_KEY
const get = async (url) => { const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`${r.status} ${url.replace(key ?? '\0', '***')}`); return r.json() }

const out = { source: 'NLM MeSH lookup (id.nlm.nih.gov/mesh); UMLS CUIs only when UMLS_API_KEY was set', generated: new Date().toISOString().slice(0, 10), umls_included: !!key, concepts: {} }
for (const [id, label] of Object.entries(LABELS)) {
  const hit = (await get(`https://id.nlm.nih.gov/mesh/lookup/descriptor?label=${encodeURIComponent(label)}&match=exact&limit=1`))[0]
  if (!hit || !/^http:\/\/id\.nlm\.nih\.gov\/mesh\/D\d{6,9}$/.test(hit.resource)) { console.log(`NO EXACT MeSH MATCH: ${id} (${label})`); continue }
  const entry = { mesh: { id: hit.resource.split('/').pop(), label: hit.label, uri: hit.resource.replace('http:', 'https:') }, umls: null }
  if (key) {
    const s = await get(`https://uts-ws.nlm.nih.gov/rest/search/current?string=${encodeURIComponent(hit.label)}&searchType=exact&pageSize=1&apiKey=${key}`)
    const r = s.result?.results?.[0]
    if (r && /^C\d{7}$/.test(r.ui)) entry.umls = { cui: r.ui, name: r.name }
  }
  out.concepts[id] = entry
  console.log(`${id.padEnd(11)} ${entry.mesh.id}  ${entry.mesh.label}${entry.umls ? `  ${entry.umls.cui}` : ''}`)
}
writeFileSync(new URL('../src/lib/concepts.generated.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${Object.keys(out.concepts).length} concepts`)
