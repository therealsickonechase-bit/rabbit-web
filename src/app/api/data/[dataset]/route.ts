import { datasetResponse, optionsResponse } from '@/lib/data-hub-http'

// Public, read-only rows of one data hub dataset: ?q= &limit= (max 200) &cursor= &sort= &format=json|csv|ndjson
export async function GET(request: Request, context: { params: Promise<{ dataset: string }> }) {
  return datasetResponse(request, (await context.params).dataset)
}
export const OPTIONS = optionsResponse
