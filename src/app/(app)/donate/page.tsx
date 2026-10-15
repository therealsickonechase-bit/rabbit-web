import DonateCard from '@/components/DonateCard'
import { Card, PageHeader } from '@/components/ui'
import { WALLET } from '@/lib/wallet'

export const metadata = { title: 'Donate | RabbitOS', description: 'Support RabbitSoftware with a voluntary Bitcoin or Ethereum donation, and how to verify the addresses.' }

const ANCHORS = 'https://rabbitsoftware-io-ledger-public.storage.googleapis.com/anchors/index.json'

export default function DonatePage() {
  const p = WALLET.proof
  return (
    <>
      <PageHeader title="Donate" sub="Support the work" />
      <div className="space-y-6 max-w-3xl">
        <DonateCard />
        <Card title="Check that these addresses are ours">
          <div className="space-y-3 text-sm">
            <p>Both addresses come from one key that lives inside a Google Cloud hardware security module (HSM). Its private key cannot be exported or read by anyone. To prove control, that key signed this message:</p>
            <p><code className="font-mono text-xs break-all">{p.message}</code></p>
            <p>Ethereum signature. Paste the address, the message and this signature into any Ethereum &ldquo;verify message&rdquo; tool (for example the one on Etherscan):</p>
            <p><code className="font-mono text-xs break-all">{p.ethereum.signature}</code></p>
            <p>The same public key (compressed, hex) gives both addresses: <code className="font-mono text-xs break-all">{WALLET.key.publicKeyCompressed}</code>.</p>
            <p className="text-xs text-muted">
              The public chains are also anchored to Bitcoin through OpenTimestamps. Proofs are listed in the{' '}
              <a className="underline text-accent" href={ANCHORS}>anchor index</a> and can be checked with the standard <code>ots verify</code> tool. An anchor proves a document existed by a given Bitcoin block; it does not prove the document is true.
            </p>
            <p className="text-xs text-muted">For a first donation, send a small test amount and compare the first and last six characters of the address in your wallet with this page.</p>
          </div>
        </Card>
      </div>
    </>
  )
}
