import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MC Global Freight Solutions — TMS',
  description:
    'Controlled Phase 1 logistics TMS for MC Global Freight Solutions LLC.',
  // The branded mark already lives at public/favicon.svg; without this it was
  // never wired into <head>, so browsers fell back to a 404ing /favicon.ico
  // and showed no tab icon.
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
