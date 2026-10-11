import assert from 'node:assert/strict'
import test from 'node:test'
import { GENE_IDENTIFIERS, geneLinks, identifiersFor } from '../src/lib/gene-ids.ts'
import { GENE_COUNTS } from '../src/lib/neuro-genes.ts'
import { GENE_BODY } from '../src/lib/body.ts'
import { bodyModelJson } from '../src/lib/body-api.ts'

test('identifiers are well-formed and belong to genes the model knows', () => {
  for (const [gene, g] of Object.entries(GENE_IDENTIFIERS)) {
    assert.ok(gene in GENE_COUNTS && gene in GENE_BODY, `${gene} is not in the model`)
    assert.match(g.ncbi_gene_id, /^\d+$/); assert.match(g.hgnc, /^HGNC:\d+$/); assert.match(g.omim, /^\d{6}$/); assert.match(g.ensembl, /^ENSG\d{11}$/)
    assert.match(g.uniprot, /^[A-Z][0-9][A-Z0-9]{3}[0-9]$/); assert.match(g.refseq_transcript, /^NM_\d+\.\d+$/); assert.match(g.refseq_protein, /^NP_\d+\.\d+$/)
    for (const url of Object.values(geneLinks(g))) assert.match(url, /^https:\/\/(www\.ncbi\.nlm\.nih\.gov|www\.omim\.org|www\.ensembl\.org|www\.uniprot\.org|www\.genenames\.org)\//)
  }
  assert.equal(identifiersFor('SLC6A4').ncbi_gene_id, '6532'); assert.equal(identifiersFor('NOPE'), null)
})

test('the open model API carries identifiers for SLC6A4 and null for genes without them', () => {
  const genes = bodyModelJson('genes').data
  const slc = genes.find((x) => x.gene === 'SLC6A4'), other = genes.find((x) => x.gene !== 'SLC6A4')
  assert.equal(slc.identifiers.refseq_transcript, 'NM_001045.6'); assert.ok(slc.identifiers.links.ncbi_gene.endsWith('/6532'))
  assert.equal(other.identifiers, null)
})
