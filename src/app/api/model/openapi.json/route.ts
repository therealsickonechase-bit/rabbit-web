import { openapiJson } from '@/lib/body-api'

export async function GET(request: Request) {
  return Response.json(openapiJson(new URL(request.url).origin), { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } })
}
