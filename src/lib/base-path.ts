/**
 * The path the dashboard is served under ('' locally, '/v2' on the server
 * beside the old dashboard). Next applies it to <Link>, the router and its
 * own assets, but not to a plain fetch(), a window.location assignment or an
 * <img src> -- those go through withBase().
 *
 * Set at build time (BASE_PATH, see next.config.ts).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`
}
