/**
 * UI kit.
 *
 * Import from '@/components/ui' rather than reaching into individual files —
 * it keeps the public surface of the design system explicit.
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from '@/components/ui/button'
export { Card, CardHeader, CardBody, CardFooter } from '@/components/ui/card'
export { ConfirmDialog } from '@/components/ui/confirm-dialog'
export { Dialog } from '@/components/ui/dialog'
export { EmptyState } from '@/components/ui/empty-state'
export { Field } from '@/components/ui/field'
export { Icons, type IconProps, type IconComponent } from '@/components/ui/icons'
export { Input, type InputProps } from '@/components/ui/input'
export { LoadingState, Skeleton, Spinner, TableSkeleton } from '@/components/ui/loading'
export { Logo } from '@/components/ui/logo'
export {
  ProgressBar,
  IndeterminateBar,
  StepProgress,
  type Step,
  type StepState,
} from '@/components/ui/progress'
export { QrCode } from '@/components/ui/qr-code'
export { Select, type SelectProps } from '@/components/ui/select'
export { ToastProvider, useToast, type ToastTone } from '@/components/ui/toast'
export {
  StatusBadge,
  VERIFICATION_STATUS_LABEL,
  VERIFICATION_STATUS_TONE,
  type StatusTone,
} from '@/components/ui/status-badge'
