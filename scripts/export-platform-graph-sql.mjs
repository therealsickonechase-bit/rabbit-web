// Generates supabase/seed/platform_graph.seed.sql from the platform graph JSON.
//   node scripts/export-platform-graph-sql.mjs [path-to-platform-graph.json]
// Writes a file only. Nothing is sent to Supabase; apply the SQL by hand.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(process.argv[2] ?? resolve(here, '../../rabbitsoftware-cloudflare/workers/qa-audit/data/platform-graph.json'))
const { graphSql, validateGraph } = await import(pathToFileURL(resolve(dirname(src), '../src/graph.mjs')).href)

const graph = JSON.parse(await readFile(src, 'utf8'))
const problems = validateGraph(graph)
if (problems.length) {
  console.error('The graph has problems:\n- ' + problems.join('\n- '))
  process.exit(1)
}
const out = resolve(here, '../supabase/seed/platform_graph.seed.sql')
await mkdir(dirname(out), { recursive: true })
await writeFile(out, graphSql(graph))
console.log(`wrote ${out}: ${graph.nodes.length} nodes, ${graph.edges.length} connections, ${graph.roadmap.length} roadmap items`)
