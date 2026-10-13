import { cloudJobBff } from '@/lib/cloud-job-bff'
export const POST = (request: Request) => cloudJobBff(request, 'vault')
