import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Area-Specific Thermal Comfort Shelter Design | SIH PS-51',
  description:
    'Climate-responsive shelter design: parametric 3D modelling, climate analysis, ISO 7730 thermal comfort evaluation and multi-objective optimisation of the building envelope.',
  applicationName: 'Thermal Shelter Designer',
  keywords: [
    'thermal comfort',
    'climate-responsive design',
    'shelter design',
    'PMV',
    'ASHRAE 55',
    'building envelope optimisation',
    'SIH PS-51',
  ],
  authors: [{ name: 'Smart India Hackathon — Problem Statement 51' }],
};

export const viewport: Viewport = {
  /* Matches --background so the browser chrome on mobile blends with the
     warm canvas instead of banding against it. */
  themeColor: '#FBFAF8',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
