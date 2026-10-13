import { cloudJobBff } from '@/lib/cloud-job-bff'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return cloudJobBff(request, 'vault', (await context.params).id, true)
}
