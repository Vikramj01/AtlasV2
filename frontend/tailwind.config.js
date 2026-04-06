/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      colors: {
        // ── shadcn/ui CSS-variable tokens (used by all shadcn components) ────
        border:     'hsl(var(--border))',
        input:      'hsl(var(--input))',
        ring:       'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ── Atlas design-spec palette ─────────────────────────────────────────
        // Primary navy:  #1B2A4A  (buttons, sidebar active, logo)
        // Accent blue:   #2E75B6  (links, active states, secondary CTAs)
        navy: {
          DEFAULT: '#1B2A4A',
          50:      '#EEF1F7',
          100:     '#CDD4E5',
          200:     '#9BAAC9',
          300:     '#6980AD',
          400:     '#3E5A8F',
          500:     '#1B2A4A',  // brand primary
          600:     '#162240',
          700:     '#111A33',
          800:     '#0B1225',
          900:     '#060A15',
        },
        'atlas-blue': {
          DEFAULT: '#2E75B6',
          light:   '#5A9BD4',
          dark:    '#1E5A8A',
        },

        // ── Severity palette (used by SeverityCard, SeverityBadge) ────────────
        severity: {
          critical: '#DC2626',
          'critical-bg': '#FEF2F2',
          warning:  '#D97706',
          'warning-bg': '#FFFBEB',
          success:  '#059669',
          'success-bg': '#F0FDF4',
          info:     '#2E75B6',
          'info-bg': '#EFF6FF',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontSize: {
        // Design spec type scale
        'page-title':     ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'section-header': ['16px', { lineHeight: '24px', fontWeight: '600' }],
        'body':           ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'caption':        ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        shimmer:          'shimmer 1.5s infinite linear',
      },
      backgroundImage: {
        shimmer: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
      },
      backgroundSize: {
        shimmer: '200% 100%',
      },
    },
  },
  plugins: [],
};
