import type { Config } from 'tailwindcss'

/**
 * Design tokens. White-label: the `brand` palette below is the one place
 * that re-colours the product.
 *
 * The palette is deliberately narrow and mirrors the approved prototype:
 *   - neutral 950/900/800  → canvas, surfaces, hairlines
 *   - indigo  500/600      → brand + primary action
 *   - emerald/amber/rose   → status semantics only, never decoration
 *
 * Component-level styling lives in `src/components/ui`. Prefer adding a
 * variant there over inventing new class soup at the call site.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * Height-based variants, used by the customer verification shell so a
       * whole step fits on screen without scrolling.
       *
       * Mobile-first in the vertical axis too: the base styles are the
       * compact ones, and `tall:` / `taller:` add breathing room when the
       * viewport can afford it.
       *
       * Thresholds are set from measured content height (var/measure.mjs),
       * not guessed. They must sit *above* the tallest compact layout, or the
       * roomier styles switch on just before there is room for them — an
       * earlier 700px threshold made a 728px-high phone overflow *more* than
       * a 664px one.
       */
      screens: {
        tall: { raw: '(min-height: 760px)' },
        taller: { raw: '(min-height: 860px)' },
      },
      fontFamily: {
        // The flag font first: it holds nothing but flags, so every other
        // character falls through to Inter untouched.
        sans: [
          'var(--font-flags)',
          'var(--font-inter)',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        // Semantic aliases so brand changes stay a one-line edit.
        brand: {
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        canvas: '#0a0a0a',
        surface: '#171717',
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        focus: '0 0 0 2px #0a0a0a, 0 0 0 4px #6366f1',
        glow: '0 0 20px rgba(99, 102, 241, 0.25)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'zoom-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 300ms ease-out both',
        'fade-in-up': 'fade-in-up 400ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'zoom-in': 'zoom-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'indeterminate': 'indeterminate 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config
