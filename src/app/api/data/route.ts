import { manifestResponse, optionsResponse } from '@/lib/data-hub-http'

// Public, read-only manifest of the data hub: datasets, columns, row counts, endpoints and the ledger head.
export const GET = (request: Request) => manifestResponse(request)
export const OPTIONS = optionsResponse
