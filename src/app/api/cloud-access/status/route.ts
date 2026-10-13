import { cloudAccessBff } from '@/lib/cloud-access-bff'
export const GET = (request: Request) => cloudAccessBff(request)
