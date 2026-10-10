import type { ReactNode } from 'react'
import Link from 'next/link'

export const metadata = { title: 'RabbitOS guide', description: 'What RabbitOS does and how to set it up, for members and for the owner.' }

function Code({ children }: { children: ReactNode }) {
  return <pre className="bg-canvas border border-line rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre">{children}</pre>
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="bg-surface border border-line rounded-lg p-5 space-y-3 scroll-mt-6">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

const P = ({ children }: { children: ReactNode }) => <p className="text-sm leading-relaxed">{children}</p>
const Note = ({ children }: { children: ReactNode }) => <p className="text-xs rounded-md border border-warn/40 text-warn px-3 py-2">{children}</p>
const Steps = ({ children }: { children: ReactNode }) => <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed">{children}</ol>

export default function GuidePage() {
  return (
    <main className="min-h-screen bg-canvas text-fg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <p className="text-2xl font-semibold tracking-tight"><span className="text-accent">Rabbit</span>OS guide</p>
          <p className="text-sm text-muted">
            What RabbitOS does and how to set it up. Part 1 is for everyone with an account. Parts 2 to 4 are for the owner, who connects the
            research agents, an EEG headset, live pictures and personal data.
          </p>
          <nav aria-label="On this page" className="flex flex-wrap gap-2 text-xs">
            {[['what', 'What it is'], ['members', 'For members'], ['owner', 'For the owner'], ['headset', 'EEG headset'], ['live', 'Live & my data'], ['mcp', 'Claude / MCP'], ['trouble', 'Troubleshooting'], ['privacy', 'Privacy']].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-full border border-line px-3 py-1 text-muted hover:text-fg">{label}</a>
            ))}
            <Link href="/login" className="rounded-full border border-accent text-accent px-3 py-1">Sign in</Link>
          </nav>
        </header>

        <Section id="what" title="What RabbitOS is">
          <P>
            RabbitOS is the console at <strong>app.rabbitsoftware.io</strong> where people and AI research agents work on the same body of research.
            Agents search public sources (PubMed, Europe PMC, ClinicalTrials.gov, ClinVar, NCBI RefSeq), the results are stored in one database,
            and every agent write is signed and recorded in a hash-linked audit trail so it can be checked later.
          </P>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li><strong>Research</strong> — browse trials, papers, preprints and gene variants the agents found.</li>
            <li><strong>Ask RabbitOS</strong> — ask a question and get an answer built only from the stored records, with the sources cited.</li>
            <li><strong>Collections</strong> — save records, group them, keep private notes.</li>
            <li><strong>CRISPR Explorer</strong> — real gene sequences, SpCas9 guide candidates and an interactive edit preview (text only, for learning).</li>
            <li><strong>For everyone signed in (read-only):</strong> Overview and Twin Atlas (live readings vs baseline, reference variants, chain proof; the twin&apos;s name and date of birth stay hidden), Brain Network (3D brain and body, picture generators, My data portrait), Agents, Chain &amp; Audit.</li>
            <li><strong>Public downloads:</strong> <Link className="text-info underline" href="/downloads">/downloads</Link> lists data packages anyone can download without signing in. The owner publishes a file from their computer with the upload button on that page (data files and archives up to 50 MB; text is scanned for keys and personal data first). Anything published is public and cannot be recalled from copies already downloaded.</li>
            <li><strong>Owner only:</strong> Members, the stored EEG samples, sealing audit batches, AI illustrations and saved data-portrait summaries.</li>
            <li><strong>Open to everyone, no sign-in:</strong> the body model data (<code>/api/model/body</code>, <code>/api/model/concepts</code>, <code>/llms.txt</code>) for AI models and open-source tools. Topics in Research carry a MeSH tag from the National Library of Medicine.</li>
          </ul>
          <Note>Research and education only. Nothing here is medical advice, a diagnosis, or a lab protocol.</Note>
        </Section>

        <Section id="members" title="Part 1 · For members (no installation)">
          <Steps>
            <li>Go to <Link className="text-info underline" href="/login">app.rabbitsoftware.io</Link>. Anyone can join: there is no separate sign-up.</li>
            <li>Enter your email and complete the Cloudflare check. There is no password.</li>
            <li>Open the sign-in email (from <em>accounts@mail.rabbitsoftware.io</em>; check spam) and press the button on the page it opens. To sign in later, enter your email on the sign-in page and use the new link we send.</li>
            <li>For Ask RabbitOS, open <strong>Settings</strong> and add your own Anthropic API key (create one at console.anthropic.com; the account needs credits). It is stored encrypted and used only for your questions and summaries.</li>
            <li>Open <strong>Ask RabbitOS</strong> and try: <em>“What do we have on BRCA1?”</em>. Open <strong>CRISPR Explorer</strong>, pick a guide and a deletion or insertion to see the sequence change.</li>
          </Steps>
          <P>
            <strong>No password to forget.</strong> Each sign-in link works once. Limits: 20 AI summaries and 40 questions per day per person.
          </P>
        </Section>

        <Section id="owner" title="Part 2 · For the owner: connect the research agents">
          <P>Do this once on the Windows computer that will run the agents.</P>
          <Steps>
            <li>Install <strong>Python 3.10 or newer</strong> from python.org. On the first screen tick <em>“Add python.exe to PATH”</em>.</li>
            <li>Open the <code>research-agents</code> folder (clone it from GitHub, or copy it) and open a terminal in it.</li>
            <li>
              Install the requirements:
              <Code>{`pip install -r requirements.txt`}</Code>
            </li>
            <li>
              Create a file named <code>.env</code> in that folder with two lines:
              <Code>{`RABBIT_URL=https://app.rabbitsoftware.io
RABBIT_INGEST_SECRET=<the same value as INGEST_SHARED_SECRET in the app's secrets>`}</Code>
              <span className="text-xs text-muted">This secret lets a computer write into RabbitOS. Never share it, post it, or commit it. <code>.env</code> is already ignored by git.</span>
            </li>
            <li>
              Fetch the real CRISPR and brain data, then send everything:
              <Code>{`python crispr_data.py       # RefSeq sequences, guides, CRISPR papers
python brain_research.py    # EEG / brain-chemistry / gene papers
python rabbit_sync.py       # signed upload to RabbitOS`}</Code>
            </li>
            <li>Open <strong>CRISPR Explorer</strong>: the proof card should say <em>“Matches the audit chain”</em>. Run the three commands again whenever you want fresh data.</li>
          </Steps>
          <P>
            <strong>Database step (once):</strong> the new tables are added by running the migration files in <code>supabase/migrations/</code> in order in the Supabase SQL editor.
            Paste the file’s <em>contents</em>, not its path. The newest migrations are <code>20261010000000_self_daily.sql</code> (owner-only data-portrait summaries) and <code>20261010010000_public_packages.sql</code> (the public Downloads page).
          </P>
        </Section>

        <Section id="headset" title="Part 3 · For the owner: stream an EEG headset (OpenBCI / BrainFlow)">
          <P>BrainFlow is the open-source library OpenBCI uses. The bridge reads your headset, works out the power in each brain-wave band, and sends only those numbers to RabbitOS.</P>
          <Steps>
            <li>
              Install BrainFlow:
              <Code>{`pip install brainflow numpy`}</Code>
            </li>
            <li>
              <strong>Try it without hardware first</strong> (BrainFlow’s built-in synthetic board). This prints what would be sent and sends nothing:
              <Code>{`python brainflow_bridge.py --dry-run --seconds 10`}</Code>
            </li>
            <li>
              Send the synthetic stream to RabbitOS, then open <strong>Brain Network</strong>. Dots should light up and the badge should say <em>live</em>:
              <Code>{`python brainflow_bridge.py`}</Code>
            </li>
            <li>
              <strong>OpenBCI Cyton (8 channels):</strong> plug in the USB dongle, switch the board to <em>PC</em>, and power it on. Find the dongle’s port in
              <em> Device Manager → Ports (COM &amp; LPT)</em> (for example <code>COM3</code>). Then:
              <Code>{`python brainflow_bridge.py --board cyton --serial-port COM3 --mains 60`}</Code>
              <span className="text-xs text-muted">Use <code>--mains 50</code> in regions with 50 Hz power. Other boards: <code>ganglion</code>, <code>cyton-daisy</code> (16 channels), <code>ultracortex</code>, <code>muse-2</code>.</span>
            </li>
            <li>
              If your electrodes are not in the board’s default places, name them in channel order with 10-20 names:
              <Code>{`python brainflow_bridge.py --board cyton --serial-port COM3 --channels Fp1,Fp2,C3,C4,P7,P8,O1,O2`}</Code>
            </li>
            <li>Leave the window open to keep streaming. Press <strong>Ctrl+C</strong> to stop.</li>
          </Steps>
          <P>
            On <strong>Brain Network</strong> pick a band (delta to gamma), click an electrode to see its band mix and the research that mentions its region and band.
            Colours show the share of power in that band at the scalp. The head is a schematic, not an MRI model, and the lines show similar levels, not measured connectivity.
          </P>
          <Note>
            Only the owner’s account can see EEG data, and only the owner’s computer can send it, because the bridge uses the owner’s signing secret.
            Other people cannot stream their own headsets yet: that needs personal API keys, which are planned. Do not give anyone the secret as a shortcut.
          </Note>
        </Section>

        <Section id="live" title="Part 4 · For the owner: live signals, pictures and your own data (on your computer)">
          <P>These programs run on your Windows computer and talk to the Brain Network page over <code>127.0.0.1</code>, so raw signals and medical values never leave it. Open PowerShell and use the full paths (a bare folder path is not a command):</P>
          <Steps>
            <li>
              Check what is installed: <Code>{`& C:\Users\odaat\Projects\research-agents\check-setup.ps1`}</Code>
            </li>
            <li>
              <strong>Live brain, heart and muscle signals:</strong> start the bridge with no hardware, or with your board, then press <em>Connect</em> under “Live signals” on Brain Network:
              <Code>{`& C:\Users\odaat\Projects\research-agents\start-live.ps1 -Simulate
& C:\Users\odaat\Projects\research-agents\start-live.ps1 -Board cyton -SerialPort COM3 -Ecg 8 -Emg "6=left_forearm,7=right_forearm"`}</Code>
              <span className="text-xs text-muted">This is a different program from Part 3: it keeps everything local. The brain state comes from the EEG transformer (about 83% for eyes open vs closed and 53% for three states on held-out data, with 8 electrodes). It does not read thoughts.</span>
            </li>
            <li><strong>Pictures:</strong> “Paint it with Qwen-Image-2.1-Turbo” sends only fixed words (brain state, strongest rhythm, hormone levels, heart and muscle words) to a Hugging Face Space. Add your own Hugging Face <em>read</em> token if the free quota runs out; never a write token.</li>
            <li>
              <strong>My data portrait:</strong> try the made-up person first, then your own files (Apple Health, Fitbit, Oura, Garmin or Google Fit exports; lab results as CSV or FHIR JSON; this PC’s activity counters):
              <Code>{`& C:\Users\odaat\Projects\research-agents\start-selfdata.ps1 -Demo
& C:\Users\odaat\Projects\research-agents\start-selfdata.ps1 -Inbox`}</Code>
              Then press <em>Connect to my hub</em> in the “My data portrait” panel. Step-by-step export directions are in <code>research-agents/docs/self-data.md</code>.
            </li>
            <li><strong>Walking avatar:</strong> on Brain Network, the avatar chooses by itself how to move and says why. Its mood comes from hormone levels, the time of day and EEG and heart signals: its own simulated twin by default, or yours if you tick &quot;mirror my live signals&quot; while the bridge is connected. Type or tap a question (&quot;How do you feel?&quot;, &quot;What does your liver do?&quot;) and the relevant organ glows through its skin. Answers come from the body model; tick the Claude box to let your own Anthropic key answer open questions (only fixed words about its state are sent). It also has a simulated inner life (a global workspace that decides what it is aware of, working and episodic memory, a model of itself that predicts its own moves, and needs for rest, activity and curiosity); ask it "What are you aware of?", "What do you remember?" or "Are you conscious?". That is a model of ideas from consciousness science, not proof that it is conscious, and it says so. Choose the body: three built-in figures made in code, or Michelle, a Mixamo human character that your browser downloads from GitHub (RabbitOS does not host it; Mixamo&apos;s terms apply).</li>
            <li><strong>Optional save:</strong> “Save today’s summary to my account” stores a coarse summary per body system and lab flag counts (never raw values or names) in an owner-only table. It needs the <code>self_daily</code> migration. “Delete saved summaries” removes them.</li>
          </Steps>
          <Note>Descriptive analytics against your own usual, for research and education. Not medical advice and not a diagnosis.</Note>
        </Section>

        <Section id="mcp" title="Use RabbitOS from Claude or your own scripts (MCP)">
          <Steps>
            <li>Sign in and open <strong>API keys</strong> (top bar). Name the key (for example “Claude Desktop”) and press <em>Create key</em>. Copy it immediately: it is shown once.</li>
            <li>
              In Claude Code, add the server:
              <Code>{`claude mcp add --transport http rabbitos https://app.rabbitsoftware.io/api/mcp \
  --header "Authorization: Bearer rbk_YOUR_KEY"`}</Code>
              Other MCP clients: server address <code>https://app.rabbitsoftware.io/api/mcp</code>, header <code>Authorization: Bearer rbk_…</code>.
            </li>
            <li>Ask your assistant things like “search RabbitOS for BRCA1 PARP inhibitor trials” or “verify the CRISPR digest”.</li>
          </Steps>
          <P>
            A key acts as you with limited access: it can search the public research, read CRISPR guides and check the proof digest (and, if you tick the box, queue agent tasks that an owner still has to approve).
            It cannot read chats, notes, EEG or twin data. Keys last 90 days, allow 60 calls a minute, and can be revoked at any time.
          </P>
        </Section>

        <Section id="site" title="Showing live research on rabbitsoftware.io">
          <P>
            RabbitOS offers a public, read-only feed at <code>/api/public/research-feed</code> (public paper titles, counts and the newest audit hash; no accounts or personal data).
            The site can show it with a few lines of HTML; the snippet is in <code>docs/site-integration.md</code> in the rabbit-web repository.
          </P>
        </Section>

        <Section id="trouble" title="Troubleshooting">
          <dl className="space-y-3 text-sm">
            <div><dt className="font-medium">“Set RABBIT_INGEST_SECRET”</dt><dd className="text-muted">The <code>.env</code> file is missing or in the wrong folder. It must sit next to <code>rabbit_sync.py</code>.</dd></div>
            <div><dt className="font-medium">“ingest rejected (401) bad signature”</dt><dd className="text-muted">The secret differs from the app’s, or your computer’s clock is more than 5 minutes off. Fix the clock (Settings → Time) and re-copy the secret.</dd></div>
            <div><dt className="font-medium">“ingest rejected (422) audit chain broken”</dt><dd className="text-muted">Two programs wrote to the same audit file with an old version of the code. Update to the latest <code>audit_trail.py</code>, close extra agent windows, and ask for the chain to be re-linked.</dd></div>
            <div><dt className="font-medium">Brain Network says “waiting for a headset”</dt><dd className="text-muted">Nothing has arrived yet. Check the bridge window shows lines like “80 samples”, and that the database step for EEG was run.</dd></div>
            <div><dt className="font-medium">The bridge says “waiting for data”</dt><dd className="text-muted">It needs about 4 seconds of signal first. If it never starts, the COM port is wrong or another program (such as the OpenBCI GUI) is using the dongle. Close it and retry.</dd></div>
            <div><dt className="font-medium">Cyton not found / permission error</dt><dd className="text-muted">Re-seat the dongle, confirm the board switch is on <em>PC</em>, and recheck the COM number in Device Manager.</dd></div>
            <div><dt className="font-medium">“running scripts is disabled” in PowerShell</dt><dd className="text-muted">Run <code>Set-ExecutionPolicy -Scope CurrentUser RemoteSigned</code> once, then try again.</dd></div>
            <div><dt className="font-medium">“Connect to my hub” says not reachable</dt><dd className="text-muted">The hub window is not running or was closed. Start <code>start-selfdata.ps1</code> again and keep the window open. Only the RabbitOS site and localhost may connect.</dd></div>
            <div><dt className="font-medium">The picture says the GPU quota is used up</dt><dd className="text-muted">The free Hugging Face quota is shared. Wait, or add your own read token in the generator panel.</dd></div>
            <div><dt className="font-medium">No email arrives</dt><dd className="text-muted">Check spam. Reset emails only go to addresses that already have an account. Wait a minute between tries.</dd></div>
          </dl>
        </Section>

        <Section id="privacy" title="Privacy in plain words">
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>Your email is also kept as an <strong>encrypted contact record</strong> that is opened only for a valid legal request, and every opening is logged.</li>
            <li>Your chats, collections and notes are private to you. Other members cannot read them.</li>
            <li>Your own health files and lab results are analysed only on your computer; medical values are encrypted on disk there. Image models receive fixed words, never numbers. The optional account save is coarse and owner-only.</li>
            <li>EEG data is neural data. Only band powers are stored (never raw waveforms), owner-only, and old samples can be purged after 30 days.</li>
            <li>The blockchain and audit trail hold <strong>hashes</strong> that prove records were not changed. They never hold names, emails, sequences or health values.</li>
          </ul>
        </Section>

        <footer className="text-xs text-muted pb-8">
          Questions: contact@rabbitsoftware.io · <Link href="/login" className="underline">Sign in</Link>
        </footer>
      </div>
    </main>
  )
}
