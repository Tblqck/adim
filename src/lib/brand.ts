/**
 * The product's name and mark, wherever a person meets them: page titles, the
 * sign-in screen, the logo, the issuer an authenticator app lists, the
 * User-Agent the screening updaters announce themselves with.
 *
 * This is the white-label seam — one place, set from the environment:
 *
 *   NEXT_PUBLIC_BRAND_NAME   the name shown everywhere (default: idntory)
 *   NEXT_PUBLIC_BRAND_LOGO   optional image URL or /public path that replaces
 *                            the lettered mark in the logo, e.g. /brand/logo.svg
 *
 * Both are inlined into the browser bundle when the app is built, so set them
 * before `npm run build`. next.config.ts supplies the same defaults to the
 * build; this module repeats them for code that runs outside one — the worker,
 * the seeder, the tests. Colours live in the `brand` palette of
 * tailwind.config.ts.
 */
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || 'idntory'

/** An image that replaces the lettered mark, when one is configured. */
export const BRAND_LOGO = process.env.NEXT_PUBLIC_BRAND_LOGO?.trim() || null

/**
 * A full wordmark image (mark and name in one picture, like the idntory
 * logo). When set it is the whole lockup — no tile, no typed name beside it.
 * Defaults to the idntory logo the current dashboard ships.
 */
export const BRAND_WORDMARK =
  process.env.NEXT_PUBLIC_BRAND_WORDMARK === undefined
    ? `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/brand/idntory-logo.png`
    : process.env.NEXT_PUBLIC_BRAND_WORDMARK.trim() || null

/**
 * The one or two letters the logo prints in its tile: the initials of the
 * first two words, or the first two letters of a one-word name.
 */
export const BRAND_MARK = markOf(BRAND_NAME)

/** The name as a machine token, for User-Agent strings and file prefixes. */
export const BRAND_SLUG =
  BRAND_NAME.toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'kyc-platform'

function markOf(name: string): string {
  const words = name.split(/\s+/u).filter((word) => /\p{L}/u.test(word))
  const [first, second] = words
  if (!first) return 'K'
  if (!second) return first.slice(0, 2).toUpperCase()
  return `${first[0] ?? ''}${second[0] ?? ''}`.toUpperCase()
}
