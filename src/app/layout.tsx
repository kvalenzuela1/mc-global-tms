import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MC Global Freight Solutions — TMS',
  description:
    'Controlled Phase 1 logistics TMS for MC Global Freight Solutions LLC.',
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
