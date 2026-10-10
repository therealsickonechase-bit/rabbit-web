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

// Open sources only: UMLS tags every source vocabulary with a restriction level (0 = open, 1-4 and 9 = licence conditions: CPT, CDT, SNOMED CT US and others).
// The metadata endpoint needs no key. We only ever ask UMLS about MeSH (MSH), and refuse to continue if NLM lists it as anything but level 0.
const OPEN_SAB = 'MSH'
if (key) {
  const sources = (await get('https://uts-ws.nlm.nih.gov/rest/metadata/current/sources')).result ?? []
  const msh = sources.find((x) => x.abbreviation === OPEN_SAB)
  if (!msh || msh.restrictionLevel !== 0) { console.error(`${OPEN_SAB} is not listed as an open (level 0) source; not adding UMLS data.`); process.exit(1) }
  console.log(`UMLS source check: ${OPEN_SAB} restriction level 0 (open); ${sources.filter((x) => x.restrictionLevel === 0).length} of ${sources.length} sources are open, the rest are not used.`)
}

const out = { source: 'NLM MeSH lookup (id.nlm.nih.gov/mesh); UMLS CUIs (from open source MSH only) only when UMLS_API_KEY was set', generated: new Date().toISOString().slice(0, 10), umls_included: !!key, umls_sources: key ? [OPEN_SAB] : [], concepts: {} }
for (const [id, label] of Object.entries(LABELS)) {
  const hit = (await get(`https://id.nlm.nih.gov/mesh/lookup/descriptor?label=${encodeURIComponent(label)}&match=exact&limit=1`))[0]
  if (!hit || !/^http:\/\/id\.nlm\.nih\.gov\/mesh\/D\d{6,9}$/.test(hit.resource)) { console.log(`NO EXACT MeSH MATCH: ${id} (${label})`); continue }
  const entry = { mesh: { id: hit.resource.split('/').pop(), label: hit.label, uri: hit.resource.replace('http:', 'https:') }, umls: null }
  if (key) {
    const s = await get(`https://uts-ws.nlm.nih.gov/rest/search/current?string=${encodeURIComponent(hit.label)}&sabs=${OPEN_SAB}&searchType=exact&pageSize=1&apiKey=${key}`)
    const r = s.result?.results?.[0]
    if (r && /^C\d{7}$/.test(r.ui)) entry.umls = { cui: r.ui, name: r.name }
  }
  out.concepts[id] = entry
  console.log(`${id.padEnd(11)} ${entry.mesh.id}  ${entry.mesh.label}${entry.umls ? `  ${entry.umls.cui}` : ''}`)
}
writeFileSync(new URL('../src/lib/concepts.generated.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${Object.keys(out.concepts).length} concepts`)
