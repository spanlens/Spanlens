import type { SVGProps } from 'react'

/**
 * Monochrome provider glyphs for the marketing surfaces.
 *
 * Every mark paints with `currentColor` so the same component can sit on paper
 * in the hero and on the inverse slab in the integrations arc without a second
 * asset, and so it inherits the theme token of whatever wraps it.
 *
 * The marks are deliberately simplified. Both surfaces that use them render the
 * provider name as a label beside or beneath the tile, so the glyph carries
 * recognition rather than having to carry identification on its own.
 *
 * These live under `landing/` rather than in `ui/provider-icons.tsx` because
 * that file currently only holds the two OAuth brand marks (Google, GitHub) and
 * is owned elsewhere. If it ever gains the full provider set, delete this file
 * and re-point the imports.
 */

/** The ten providers the proxy speaks, matching `apps/server/src/proxy/*.ts`. */
export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'xai'
  | 'groq'
  | 'openrouter'
  | 'azure'
  | 'deepseek'
  | 'cohere'

type PathProps = { d: string }

const MARKS: Record<ProviderId, PathProps[]> = {
  openai: [
    {
      d: 'M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.182a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .511 4.91 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.998-2.9 6.056 6.056 0 0 0-.748-7.073Zm-9.022 12.608a4.476 4.476 0 0 1-2.876-1.04l.142-.081 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.495 4.494Zm-9.66-4.125a4.471 4.471 0 0 1-.535-3.014l.142.085 4.783 2.758a.771.771 0 0 0 .78 0l5.843-3.368v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.499 4.499 0 0 1-6.141-1.646ZM2.341 7.896a4.485 4.485 0 0 1 2.365-1.973V11.6a.766.766 0 0 0 .388.677l5.815 3.354-2.02 1.169a.076.076 0 0 1-.071 0l-4.831-2.787a4.504 4.504 0 0 1-1.646-6.116Zm16.596 3.856-5.833-3.388L15.12 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.666Zm2.011-3.023-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.41 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.499 4.499 0 0 1 6.68 4.66ZM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.074a4.499 4.499 0 0 1 7.376-3.454l-.142.08-4.779 2.76a.795.795 0 0 0-.393.68Zm1.097-2.365 2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5Z',
    },
  ],
  anthropic: [
    {
      d: 'M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96Zm-7.258 0h3.767l6.57 16.96h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.521Zm4.132 10.936L8.453 7.687l-2.248 6.769h4.496Z',
    },
  ],
  gemini: [
    {
      d: 'M12 0c0 3.16 1.29 6.03 3.38 8.1A11.44 11.44 0 0 0 24 12c-3.31 0-6.31 1.4-8.42 3.64A11.45 11.45 0 0 0 12 24c0-3.16-1.29-6.03-3.38-8.1A11.44 11.44 0 0 0 0 12c3.31 0 6.31-1.4 8.42-3.64A11.45 11.45 0 0 0 12 0Z',
    },
  ],
  mistral: [
    {
      d: 'M2 3h4v4H2V3Zm16 0h4v4h-4V3ZM2 7h4v4H2V7Zm5 0h4v4H7V7Zm6 0h4v4h-4V7Zm5 0h4v4h-4V7ZM2 11h20v4H2v-4Zm0 4h4v4H2v-4Zm7 0h4v4H9v-4Zm9 0h4v4h-4v-4Z',
    },
  ],
  xai: [
    {
      d: 'M3.2 21 10 11.7l1.9 2.6L6.9 21H3.2Zm3.6-9.6L3.2 6.4h3.7l1.9 2.6-2 2.4ZM20.8 3l-6.9 9.4-1.9-2.6L17.1 3h3.7ZM12.9 9.9 20.8 21h-3.7L9.2 9.9h3.7Z',
    },
  ],
  groq: [
    {
      d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.2a6.8 6.8 0 0 1 6.8 6.8v6.6h-3.1v-2a6.8 6.8 0 1 1-3.7-11.4Zm0 3.2a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z',
    },
  ],
  openrouter: [
    {
      d: 'M2 10.6h4.3a4.6 4.6 0 0 0 3.4-1.5l1.4-1.5a7.7 7.7 0 0 1 5.6-2.4h1.1V2l5.2 4.1-5.2 4.1V6.8h-1.1a4.6 4.6 0 0 0-3.4 1.5l-1.4 1.5a7.7 7.7 0 0 1-5.6 2.4H2v-1.6Zm0 2.8h4.3a7.7 7.7 0 0 1 5.6 2.4l1.4 1.5a4.6 4.6 0 0 0 3.4 1.5h1.1v-3.4l5.2 4.1-5.2 4.1v-2.8h-1.1a7.7 7.7 0 0 1-5.6-2.4l-1.4-1.5a4.6 4.6 0 0 0-3.4-1.5H2v-2Z',
    },
  ],
  azure: [
    { d: 'M9.4 3h5.3l-5.5 16.3 -6.9 1.4L9.4 3Zm2.5 4.9 8.9 13.4H6.3l6.1-.7-4.6-5.5 2.1-7.2Z' },
  ],
  deepseek: [
    {
      d: 'M22.5 5.4c-1.1.7-2 1.5-2.2 2.6-1.5-1.1-3.2-1.6-5-1.3-1.6-1.4-3.6-2.2-5.8-2.2-.5 0-.7.5-.4.9.8.9 1.3 1.9 1.5 3-2.3.6-4.1 2.2-5 4.3-.6 1.4-.7 2.9-.3 4.3.5 2 1.9 3.6 3.8 4.5 1.7.8 3.6.9 5.4.5 3.4-.8 6-3.4 6.8-6.7.3-1.3.3-2.5 0-3.8 1-.7 1.7-1.7 2-2.9.2-1.1.1-2.2-.3-3.2Zm-6.6 8.1a1.3 1.3 0 1 1 0-2.7 1.3 1.3 0 0 1 0 2.7Z',
    },
  ],
  cohere: [
    {
      d: 'M7.7 12.5c-.9 0-2.6 0-3.4.3A4.3 4.3 0 0 0 1.4 17a4.3 4.3 0 0 0 4.3 4.3c1.7 0 3.2-1 3.9-2.5.4-.8.7-1.7 1.1-2.6l.6-1.5c.4-1 0-2.2-1-2.2H7.7Z',
    },
    {
      d: 'M17.2 3.6c-3.3 0-6.5.9-9.4 2.5-1.4.8-2.6 1.7-3.6 2.9-.8.9-.2 2.3 1 2.3h6.9c3.3 0 6-2.1 6-4.4 0-1.9-1.4-3.3-3-3.3h2.1Z',
    },
    { d: 'M18.6 13.6a3.8 3.8 0 1 0 0 7.7 3.8 3.8 0 0 0 0-7.7Z' },
  ],
}

interface ProviderMarkProps extends SVGProps<SVGSVGElement> {
  id: ProviderId
}

export function ProviderMark({ id, ...props }: ProviderMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {MARKS[id].map((p) => (
        <path key={p.d} d={p.d} />
      ))}
    </svg>
  )
}
