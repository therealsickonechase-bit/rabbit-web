'use client'

import { useState } from 'react'

export default function AskQuestionInputs({ provider, followUp }: { provider: 'anthropic' | 'qwen'; followUp: boolean }) {
  const [selected, setSelected] = useState(provider)
  const [consent, setConsent] = useState(false)
  return (
    <>
      <label htmlFor="ask-provider" className="block text-xs font-medium">Hosted AI provider</label>
      <select id="ask-provider" name="provider" value={selected} onChange={(event) => {
        const value = event.target.value
        if (value !== 'anthropic' && value !== 'qwen') return
        setSelected(value); setConsent(false)
      }} className="rounded-md border border-line bg-canvas px-3 py-2 text-sm">
        <option value="anthropic">Claude / your Anthropic key</option>
        <option value="qwen">Hosted Qwen3 / Cloudflare (no personal API key)</option>
      </select>
      <label htmlFor="question" className="block text-xs font-medium">{followUp ? 'Follow-up question' : 'Your question'}</label>
      <textarea id="question" name="question" required maxLength={1000} rows={3}
        onChange={() => setConsent(false)} placeholder="e.g. What trials mention BRCA1?"
        className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm" />
      <label className="flex gap-2 text-xs text-muted">
        <input type="checkbox" name="consent" required checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        I approve sending this question, recent conversation and retrieved research records to {selected === 'qwen' ? 'Cloudflare-hosted Qwen3' : 'Anthropic Claude'}.
        No private health data. The question and answer are saved in my RabbitOS account. No automatic provider fallback.
      </label>
    </>
  )
}
