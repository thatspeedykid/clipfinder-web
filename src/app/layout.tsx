// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ClipFinder — AI Drama Clip Extractor',
  description: 'Find the best viral moments in any YouTube or Kick stream. AI-powered, no watermarks.',
  openGraph: {
    title: 'ClipFinder',
    description: 'AI-powered viral clip detection for streamers and editors',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0f0f0f] text-white antialiased min-h-screen">
        {children}
      </body>
    </html>
  )
}
