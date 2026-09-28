'use client'

import { Icons, StatusBadge, type StatusTone } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import type { Assessment, ReviewIssue, ReviewTab } from '@/lib/assess'
import { RESULT_TONE } from '@/lib/assess'

const BAR: Record<StatusTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  brand: 'bg-brand-500',
  muted: 'bg-neutral-600',
  neutral: 'bg-neutral-500',
}

/**
 * The headline of the automated checks, with the decision beneath it — kept
 * in one card so nobody mistakes what the checks found for what a person
 * decided (the white-label's VerificationResult).
 */
export function ResultCard({ assessment, decision }: { assessment: Assessment; decision: { label: string; tone: StatusTone } | null }) {
  const tone = RESULT_TONE[assessment.kind]
  return (
    <div className="relative overflow-hidden rounded-xl border border-neutral-800 bg-surface">
      <div className={cn('absolute left-0 top-0 h-full w-1', BAR[tone])} aria-hidden="true" />
      <div className="p-6">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-400">Verification result</h2>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-3">
          <span className="text-2xl font-semibold text-white">{assessment.label}</span>
          <span className="text-sm text-neutral-400 sm:mb-1">{assessment.summary}</span>
        </div>
      </div>
      <div className="border-t border-neutral-800 bg-neutral-950/40 px-6 py-3.5 text-sm">
        <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Decision</span>
        <p className="mt-1 text-neutral-300">
          {decision ? (
            <span className={cn('font-medium', decision.tone === 'success' ? 'text-emerald-400' : 'text-rose-400')}>{decision.label}</span>
          ) : (
            <span className="text-neutral-400">Not decided yet — approve or reject once you have looked at the items above.</span>
          )}
        </p>
      </div>
    </div>
  )
}

const ISSUE_STYLE = {
  danger: { box: 'border-rose-500/30 bg-rose-500/5', icon: 'text-rose-400', Icon: Icons.Alert },
  warning: { box: 'border-amber-500/30 bg-amber-500/5', icon: 'text-amber-400', Icon: Icons.AlertTriangle },
  info: { box: 'border-neutral-800 bg-neutral-950/40', icon: 'text-neutral-500', Icon: Icons.Info },
} as const

/**
 * Every finding behind the headline, listed once, most serious first — a
 * count with nothing under it is an accusation without a charge sheet. Each
 * item says what wants attention and links to the tab holding its evidence.
 */
export function AttentionItems({ issues, onOpen }: { issues: ReviewIssue[]; onOpen: (tab: ReviewTab) => void }) {
  const attention = issues.filter((i) => i.severity !== 'info')
  const context = issues.filter((i) => i.severity === 'info')

  const render = (issue: ReviewIssue) => {
    const style = ISSUE_STYLE[issue.severity]
    return (
      <li key={issue.key} className={cn('rounded-lg border px-4 py-3.5', style.box)}>
        <div className="flex items-start gap-3">
          <style.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.icon)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="text-sm font-medium text-neutral-100">{issue.title}</p>
              {issue.tab !== 'overview' && issue.linkLabel ? (
                <button
                  type="button"
                  onClick={() => onOpen(issue.tab)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300"
                >
                  {issue.linkLabel}
                  <Icons.ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-neutral-400">{issue.description}</p>
            {issue.values ? (
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="shrink-0 text-neutral-500">Printed:</dt>
                  <dd className="font-mono text-neutral-300">{issue.values.printed ?? '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-neutral-500">MRZ:</dt>
                  <dd className="font-mono text-neutral-300">{issue.values.mrz ?? '—'}</dd>
                </div>
              </dl>
            ) : null}
            {issue.items?.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {issue.items.map((item) => (
                  <StatusBadge key={item} tone={issue.severity === 'danger' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'neutral'}>
                    {item}
                  </StatusBadge>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-6">
      {attention.length ? (
        <div>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">Needs attention</h3>
          <ul className="space-y-3">{attention.map(render)}</ul>
        </div>
      ) : null}
      {context.length ? (
        <div>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-500">For context</h3>
          <ul className="space-y-3">{context.map(render)}</ul>
        </div>
      ) : null}
    </div>
  )
}
