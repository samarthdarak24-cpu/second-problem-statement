import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './3d/**/*.{ts,tsx}',
  ],
  theme: {
    container: { center: true, padding: '1.5rem' },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        panel: {
          DEFAULT: 'hsl(var(--panel))',
          foreground: 'hsl(var(--panel-foreground))',
        },
        /* The seven tone surfaces, exposed as Tailwind colours so a
           component can write `bg-tone-peach text-tone-peach-fg` and
           stay out of inline styles. Mirrors the `surface-pastel-*`
           classes in globals.css. */
        tone: {
          blue: 'hsl(var(--pastel-blue))',
          'blue-fg': 'hsl(var(--pastel-blue-fg))',
          lavender: 'hsl(var(--pastel-lavender))',
          'lavender-fg': 'hsl(var(--pastel-lavender-fg))',
          mint: 'hsl(var(--pastel-mint))',
          'mint-fg': 'hsl(var(--pastel-mint-fg))',
          peach: 'hsl(var(--pastel-peach))',
          'peach-fg': 'hsl(var(--pastel-peach-fg))',
          yellow: 'hsl(var(--pastel-yellow))',
          'yellow-fg': 'hsl(var(--pastel-yellow-fg))',
          pink: 'hsl(var(--pastel-pink))',
          'pink-fg': 'hsl(var(--pastel-pink-fg))',
          gray: 'hsl(var(--pastel-gray))',
          'gray-fg': 'hsl(var(--pastel-gray-fg))',
        },
        /* Secondary ink ramp — `subtle` is the tier below `muted`,
           for units, captions and axis labels. */
        subtle: {
          DEFAULT: 'hsl(var(--subtle-foreground))',
          foreground: 'hsl(var(--subtle-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%': { opacity: '0.85', transform: 'scale(0.85)' },
          '100%': { opacity: '0', transform: 'scale(1.6)' },
        },
        'dash-flow': {
          to: { strokeDashoffset: '-24' },
        },
        /* Entrance for a block that has just been created. Mirrors the
           `rise` keyframe in globals.css so a Tailwind utility and the
           raw class behave identically. */
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /* A single left-to-right highlight pass, for "this value just
           changed". */
        sweep: {
          '0%': { backgroundPosition: '-180% 0' },
          '100%': { backgroundPosition: '280% 0' },
        },
        /* The one attention loop in the app: a live indicator. */
        breathe: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'fade-in': 'fade-in 240ms ease-out both',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        'dash-flow': 'dash-flow 1s linear infinite',
        rise: 'rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both',
        sweep: 'sweep 900ms cubic-bezier(0.22, 1, 0.36, 1) 1 both',
        breathe: 'breathe 2.4s cubic-bezier(0.65, 0, 0.35, 1) infinite',
      },
      /* The elevation ladder, exposed as utilities so a component can
         write `shadow-raised` and stay out of inline styles. Values are
         the same ones declared as custom properties in globals.css. */
      boxShadow: {
        hairline: 'var(--shadow-hairline)',
        raised: 'var(--shadow-raised)',
        lift: 'var(--shadow-lift)',
        float: 'var(--shadow-float)',
        overlay: 'var(--shadow-overlay)',
        modal: 'var(--shadow-modal)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.36, 0.64, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
