import type { NextConfig } from 'next'

/** White-label: see src/lib/brand.ts. Inlined at build time, so set before `npm run build`. */
const brandName = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || 'idntory'
const brandLogo = process.env.NEXT_PUBLIC_BRAND_LOGO?.trim() || ''
const brandWordmark = process.env.NEXT_PUBLIC_BRAND_WORDMARK ?? '/brand/idntory-logo.png'

// Served under a sub-path on the server (beside the old dashboard at /admin):
// BASE_PATH=/v2. Build-time -- change it, rebuild. See src/lib/base-path.ts.
const basePath = process.env.BASE_PATH?.trim() || ''

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(basePath ? { basePath } : {}),
  // A self-contained server bundle for the Docker image (Dockerfile).
  output: 'standalone',
  // The sample instance (npm run sample) runs beside the live one, so it
  // needs its own build folder.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: {
    NEXT_PUBLIC_BRAND_NAME: brandName,
    NEXT_PUBLIC_BRAND_LOGO: brandLogo,
    NEXT_PUBLIC_BRAND_WORDMARK: brandWordmark,
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  poweredByHeader: false,
  // A stray lockfile higher up the tree (the user profile) would otherwise be
  // taken as the workspace root.
  outputFileTracingRoot: process.cwd(),
  eslint: {
    // Lint is run explicitly via `npm run lint` so build failures stay focused
    // on type/compile errors.
    ignoreDuringBuilds: true,
  },
  // The old FastAPI dashboard's addresses (bookmarks, links in emails), sent
  // to their pages here.
  async redirects() {
    return [
      { source: '/admin/login', destination: '/login', permanent: false },
      { source: '/admin/list', destination: '/admin/verifications', permanent: false },
      {
        source: '/admin/detail',
        has: [{ type: 'query', key: 'id', value: '(?<id>\\d+)' }],
        destination: '/admin/verifications/:id',
        permanent: false,
      },
      { source: '/admin/detail', destination: '/admin/verifications', permanent: false },
      { source: '/admin/screen', destination: '/admin/aml', permanent: false },
      { source: '/admin/kyb', destination: '/admin/aml', permanent: false },
      { source: '/admin/databases', destination: '/admin/aml-settings', permanent: false },
      { source: '/admin/generate-link', destination: '/admin/links', permanent: false },
      { source: '/admin/firms', destination: '/admin/companies', permanent: false },
      { source: '/admin/firm-detail', destination: '/admin/companies', permanent: false },
      { source: '/admin/user-detail', destination: '/admin/users', permanent: false },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Same reason the old FastAPI dashboard sent no-store on every page:
        // without it browsers heuristically cache HTML and a deploy looks
        // live in one browser and stale in another. Hashed build assets are
        // left cacheable — their names change with every build.
        source: '/((?!_next/static).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

export default nextConfig
