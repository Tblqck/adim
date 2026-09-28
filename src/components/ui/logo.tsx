import { BRAND_LOGO, BRAND_MARK, BRAND_NAME, BRAND_WORDMARK } from '@/lib/brand'
import { cn } from '@/lib/utils/cn'

type LogoSize = 'sm' | 'md' | 'lg'

const MARK_SIZE: Record<LogoSize, string> = {
  sm: 'h-6 w-6 text-[10px] rounded-md',
  md: 'h-7 w-7 text-[11px] rounded-lg',
  lg: 'h-11 w-11 text-base rounded-xl',
}

/** Wordmark image heights; the idntory logo is ~3.5:1. */
const WORDMARK_SIZE: Record<LogoSize, string> = {
  sm: 'h-5',
  md: 'h-7',
  lg: 'h-10',
}

const WORD_SIZE: Record<LogoSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl',
}

/**
 * The product lockup: a mark followed by the wordmark, both from
 * `src/lib/brand.ts`. The mark is the configured logo image when there is
 * one, otherwise the brand's initials on a brand-coloured tile.
 *
 * `wordmark={false}` renders the mark alone for tight spaces.
 */
export function Logo({
  size = 'md',
  wordmark = true,
  className,
}: {
  size?: LogoSize
  wordmark?: boolean
  className?: string
}) {
  if (BRAND_WORDMARK && wordmark) {
    return (
      <span className={cn('inline-flex select-none items-center', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND_WORDMARK} alt={BRAND_NAME} className={cn('w-auto object-contain', WORDMARK_SIZE[size])} />
      </span>
    )
  }

  return (
    <span className={cn('inline-flex select-none items-center gap-2.5', className)}>
      {BRAND_LOGO ? (
        // A configured logo is an arbitrary file from /public or a CDN; the
        // image optimiser would need its host allow-listed to serve it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={BRAND_LOGO}
          alt=""
          aria-hidden="true"
          className={cn('object-contain', MARK_SIZE[size])}
        />
      ) : (
        <span
          className={cn(
            'flex items-center justify-center bg-brand-600 font-bold leading-none tracking-tight text-white shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset]',
            MARK_SIZE[size],
          )}
          aria-hidden="true"
        >
          {BRAND_MARK}
        </span>
      )}
      {wordmark ? (
        <span className={cn('font-semibold tracking-tight text-white', WORD_SIZE[size])}>
          {BRAND_NAME}
        </span>
      ) : null}
      <span className="sr-only">{BRAND_NAME}</span>
    </span>
  )
}
