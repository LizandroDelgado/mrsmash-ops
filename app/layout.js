import './globals.css';

export const metadata = {
  title: 'MR. SMASH — Ops',
  description: 'Dashboard de operaciones para MR. SMASH',
  manifest: '/manifest.json',
  themeColor: '#FF4D00',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SMASH',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="bg-black text-white min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
