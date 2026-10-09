// The public, read-only feed that rabbitsoftware.io uses to show what the agents have found.
// Only public literature titles/links and counts leave the database; no accounts, notes, chats or twin data.

export const PUBLIC_ORIGINS = ['https://rabbitsoftware.io', 'https://www.rabbitsoftware.io']

/** Sources whose titles and links are already public elsewhere (PubMed, ClinicalTrials.gov, ClinVar ...). */
export const PUBLIC_SOURCES = [
  'trial', 'pubmed', 'stjude', 'stjude_dataset', 'europepmc', 'nih_grant', 'clinvar',
  'crispr_trial', 'crispr_paper', 'crispr_preprint',
] as const

export function corsHeaders(origin: string | null): Record<string, string> {
  const base = { Vary: 'Origin' }
  return origin && PUBLIC_ORIGINS.includes(origin) ? { ...base, 'Access-Control-Allow-Origin': origin } : base
}
