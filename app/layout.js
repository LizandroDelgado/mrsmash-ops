import { Fredoka, Manrope } from 'next/font/google';
import tailwindConfig from '../tailwind.config';
import './globals.css';

const fredoka = Fredoka({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-fredoka', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-manrope', display: 'swap' });

export const metadata = {
  title: 'MR. SMASH — Ops',
  description: 'Dashboard de operaciones para MR. SMASH',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/brand/icon-192.png', sizes: '192x192' }, { url: '/brand/icon-512.png', sizes: '512x512' }],
    apple: '/brand/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SMASH',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: tailwindConfig.brandMeta.themeColor,
};

// Aplica el tema guardado (Sistema / Claro / Oscuro) antes de pintar: sin parpadeo.
const temaInicial = `try{var t=localStorage.getItem('tema');if(t==='claro')document.documentElement.setAttribute('data-theme','light');else if(t==='oscuro')document.documentElement.setAttribute('data-theme','dark');}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${fredoka.variable} ${manrope.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: temaInicial }} />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
