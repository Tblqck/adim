import qrcode from 'qrcode-generator'
import { cn } from '@/lib/utils/cn'

/**
 * QR code rendered as inline SVG.
 *
 * Drawn as one `<path>` of module squares rather than thousands of `<rect>`
 * elements, and rendered on the server so no client-side encoder ships.
 *
 * Error-correction level M gives ~15% recovery, which is ample for a code
 * displayed on screen and scanned from a phone.
 */
export function QrCode({
  value,
  size = 176,
  className,
  title = 'QR code',
}: {
  value: string
  /** Rendered edge length in CSS pixels. */
  size?: number
  className?: string
  title?: string
}) {
  // typeNumber 0 lets the encoder pick the smallest version that fits.
  const qr = qrcode(0, 'M')
  qr.addData(value)
  qr.make()

  const count = qr.getModuleCount()
  const quiet = 2 // modules of quiet zone, per spec minimum for compact display
  const extent = count + quiet * 2

  let path = ''
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        path += `M${col + quiet} ${row + quiet}h1v1h-1z`
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      role="img"
      aria-label={title}
      shapeRendering="crispEdges"
      className={cn('rounded-lg bg-white p-0', className)}
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#0a0a0a" />
    </svg>
  )
}
