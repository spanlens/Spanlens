import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /* ── Design token palette ── */
        bg:              'var(--bg)',
        'bg-elev':       'var(--bg-elev)',
        'bg-muted':      'var(--bg-muted)',
        'bg-sunk':       'var(--bg-sunk)',
        'bg-chip':       'var(--bg-chip)',
        track:           'var(--track)',
        'border-strong': 'var(--border-strong)',
        text:            'var(--text)',
        'text-muted':    'var(--text-muted)',
        'text-faint':    'var(--text-faint)',
        accent:          'var(--accent)',
        'accent-bright': 'var(--accent-bright)',
        'accent-strong': 'var(--accent-strong)',
        'accent-fg':     'var(--accent-foreground)',
        'accent-bg':     'var(--accent-bg)',
        'accent-border': 'var(--accent-border)',
        /* Code surfaces stay dark in both themes; see globals.css. */
        'code-bg':       'var(--code-bg)',
        'code-head':     'var(--code-head)',
        'code-line':     'var(--code-line)',
        'code-fg':       'var(--code-fg)',
        'code-faint':    'var(--code-faint)',
        good:            'var(--good)',
        'good-bg':       'var(--good-bg)',
        bad:             'var(--bad)',
        'bad-bg':        'var(--bad-bg)',
        warn:            'var(--warn)',
        'warn-bg':       'var(--warn-bg)',

        /* ── shadcn/ui compatibility ── */
        border:      'var(--border)',
        input:       'var(--input)',
        ring:        'var(--ring)',
        background:  'var(--background)',
        foreground:  'var(--foreground)',
        primary: {
          DEFAULT:    'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT:    'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT:    'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT:    'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        card: {
          DEFAULT:    'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT:    'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
      },
      /*
       * Radius ladder from the Foundations board. The dashboard runs tighter
       * than the marketing pages: controls 9-10, banners and tiles 12,
       * dashboard cards 16. Marketing keeps the larger `panel` / `tile` /
       * `slab` steps, and anything clickable that is not a card is a pill.
       */
      borderRadius: {
        chip:    '6px',
        sm:      '8px',
        DEFAULT: '9px',
        md:      '10px',
        lg:      '12px',
        xl:      '16px',
        card:    '16px',
        '2xl':   '20px',
        panel:   '24px',
        tile:    '28px',
        slab:    '34px',
        full:    '999px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
      fontFamily: {
        sans:    ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
        display: ['var(--font-display)', 'var(--font-geist-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [typography],
}
export default config
