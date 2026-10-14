'use client'

import { useState } from 'react'

// Open access: questions go to the hosted Qwen3 model on Cloudflare only. There are no personal API keys.
export default function AskQuestionInputs({ followUp }: { followUp: boolean }) {
  const [consent, setConsent] = useState(false)
  return (
    <>
      <input type="hidden" name="provider" value="qwen" />
      <label htmlFor="question" className="block text-xs font-medium">{followUp ? 'Follow-up question' : 'Your question'}</label>
      <textarea id="question" name="question" required maxLength={1000} rows={3}
        onChange={() => setConsent(false)} placeholder="e.g. What trials mention BRCA1?"
        className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm" />
      <label className="flex gap-2 text-xs text-muted">
        <input type="checkbox" name="consent" required checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        I approve sending this question, recent conversation and retrieved research records to Cloudflare-hosted Qwen3.
        No private health data. Conversations are visible to everyone who uses RabbitOS. No automatic provider fallback.
      </label>
    </>
  )
}
