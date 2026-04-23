import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  darkMode: ['class'],
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
        'border-strong': 'var(--border-strong)',
        text:            'var(--text)',
        'text-muted':    'var(--text-muted)',
        'text-faint':    'var(--text-faint)',
        accent:          'var(--accent)',
        'accent-bg':     'var(--accent-bg)',
        'accent-border': 'var(--accent-border)',
        good:            'var(--good)',
        'good-bg':       'var(--good-bg)',
        bad:             'var(--bad)',
        'bad-bg':        'var(--bad-bg)',

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
      borderRadius: {
        chip:    '5px',
        sm:      '6px',
        DEFAULT: '7px',
        md:      '8px',
        lg:      '10px',
        xl:      '12px',
        full:    '999px',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [typography],
}
export default config
