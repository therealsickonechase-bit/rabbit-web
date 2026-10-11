import { llmsTxt } from '@/lib/body-api'

export async function GET(request: Request) {
  return new Response(llmsTxt(new URL(request.url).origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } })
}
