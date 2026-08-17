/**
 * FAQ band.
 *
 * The Figma comp puts pull quotes in this slot, but the page emits FAQPage
 * structured data built from the same list, and Google requires that markup's
 * question and answer text to be visible on the page. So the band keeps its
 * place in the composition and carries the FAQ instead.
 */
export function Faq({ items }: { items: [string, string][] }) {
  return (
    <section className="bg-bg-muted px-4 py-16 sm:px-6 lg:px-10 lg:py-[110px]">
      <div className="mx-auto max-w-[1200px]">
        <h2 className="mx-auto max-w-[547px] text-center font-display track-h2 text-[28px] leading-[1.12] text-text lg:text-[40px]">
          Reasonable questions
        </h2>
        <dl className="mt-10 grid gap-5 lg:mt-[52px] lg:grid-cols-2">
          {items.map(([question, answer]) => (
            <div key={question} className="card-surface rounded-panel p-6 lg:p-8">
              <dt className="text-[15px] font-semibold leading-[1.45] text-text">{question}</dt>
              <dd className="mt-2.5 text-[13.5px] leading-[1.58] text-text-muted lg:text-[14px]">
                {answer}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
