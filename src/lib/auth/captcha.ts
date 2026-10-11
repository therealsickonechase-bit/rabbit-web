export function usableCaptchaToken(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2048
}

export function captchaSubmissionReady(token: unknown, pending: boolean) {
  return !pending && usableCaptchaToken(token)
}
