import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

export const metadata = {
  title: 'Data Processing Addendum · Spanlens',
  description:
    'Spanlens Data Processing Addendum (DPA) for B2B customers subject to GDPR, UK GDPR, or other data-protection laws. Incorporates EU Standard Contractual Clauses (Module 2).',
}

const EFFECTIVE_DATE = '2026-05-18'

export default function DPAPage() {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <MarketingNav />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-12 prose prose-stone
        prose-headings:scroll-mt-20
        prose-a:text-accent prose-a:no-underline hover:prose-a:opacity-80">
        <h1>Data Processing Addendum</h1>
        <p className="text-sm text-muted-foreground">
          <strong>Effective date:</strong> {EFFECTIVE_DATE} ·{' '}
          <strong>Version:</strong> 1.0
        </p>

        <div className="border border-border rounded-md bg-bg-elev p-4 my-6 not-prose">
          <p className="text-sm m-0">
            <strong>How this DPA becomes binding.</strong> This Data Processing Addendum
            (&ldquo;DPA&rdquo;) supplements the{' '}
            <Link href="/terms">Terms of Service</Link> between you (the &ldquo;Customer&rdquo;)
            and Oceancode (&ldquo;Spanlens&rdquo;, &ldquo;Processor&rdquo;). It is
            automatically incorporated into your contract when you create an organization
            or access the service, provided your processing of personal data is subject
            to the GDPR, UK GDPR, or another applicable data-protection law that requires
            a written processor contract. If you require a countersigned copy of this DPA
            for your records, email{' '}
            <a href="mailto:support@spanlens.io?subject=Countersigned%20DPA%20request">
              support@spanlens.io
            </a>{' '}
            from your account address and we will return an executed PDF within 5
            business days.
          </p>
        </div>

        <h2 id="parties">1. Parties</h2>
        <ul>
          <li>
            <strong>Data Exporter / Controller:</strong> the Customer (legal entity or
            individual) named on the Spanlens organization account.
          </li>
          <li>
            <strong>Data Importer / Processor:</strong> Oceancode, a sole proprietorship
            registered in the Republic of Korea (Business Registration Number
            676-71-00622), operating Spanlens (the &ldquo;Service&rdquo;).
          </li>
        </ul>

        <h2 id="definitions">2. Definitions</h2>
        <p>
          Capitalized terms not defined here have the meaning given to them in the GDPR
          (Regulation (EU) 2016/679). For the avoidance of doubt:
        </p>
        <ul>
          <li>
            <strong>&ldquo;Customer Personal Data&rdquo;</strong> means Personal Data that
            the Customer or its end users submit to the Service or that the Service
            generates on the Customer&apos;s behalf — including LLM request and response
            bodies, end-user identifiers, account profile data, and telemetry metadata.
          </li>
          <li>
            <strong>&ldquo;Subprocessor&rdquo;</strong> means any third party engaged by
            Spanlens to process Customer Personal Data on behalf of the Customer, as
            listed at <Link href="/subprocessors">spanlens.io/subprocessors</Link>.
          </li>
          <li>
            <strong>&ldquo;Standard Contractual Clauses&rdquo;</strong> or{' '}
            <strong>&ldquo;SCCs&rdquo;</strong> means the standard contractual clauses
            for the transfer of personal data to third countries pursuant to Regulation
            (EU) 2016/679 of the European Parliament and of the Council, adopted by
            European Commission Implementing Decision (EU) 2021/914 of 4 June 2021.
          </li>
        </ul>

        <h2 id="scope">3. Scope and roles</h2>
        <p>
          For the purpose of this DPA, the Customer is the Controller of Customer Personal
          Data and Spanlens is the Processor. Where the Customer is itself a Processor
          acting on behalf of one of its own clients, the Customer warrants that it has
          the legal authority to enter into this DPA on that client&apos;s behalf and that
          all instructions it gives to Spanlens are consistent with that client&apos;s
          instructions to the Customer.
        </p>

        <h2 id="processing">4. Details of the processing</h2>
        <ul>
          <li>
            <strong>Subject matter:</strong> provision of the Service (LLM observability
            proxy, dashboard, billing).
          </li>
          <li>
            <strong>Duration:</strong> from the activation of the Customer&apos;s account
            until termination, plus the retention windows described in our{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </li>
          <li>
            <strong>Nature and purpose:</strong> hosting, transmission, storage, and
            analytical processing of Customer Personal Data, and forwarding of LLM
            requests to upstream LLM providers identified by the Customer.
          </li>
          <li>
            <strong>Categories of data subjects:</strong> (i) the Customer&apos;s own
            personnel who hold Spanlens accounts; (ii) end users of the Customer&apos;s
            applications whose data appears in the LLM request bodies the Customer routes
            through the Service.
          </li>
          <li>
            <strong>Categories of personal data:</strong> account profile (email, display
            name); LLM request and response bodies (which may contain any personal data
            the Customer or its end users submit); telemetry (token counts, latency,
            cost, model identifiers); security-scan match flags (masked samples only);
            billing metadata (Paddle customer / subscription identifiers); technical
            logs (IP address, user agent).
          </li>
          <li>
            <strong>Sensitive data:</strong> Spanlens does not request and does not need
            sensitive categories of personal data (GDPR Art. 9). If the Customer submits
            sensitive data through LLM request bodies, the Customer is responsible for
            ensuring an appropriate legal basis exists. Spanlens recommends using the{' '}
            <code>X-Spanlens-Log-Body: meta</code> header for any traffic carrying
            sensitive data, which suppresses storage of the request and response bodies.
          </li>
        </ul>

        <h2 id="instructions">5. Processing only on documented instructions</h2>
        <p>
          Spanlens will process Customer Personal Data only on documented instructions
          from the Customer, including with regard to transfers of personal data to a
          third country or international organisation, unless required to do so by EU or
          Member State law to which Spanlens is subject. The Customer&apos;s
          documented instructions include this DPA, the Terms of Service, the Service
          documentation, and any reasonable supplementary written instructions from the
          Customer that are consistent with the foregoing.
        </p>
        <p>
          Spanlens will immediately inform the Customer if, in its opinion, an instruction
          infringes the GDPR or other applicable data-protection law.
        </p>

        <h2 id="confidentiality">6. Personnel confidentiality</h2>
        <p>
          Spanlens ensures that persons authorized to process Customer Personal Data have
          committed themselves to confidentiality or are under an appropriate statutory
          obligation of confidentiality. Access to Customer Personal Data is restricted
          on a need-to-know basis to the smallest possible number of personnel; as of the
          effective date of this DPA, this is limited to the proprietor of Oceancode.
        </p>

        <h2 id="security">7. Security of processing (Art. 32)</h2>
        <p>
          Spanlens implements appropriate technical and organisational measures to ensure
          a level of security appropriate to the risk, including:
        </p>
        <ul>
          <li>
            <strong>Encryption in transit:</strong> TLS 1.2+ enforced on all client and
            server connections, including connections to subprocessors.
          </li>
          <li>
            <strong>Encryption at rest:</strong> customer-supplied LLM provider API keys
            are encrypted with AES-256-GCM using a master key held in
            infrastructure-level secret storage outside the application database; the
            ClickHouse Cloud and Supabase data stores additionally encrypt all data at
            rest at the storage layer.
          </li>
          <li>
            <strong>Authentication and access control:</strong> dashboard access requires
            authenticated Supabase sessions; Row-Level Security policies are enforced at
            the database layer; the service-role key is restricted to server-side
            operations only.
          </li>
          <li>
            <strong>Data segregation:</strong> all reads from the multi-tenant{' '}
            <code>requests</code> table are routed through a query layer that injects an{' '}
            <code>organization_id</code> filter; this is enforced at code-review time
            via lint rules and CODEOWNERS.
          </li>
          <li>
            <strong>Secret hygiene:</strong> upstream-provider authorization headers are
            stripped from request bodies before storage; secrets and access tokens are
            redacted from error monitoring traces by a pre-transmission filter.
          </li>
          <li>
            <strong>Resilience:</strong> our infrastructure providers offer regional
            redundancy and automated backups (Supabase point-in-time recovery, ClickHouse
            Cloud automated snapshots).
          </li>
          <li>
            <strong>Vulnerability management:</strong> Dependabot tracks dependency
            vulnerabilities; CodeQL runs static analysis on every pull request; GitHub
            Push Protection blocks accidental secret commits.
          </li>
          <li>
            <strong>Testing:</strong> the multi-tenancy guarantee, the webhook handlers,
            and the overage-charge idempotency state machine are covered by an automated
            unit test suite that runs on every change.
          </li>
        </ul>

        <h2 id="subprocessors">8. Use of subprocessors</h2>
        <p>
          The Customer gives Spanlens general written authorization to engage the
          subprocessors listed at{' '}
          <Link href="/subprocessors">spanlens.io/subprocessors</Link>. Spanlens will:
        </p>
        <ul>
          <li>
            Impose on each subprocessor data-protection obligations no less protective
            than those in this DPA, by means of a written contract (typically the
            subprocessor&apos;s standard DPA).
          </li>
          <li>
            Remain fully liable to the Customer for the performance of each
            subprocessor&apos;s obligations.
          </li>
          <li>
            Give the Customer at least <strong>30 days&apos; advance notice</strong>{' '}
            (by email to the account&apos;s billing address) before engaging any new
            subprocessor or changing the role of an existing one. The Customer may object
            on reasonable data-protection grounds within that period; if the objection
            cannot be resolved, the Customer may terminate the affected portion of the
            Service for cause without further charge.
          </li>
        </ul>

        <h2 id="data-subject-rights">9. Assistance with data-subject rights</h2>
        <p>
          Taking into account the nature of the processing, Spanlens assists the Customer
          by appropriate technical and organisational measures, insofar as this is
          possible, for the fulfilment of the Customer&apos;s obligation to respond to
          requests from data subjects exercising their rights under GDPR Chapter III
          (Arts. 15–22).
        </p>
        <p>
          The dashboard provides self-service tools that allow the Customer to export,
          rectify, and erase Personal Data within its organization without Spanlens
          involvement. Where additional assistance is required, the Customer may contact{' '}
          <a href="mailto:support@spanlens.io">support@spanlens.io</a>; Spanlens will
          respond without undue delay and in any event within 30 days.
        </p>

        <h2 id="assistance-art-32-36">10. Assistance with Arts. 32–36</h2>
        <p>
          Spanlens assists the Customer in ensuring compliance with the obligations
          pursuant to Articles 32 to 36 of the GDPR — including security of processing,
          notification of personal data breaches, communication of personal data breaches
          to the data subject, data protection impact assessments, and prior consultation
          — taking into account the nature of processing and the information available
          to Spanlens.
        </p>

        <h2 id="breach">11. Personal data breach notification</h2>
        <p>
          Spanlens will notify the Customer without undue delay (and in any event within{' '}
          <strong>72 hours</strong>) after becoming aware of a Personal Data Breach
          affecting Customer Personal Data. The notification will, to the extent
          information is available at that time, describe:
        </p>
        <ul>
          <li>the nature of the breach and the categories and approximate number of data subjects and records affected;</li>
          <li>the likely consequences of the breach;</li>
          <li>the measures taken or proposed to address the breach and to mitigate its possible adverse effects;</li>
          <li>contact details for further information.</li>
        </ul>
        <p>
          Where information cannot be provided at the same time, it may be provided in
          phases without further undue delay.
        </p>

        <h2 id="return-deletion">12. Return or deletion of data</h2>
        <p>
          At the Customer&apos;s choice, on termination of the Service, Spanlens will
          delete or return all Customer Personal Data and delete existing copies, unless
          EU or Member State law or Korean law requires storage of the Customer Personal
          Data. The standard self-service deletion flow erases account-level data within
          the retention windows described in the Privacy Policy. The Customer may request
          immediate erasure by email; Spanlens will complete erasure within 30 days unless
          a longer period is required by law.
        </p>

        <h2 id="audits">13. Audit rights</h2>
        <p>
          Spanlens will make available to the Customer all information necessary to
          demonstrate compliance with the obligations laid down in Art. 28 of the GDPR
          and allow for and contribute to audits, including inspections, conducted by the
          Customer or another auditor mandated by the Customer.
        </p>
        <p>
          In recognition that Spanlens is a small operator and that on-site audits
          impose significant operational cost, the parties agree that audit rights are
          satisfied in the first instance by:
        </p>
        <ul>
          <li>
            this DPA and the published Privacy Policy, Terms of Service, and security
            documentation;
          </li>
          <li>
            Spanlens&apos; reasonable responses to written security questionnaires from
            the Customer, provided no more than once per 12-month period (more frequent
            requests may be subject to reasonable cost recovery);
          </li>
          <li>
            third-party audit reports, certifications, or attestations from
            subprocessors (e.g. Supabase SOC 2, Vercel SOC 2, ClickHouse Cloud SOC 2)
            made available on request.
          </li>
        </ul>
        <p>
          The Customer may request an on-site audit only where a written security
          questionnaire is insufficient to address a documented concern; such audits will
          be scheduled at a mutually agreed time, conducted by a mutually agreed auditor
          bound by confidentiality, and limited in scope to what is necessary to address
          the concern. The Customer bears its own audit costs and Spanlens may recover
          reasonable internal costs for audits in excess of one per 24-month period.
        </p>

        <h2 id="international-transfers">14. International data transfers</h2>
        <p>
          Where Customer Personal Data is transferred from the EEA, the United Kingdom,
          or Switzerland to a country that has not received an adequacy decision from
          the European Commission or equivalent body, the parties agree that:
        </p>
        <ul>
          <li>
            The transfer from the Customer (Controller) to Spanlens (Processor) is
            governed by <strong>Module 2 of the EU Standard Contractual Clauses</strong>{' '}
            (Commission Implementing Decision (EU) 2021/914), which are hereby
            incorporated into this DPA by reference and completed as set out in Annex A
            of this DPA. Korea has received an EU adequacy decision (2021/1772) for
            entities certified under the Personal Information Protection and Identity
            Verification Act framework; the SCCs nonetheless apply as a redundant
            safeguard.
          </li>
          <li>
            For onward transfers from Spanlens to non-EEA subprocessors, Spanlens
            implements the SCCs (or, where applicable, the UK International Data Transfer
            Agreement / Addendum to the EU SCCs and the Swiss equivalent) with each such
            subprocessor.
          </li>
          <li>
            For transfers from the United Kingdom, the parties incorporate the{' '}
            <strong>UK International Data Transfer Addendum</strong> issued by the
            Information Commissioner under section 119A of the Data Protection Act 2018
            and effective 21 March 2022.
          </li>
          <li>
            For transfers from Switzerland, references to the GDPR are read as references
            to the Swiss Federal Act on Data Protection (FADP) and references to the
            European Commission are read as references to the Swiss Federal Data
            Protection and Information Commissioner (FDPIC).
          </li>
        </ul>

        <h2 id="liability">15. Liability</h2>
        <p>
          Each party&apos;s liability under or in connection with this DPA is subject to
          the limitations and exclusions of liability set out in the Terms of Service.
          Nothing in this DPA limits or excludes any liability that cannot be limited or
          excluded under applicable law (including direct liability of a Processor to a
          data subject under GDPR Art. 82(2)).
        </p>

        <h2 id="term">16. Term and termination</h2>
        <p>
          This DPA takes effect on the effective date stated at the top of this page and
          continues for as long as Spanlens processes Customer Personal Data. Termination
          of the underlying Terms of Service automatically terminates this DPA, except
          that Sections 11 (breach notification), 12 (return / deletion), and 13 (audit)
          survive to the extent necessary to give effect to the parties&apos; respective
          obligations.
        </p>

        <h2 id="governing-law">17. Governing law and jurisdiction</h2>
        <p>
          To the extent compatible with the Standard Contractual Clauses (where they
          apply), this DPA is governed by the laws of the Republic of Korea. The exclusive
          jurisdiction provisions of the Terms of Service apply. The Standard Contractual
          Clauses themselves are governed by the law and subject to the supervisory
          authority of the EU Member State chosen pursuant to Clause 17 and Clause 18 of
          the SCCs as completed in Annex A.
        </p>

        <h2 id="annex-a">Annex A — Completion of the Standard Contractual Clauses</h2>
        <p className="text-sm text-muted-foreground">
          The following completions apply where the SCCs are incorporated under
          Section 14 of this DPA.
        </p>
        <ul>
          <li>
            <strong>Module:</strong> Module 2 (Controller to Processor).
          </li>
          <li>
            <strong>Docking clause (Clause 7):</strong> not used.
          </li>
          <li>
            <strong>Sub-processors (Clause 9):</strong> Option 2 — general written
            authorisation; notice period of 30 days as set out in Section 8 of this DPA.
          </li>
          <li>
            <strong>Local laws (Clause 14):</strong> the parties have considered the
            laws and practices of the Republic of Korea and confirm that, in light of the
            EU adequacy decision (2021/1772) and the technical and organisational
            measures described in Section 7, there is no reason to believe that the laws
            and practices of Korea will prevent the data importer from fulfilling its
            obligations under the SCCs.
          </li>
          <li>
            <strong>Redress (Clause 11):</strong> the optional independent dispute
            resolution mechanism is not used.
          </li>
          <li>
            <strong>Governing law of the SCCs (Clause 17):</strong> Option 1 — the law
            of the Republic of Ireland.
          </li>
          <li>
            <strong>Choice of forum and jurisdiction (Clause 18):</strong> the courts of
            the Republic of Ireland.
          </li>
          <li>
            <strong>Competent supervisory authority (Annex I.C):</strong> the Irish
            Data Protection Commission (DPC), as the supervisory authority of the Member
            State chosen under Clause 13(a).
          </li>
        </ul>

        <h2 id="changes">18. Changes to this DPA</h2>
        <p>
          Spanlens may revise this DPA from time to time to reflect changes in the
          Service, in applicable law, or in industry best practice. Material changes
          will be notified to the Customer by email to the account&apos;s billing address
          at least <strong>30 days</strong> before taking effect. The effective date at
          the top of this page will always reflect the current version. Prior versions
          are available on request.
        </p>

        <h2 id="contact">19. Contact</h2>
        <p>
          Questions about this DPA, requests for a countersigned copy, security
          questionnaire submissions, and audit requests should be directed to{' '}
          <a href="mailto:support@spanlens.io">support@spanlens.io</a> with subject line
          beginning &ldquo;DPA: …&rdquo;.
        </p>

        <hr />
        <p className="text-sm text-muted-foreground">
          Last updated: {EFFECTIVE_DATE}. Previous versions are available on request. See
          also our <Link href="/privacy">Privacy Policy</Link>,{' '}
          <Link href="/terms">Terms of Service</Link>, and{' '}
          <Link href="/subprocessors">Subprocessors list</Link>.
        </p>
      </main>

      <Footer />
    </div>
  )
}
