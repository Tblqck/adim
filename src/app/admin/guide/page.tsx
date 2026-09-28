import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'

export const metadata: Metadata = { title: 'Guide' }

const SECTIONS = [
  ['getting-in', 'Getting in'],
  ['list', 'The verifications list'],
  ['reading', 'Reading a verification'],
  ['deciding', 'Approve, reject, correct'],
  ['deleting', 'Deleting & restoring'],
  ['links', 'Generate link'],
  ['adhoc', 'Checks without a verification'],
] as const

const VERDICTS: [string, string][] = [
  ['pass', 'Document, face and (where present) MRZ all matched cleanly.'],
  ['mrz_face_pass', 'No reference image on file for this document, but the MRZ and the face both checked out.'],
  ['face_only_pass', 'Face matched; no document or MRZ check was possible.'],
  ['pass_mrz_warn', 'Passed, but the MRZ had a non-fatal warning. Worth a look.'],
  ['both_weak', 'Document and face both matched weakly — needs a human decision.'],
  ['face_ai_mismatch', 'The two face models disagreed — a strong fraud signal.'],
  ['mrz_unreadable', 'An MRZ zone was found but could not be parsed or checksummed.'],
  ['mrz_tampered', 'MRZ check digits did not validate.'],
  ['liveness_fail', 'The selfie frames failed the anti-spoof check.'],
  ['fail', 'Nothing matched.'],
]

function Part({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-400">{String(n).padStart(2, '0')}</p>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-neutral-300">{children}</div>
    </section>
  )
}

function Tip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-amber-200/90">{children}</p>
    </div>
  )
}

function Go({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-brand-400 hover:text-brand-300">
      {children}
    </Link>
  )
}

export default function GuidePage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="Guide" description="How to review verifications and run checks in this dashboard." />
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <nav aria-label="Contents" className="lg:sticky lg:top-9 lg:w-56 lg:shrink-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Contents</p>
          <ol className="space-y-1 text-sm">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-100">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Card className="min-w-0 flex-1 space-y-10 px-5 py-6 sm:px-8 sm:py-8">
          <Part id="getting-in" n={1} title="Getting in">
            <p>
              Sign in with your firm’s <strong>Firm ID</strong> (its slug, e.g. <code>northwind</code>) and the firm password. Named team members
              choose <em>I’m a named team member</em> and add their own username. A session lasts 7 days; <em>Sign out</em> is at the foot of the
              sidebar.
            </p>
            <Tip title="Three tries">
              After repeated failed sign-ins from one network address, that address is blocked — with no on-screen notice; the form keeps saying
              the password is incorrect. If you mistype a few times and then cannot get in even with the right password, ask your administrator to
              lift the block (Settings → Blocked sign-in addresses).
            </Tip>
          </Part>

          <Part id="list" n={2} title="The verifications list">
            <p>
              <Go href="/admin/verifications">Verifications</Go> lists every completed verification, newest first, with the person’s name,
              country, document, the system’s verdict and a confidence score. Click a row to open the record.
            </p>
            <p>
              Filter by status, document type, country (pick from the list — partial text is ignored) and a submission date range. Search matches
              the name, the document number or your user reference, and suggests matching records as you type.
            </p>
            <p>Green is a pass, red a fail, amber a pass with a caveat. The words come from the pipeline’s combined verdict:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <tbody>
                  {VERDICTS.map(([code, meaning]) => (
                    <tr key={code} className="border-b border-neutral-800/70 last:border-0">
                      <td className="whitespace-nowrap py-2 pr-4 font-mono text-[12.5px] text-neutral-200">{code}</td>
                      <td className="py-2 text-neutral-400">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Only <code>pass</code>, <code>mrz_face_pass</code>, <code>face_only_pass</code> and <code>pass_mrz_warn</code> count as verified.
              Anything else that reaches a person has also had a second-opinion review by Claude.
            </p>
          </Part>

          <Part id="reading" n={3} title="Reading a verification">
            <p>
              A record keeps its captured images pinned beside six tabs. <strong>Overview</strong> is the summary and the extracted identity.
              <strong> Model scores</strong> shows each leg of the check with the model that produced it — a <em>heuristic fallback</em> came
              from a simpler method, so weigh it accordingly. <em>Compare frames</em> puts two images side by side.
            </p>
            <p>
              For documents with a machine-readable zone, <strong>MRZ checksums</strong> shows each ICAO check digit, and{' '}
              <strong>Printed vs MRZ</strong> sets the printed text beside the MRZ so a mismatch — a sign of tampering — is obvious.
            </p>
            <p>
              <strong>Forensics &amp; EXIF</strong> holds tamper heuristics on the document image: camera metadata, error level analysis and
              named risk flags. A <em>suspicious</em> verdict means look closer, not reject. <strong>PEP &amp; sanctions</strong> is the screen
              on the extracted name; <em>Databases checked</em> confirms every source was queried even when nothing matched.
            </p>
          </Part>

          <Part id="deciding" n={4} title="Approve, reject, correct">
            <p>
              Read the evidence tabs, paying attention to any amber or red leg. If the system misread a field, choose <em>Edit values</em>, fix
              it, and save — your correction is stored as an overlay and the original machine reading is kept for audit. While editing you can
              also override a per-check verdict.
            </p>
            <p>
              Then <em>Approve</em> or <em>Reject</em>. Your name is stamped on the record from your sign-in, and it shows a{' '}
              <em>Reviewed by</em> badge from then on. Approving a record the system failed, or rejecting one it passed, is expected — that is the
              point of human review; both the system’s verdict and your decision are kept.
            </p>
          </Part>

          <Part id="deleting" n={5} title="Deleting & restoring">
            <p>
              Deleting moves a verification or link to the Recycle Bin, where it can be restored for 42 hours from the{' '}
              <Go href="/admin/recycle-bin">Recycle Bin</Go>, then is purged automatically, images included. Generated links follow the same
              rule. A back-office verification delete is immediate and permanent.
            </p>
          </Part>

          <Part id="links" n={6} title="Generate link">
            <p>
              <Go href="/admin/links">Generate link</Go> makes a one-time link you send to an applicant so they capture their own document and
              selfie on their phone. The result lands in Verifications, tagged to your firm; the link never carries your API key. Add an optional
              applicant reference, generate, and send the URL (or let them scan the QR code).
            </p>
            <p>Each link is single-use and expires after 24 hours. The list shows which are not opened, opened but not submitted, submitted or expired.</p>
          </Part>

          <Part id="adhoc" n={7} title="Checks without a verification">
            <p>Three tools for checking someone or something outside the capture flow. Each is logged on the server and never touches the verifications list.</p>
            <p>
              <Go href="/admin/aml">AML → Person</Go> screens a name against PEP, sanctions and adverse-media lists; a date of birth or nationality
              sharpens the match. <Go href="/admin/aml?tab=company">AML → Company</Go> does the same for a business, with optional jurisdiction and
              registration number. <Go href="/admin/document-check">Document check</Go> runs forensics, the MRZ or reference match and a name
              screen on a document you already hold — no selfie or liveness step.
            </p>
          </Part>
        </Card>
      </div>
    </div>
  )
}
