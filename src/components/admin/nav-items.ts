import { Icons, type IconComponent } from '@/components/ui'
import type { Me } from '@/lib/types'

export interface AdminNavItem {
  href: string
  label: string
  icon: IconComponent
  /** Match nested routes (e.g. /admin/verifications/:id) as active. */
  matchNested: boolean
  /**
   * The white-label design has this section, but the live API server has no
   * endpoint behind it yet. The page stays (the design is the brief) and
   * says so plainly instead of showing invented data.
   */
  notWired?: boolean
  /** Hide from sessions that would only get a 403/400 from the server. */
  visible?: (me: Me) => boolean
}

const superAdminOnly = (me: Me) => me.super_admin
// /firm-users is firm-scoped: a super-admin session has no single firm's
// employees to list, and the server answers it with a 400.
const firmUserManagers = (me: Me) => !me.super_admin && !!me.can_create_users
// The log shows colleagues' sign-ins and actions: the server gives it to the
// same people who manage logins (and the back office).
const auditReaders = (me: Me) => me.super_admin || !!me.can_create_users

/**
 * Primary navigation, in the white-label order, with the live dashboard's own
 * pages (Generate link, Document check, API, Guide) slotted in beside the
 * sections they belong with.
 */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: '/admin', label: 'Overview', icon: Icons.LayoutDashboard, matchNested: false },
  { href: '/admin/verifications', label: 'Verifications', icon: Icons.ClipboardList, matchNested: true },
  { href: '/admin/links', label: 'Generate link', icon: Icons.Link, matchNested: true },
  { href: '/admin/document-check', label: 'Document check', icon: Icons.Passport, matchNested: true },
  { href: '/admin/aml', label: 'AML', icon: Icons.ShieldCheck, matchNested: true },
  { href: '/admin/templates', label: 'Templates', icon: Icons.CreditCard, matchNested: true },
  { href: '/admin/risk-policy', label: 'Risk Policy', icon: Icons.AlertTriangle, matchNested: true, notWired: true },
  { href: '/admin/companies', label: 'Companies', icon: Icons.Building, matchNested: true, visible: superAdminOnly },
  { href: '/admin/users', label: 'Users', icon: Icons.Users, matchNested: true, visible: firmUserManagers },
  { href: '/admin/audit-log', label: 'Audit Log', icon: Icons.History, matchNested: true, notWired: true, visible: auditReaders },
  { href: '/admin/recycle-bin', label: 'Recycle Bin', icon: Icons.Trash, matchNested: true },
  { href: '/admin/aml-settings', label: 'AML settings', icon: Icons.Database, matchNested: true },
  { href: '/admin/backup-settings', label: 'Backup', icon: Icons.Refresh, matchNested: true, notWired: true },
  { href: '/admin/api', label: 'API', icon: Icons.Lock, matchNested: true },
  { href: '/admin/guide', label: 'Guide', icon: Icons.Info, matchNested: true },
]

export const ADMIN_SETTINGS_NAV: AdminNavItem = {
  href: '/admin/settings',
  label: 'Settings',
  icon: Icons.Settings,
  matchNested: true,
}

export function isNavItemActive(item: AdminNavItem, pathname: string): boolean {
  return pathname === item.href || (item.matchNested && pathname.startsWith(`${item.href}/`))
}

/** Routes whose content is rows rather than prose — they get the wide column. */
const WIDE_ROUTES: readonly string[] = [
  '/admin/verifications',
  '/admin/links',
  '/admin/aml-settings',
  '/admin/companies',
  '/admin/users',
  '/admin/recycle-bin',
]

export function usesWideLayout(pathname: string): boolean {
  return WIDE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

/** The verification review renders its own header and width. */
export function ownsPageChrome(pathname: string): boolean {
  return /^\/admin\/verifications\/[^/]+$/.test(pathname)
}
