// ClinVar variant counts for the genes that link brain chemistry, EEG and brain damage.
// A snapshot fetched by research-agents/neuro_variants.py on 2026-10-09 (public, de-identified, variant-level data).
// Counts describe how many DNA changes in a gene have been reported, not any person. Some include large multi-gene deletions.

export const GENE_COUNTS_DATE = '2026-10-09'

export interface GeneInfo { system: string; role: string; variants: number; pathogenic_or_likely: number }

export const GENE_COUNTS: Record<string, GeneInfo> = {
  TH: { system: "dopamine", role: "makes dopamine (rate-limiting enzyme)", variants: 1297, pathogenic_or_likely: 225 },
  DDC: { system: "dopamine", role: "makes dopamine and serotonin", variants: 694, pathogenic_or_likely: 111 },
  SLC6A3: { system: "dopamine", role: "dopamine transporter (DAT)", variants: 729, pathogenic_or_likely: 160 },
  COMT: { system: "dopamine", role: "breaks down dopamine and norepinephrine, mainly in prefrontal cortex", variants: 662, pathogenic_or_likely: 394 },
  DRD2: { system: "dopamine", role: "dopamine D2 receptor", variants: 196, pathogenic_or_likely: 17 },
  MAOA: { system: "monoamines", role: "breaks down serotonin, norepinephrine, dopamine", variants: 515, pathogenic_or_likely: 176 },
  TPH2: { system: "serotonin", role: "makes serotonin in the brain", variants: 91, pathogenic_or_likely: 12 },
  SLC6A4: { system: "serotonin", role: "serotonin transporter", variants: 160, pathogenic_or_likely: 10 },
  HTR2A: { system: "serotonin", role: "serotonin 5-HT2A receptor", variants: 108, pathogenic_or_likely: 56 },
  DBH: { system: "norepinephrine", role: "makes norepinephrine", variants: 636, pathogenic_or_likely: 53 },
  SLC6A2: { system: "norepinephrine", role: "norepinephrine transporter", variants: 138, pathogenic_or_likely: 18 },
  CHAT: { system: "acetylcholine", role: "makes acetylcholine", variants: 1492, pathogenic_or_likely: 179 },
  CHRNA7: { system: "acetylcholine", role: "nicotinic acetylcholine receptor subunit", variants: 472, pathogenic_or_likely: 203 },
  GAD1: { system: "GABA", role: "makes GABA (GAD67)", variants: 334, pathogenic_or_likely: 37 },
  GABRA1: { system: "GABA", role: "GABA-A receptor subunit", variants: 847, pathogenic_or_likely: 105 },
  GABRG2: { system: "GABA", role: "GABA-A receptor subunit; linked to epilepsy", variants: 857, pathogenic_or_likely: 184 },
  GRIN2A: { system: "glutamate", role: "NMDA receptor subunit; linked to epilepsy", variants: 2572, pathogenic_or_likely: 374 },
  GRIN2B: { system: "glutamate", role: "NMDA receptor subunit", variants: 1943, pathogenic_or_likely: 340 },
  SLC1A2: { system: "glutamate", role: "glutamate transporter (EAAT2)", variants: 587, pathogenic_or_likely: 28 },
  NR3C1: { system: "cortisol", role: "glucocorticoid receptor (cortisol signalling)", variants: 367, pathogenic_or_likely: 31 },
  FKBP5: { system: "cortisol", role: "tunes glucocorticoid receptor sensitivity", variants: 84, pathogenic_or_likely: 7 },
  MTNR1A: { system: "melatonin", role: "melatonin receptor", variants: 205, pathogenic_or_likely: 118 },
  SCN1A: { system: "epilepsy", role: "sodium channel; Dravet syndrome and other epilepsies", variants: 5536, pathogenic_or_likely: 2322 },
  APP: { system: "Alzheimer's", role: "amyloid precursor protein", variants: 729, pathogenic_or_likely: 100 },
  PSEN1: { system: "Alzheimer's", role: "presenilin 1; early-onset familial Alzheimer's", variants: 658, pathogenic_or_likely: 162 },
  APOE: { system: "Alzheimer's", role: "lipid transport; the e4 form raises late-onset risk", variants: 311, pathogenic_or_likely: 34 },
  BDNF: { system: "plasticity", role: "growth factor that supports synapses", variants: 251, pathogenic_or_likely: 23 },
}
