import { ImageResponse } from 'next/og'

/**
 * Site-wide OG card (1200×630). Replaces the 512×512 app icon that was
 * previously reused as og:image — square icons letterbox or crop badly on
 * X / LinkedIn / Slack unfurls (2026-07-06 SEO audit). Rendered at build
 * time via next/og, so there is no binary asset to maintain.
 *
 * Colors mirror the light theme in globals.css (--accent: #b45309).
 * Pages inherit this card automatically; a route can override it by
 * shipping its own opengraph-image.tsx in its segment.
 */

export const alt = 'Spanlens · Open Source LLM Observability & Monitoring'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#fcfbf9',
          padding: '72px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 14,
                backgroundColor: '#b45309',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fcfbf9',
                fontSize: 40,
                fontWeight: 700,
              }}
            >
              S
            </div>
            <div
              style={{
                fontSize: 72,
                fontWeight: 700,
                letterSpacing: '-0.03em',
                color: '#1a1611',
              }}
            >
              spanlens
            </div>
          </div>
          <div
            style={{
              marginTop: 48,
              fontSize: 44,
              lineHeight: 1.25,
              color: '#57534e',
              maxWidth: 900,
            }}
          >
            Open source LLM observability. Request logging, cost tracking, and
            agent tracing with a one-line setup.
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '2px solid #e7e2da',
            paddingTop: 32,
          }}
        >
          <div style={{ fontSize: 28, color: '#78716c' }}>www.spanlens.io</div>
          <div style={{ fontSize: 28, color: '#b45309' }}>
            MIT licensed · self-hostable
          </div>
        </div>
      </div>
    ),
    size,
  )
}
