import { cloudAccessBff } from '@/lib/cloud-access-bff'
export const POST = (request: Request) => cloudAccessBff(request, true)
