/** @type {import('tailwindcss').Config} */
// Colores: TODOS apuntan a los tokens de app/globals.css (claro/oscuro sin repetir clases).
const tok = (name) => `var(--${name})`;

// Colores de metadatos del navegador/PWA (no son CSS: el manifest y el meta theme-color
// necesitan un valor literal). Se usan desde app/layout.js.
const brandMeta = {
  themeColor: '#FF4D00',
  background: '#FFF8EE',
};

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cream: tok('cream'),
        paper: tok('paper'),
        'paper-2': tok('paper-2'),
        ink: tok('ink'),
        'ink-soft': tok('ink-soft'),
        'ink-mute': tok('ink-mute'),
        orange: tok('orange'),
        'orange-deep': tok('orange-deep'),
        'orange-text': tok('orange-text'),
        'on-orange': tok('on-orange'),
        line: tok('line'),
        good: tok('good-ink'),
        warn: tok('warn-ink'),
        bad: tok('bad-ink'),
        band: tok('band'),
        'band-ink': tok('band-ink'),
        // compatibilidad con clases existentes
        brand: tok('orange'),
        'brand-dim': tok('orange-deep'),
      },
      fontFamily: {
        display: ['var(--font-fredoka)', 'var(--font-manrope)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-manrope)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        // Tarjetas 22px, inputs 14px, botones y chips en pastilla (rounded-full)
        xl: '14px',
        '2xl': '22px',
        '3xl': '22px',
        card: '22px',
        input: '14px',
      },
    },
  },
  plugins: [],
};

module.exports.brandMeta = brandMeta;
