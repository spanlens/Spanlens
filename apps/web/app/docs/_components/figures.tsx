/**
 * The five recharts figures used by /docs pages, in the form pages should
 * import them.
 *
 * Each export is a server component: it renders the figure's shell (box,
 * legend, caption) on the server and mounts only the SVG lazily and
 * client-only. Splitting it this way rather than wrapping the whole figure in
 * `dynamic(..., { ssr: false })` buys two things:
 *
 * - The caption and legend are guaranteed to be in the crawled HTML. They do
 *   not depend on whether Next renders a `dynamic` fallback during SSR.
 * - The box holding the chart is server-rendered at its final height, so the
 *   client-side swap is an in-place replacement. No layout shift, by
 *   construction rather than by matching a placeholder height by hand.
 *
 * These names match what the docs pages imported when the figures were eager,
 * so switching a page over is a one-line import change.
 */

import {
  AnomalyFigure,
  FeatureCoverageFigure,
  ModelPriceFigure,
  PlanQuotaFigure,
  PromptAbFigure,
} from './chart-shell'
import {
  LazyAnomalyChart,
  LazyFeatureCoverageRadar,
  LazyModelPriceChart,
  LazyPlanQuotaChart,
  LazyPromptAbChart,
} from './lazy-chart-bodies'

/** Prompt A/B eval scores with 95% CIs and a Welch's t-test verdict. */
export function PromptAbChart() {
  return (
    <PromptAbFigure>
      <LazyPromptAbChart />
    </PromptAbFigure>
  )
}

/** Latency distribution with the ±3σ band and one out-of-band sample. */
export function AnomalyChart() {
  return (
    <AnomalyFigure>
      <LazyAnomalyChart />
    </AnomalyFigure>
  )
}

/** Input vs output price per 1M tokens across five popular models. */
export function ModelPriceChart() {
  return (
    <ModelPriceFigure>
      <LazyModelPriceChart />
    </ModelPriceFigure>
  )
}

/** Monthly request quota and retention window per plan. */
export function PlanQuotaChart() {
  return (
    <PlanQuotaFigure>
      <LazyPlanQuotaChart />
    </PlanQuotaFigure>
  )
}

/** Six-axis capability radar across Spanlens and three competitors. */
export function FeatureCoverageRadar() {
  return (
    <FeatureCoverageFigure>
      <LazyFeatureCoverageRadar />
    </FeatureCoverageFigure>
  )
}
