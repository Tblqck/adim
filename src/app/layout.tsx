import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import localFont from 'next/font/local'
import '@/app/globals.css'
import { BRAND_NAME } from '@/lib/brand'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

/**
 * Flag glyphs, because Windows has none: country flags are two
 * regional-indicator letters, which Windows draws as the letters. The font
 * holds nothing but flags, so placing it first in the stack costs nothing.
 */
const flags = localFont({
  src: '../fonts/TwemojiCountryFlags.woff2',
  display: 'swap',
  variable: '--font-flags',
})

export const metadata: Metadata = {
  title: {
    default: `${BRAND_NAME} Admin`,
    template: `%s · ${BRAND_NAME} Admin`,
  },
  applicationName: BRAND_NAME,
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${flags.variable}`} suppressHydrationWarning>
      <body className="min-h-[100dvh] bg-canvas font-sans">{children}</body>
    </html>
  )
}
