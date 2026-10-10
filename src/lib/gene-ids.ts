// Standard identifiers for genes in the model, copied from NCBI Datasets packages (public reference data; each package's files were checked against its md5sum.txt).
// Hand-curated, one gene per package, so a gene without an entry simply shows none. Nothing here describes a person.

export interface GeneIdentifiers {
  name: string
  ncbi_gene_id: string
  hgnc: string
  omim: string
  ensembl: string
  uniprot: string
  cytoband: string
  refseq_transcript: string
  refseq_protein: string
  synonyms: string[]
  source: string
}

export const GENE_IDENTIFIERS: Record<string, GeneIdentifiers> = {
  SLC6A4: {
    name: 'solute carrier family 6 member 4 (serotonin transporter)', ncbi_gene_id: '6532', hgnc: 'HGNC:11050', omim: '182138', ensembl: 'ENSG00000108576', uniprot: 'P31645',
    cytoband: '17q11.2', refseq_transcript: 'NM_001045.6', refseq_protein: 'NP_001036.1', synonyms: ['5-HTT', '5HTT', 'SERT', 'hSERT', 'SERT1', 'HTT', 'OCD1', '5-HTTLPR'],
    source: 'NCBI Datasets package for human SLC6A4 (GRCh38.p14 annotation GCF_000001405.40-RS_2025_08), downloaded 2026-10-10',
  },
}

/** Links to the public records for a gene's identifiers. Built from the IDs, never from free text. */
export function geneLinks(g: GeneIdentifiers) {
  return {
    ncbi_gene: `https://www.ncbi.nlm.nih.gov/gene/${g.ncbi_gene_id}`,
    omim: `https://www.omim.org/entry/${g.omim}`,
    ensembl: `https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${g.ensembl}`,
    uniprot: `https://www.uniprot.org/uniprotkb/${g.uniprot}`,
    hgnc: `https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/${g.hgnc}`,
  }
}

export const identifiersFor = (gene: string): GeneIdentifiers | null => GENE_IDENTIFIERS[gene] ?? null
