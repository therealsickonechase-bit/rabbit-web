import { cloudSessionBff } from '@/lib/cloud-job-bff'
export const GET = (request: Request) => cloudSessionBff(request)
export const POST = (request: Request) => cloudSessionBff(request)
