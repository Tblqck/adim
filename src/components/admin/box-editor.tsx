'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils/cn'
import type { TemplateBox } from '@/lib/types'

/*
 * Redaction boxes over a card image. Coordinates are fractions of the card
 * (0..1), the same form the AI server stores, so nothing depends on the
 * size the image happens to be drawn at.
 *
 *   drag on the card        draw a new box
 *   drag a box              move it
 *   drag its corner          resize it
 *   click a box              select it (kind / delete in the side panel)
 *   Delete / Backspace       delete the selected box
 *
 * Locked boxes (an approved template's existing ones) can be selected but
 * not moved, resized or deleted: once the original card is gone, taking a
 * box away would have nothing to restore underneath it.
 */

export interface EditableBox extends TemplateBox {
  key: string
  locked?: boolean
}

const KIND_COLOUR: Record<TemplateBox['kind'], string> = {
  face: 'border-rose-400 bg-rose-500/20',
  text: 'border-amber-400 bg-amber-500/15',
  mrz: 'border-sky-400 bg-sky-500/20',
  barcode: 'border-violet-400 bg-violet-500/20',
  signature: 'border-emerald-400 bg-emerald-500/20',
  manual: 'border-brand-400 bg-brand-500/20',
}

type Drag =
  | { mode: 'draw'; startX: number; startY: number; key: string }
  | { mode: 'move' | 'resize'; key: string; startX: number; startY: number; origin: EditableBox }

const MIN = 0.01
const clamp = (v: number) => Math.min(1, Math.max(0, v))

export function BoxEditor({
  src,
  boxes,
  onChange,
  selected,
  onSelect,
  showBoxes = true,
}: {
  src: string
  boxes: EditableBox[]
  onChange: (boxes: EditableBox[]) => void
  selected: string | null
  onSelect: (key: string | null) => void
  showBoxes?: boolean
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const point = (e: { clientX: number; clientY: number }) => {
    const r = frame.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
  }

  const update = useCallback(
    (key: string, patch: Partial<EditableBox>) => onChange(boxes.map((b) => (b.key === key ? { ...b, ...patch } : b))),
    [boxes, onChange],
  )

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const p = point(e)
      if (drag.mode === 'draw') {
        const x = Math.min(drag.startX, p.x)
        const y = Math.min(drag.startY, p.y)
        update(drag.key, { x, y, w: Math.abs(p.x - drag.startX), h: Math.abs(p.y - drag.startY) })
      } else if (drag.mode === 'move') {
        const o = drag.origin
        update(drag.key, {
          x: clamp(Math.min(o.x + p.x - drag.startX, 1 - o.w)),
          y: clamp(Math.min(o.y + p.y - drag.startY, 1 - o.h)),
        })
      } else {
        const o = drag.origin
        update(drag.key, { w: Math.max(MIN, Math.min(1 - o.x, o.w + p.x - drag.startX)), h: Math.max(MIN, Math.min(1 - o.y, o.h + p.y - drag.startY)) })
      }
    }
    const up = () => {
      if (drag.mode === 'draw') {
        const box = boxes.find((b) => b.key === drag.key)
        if (box && (box.w < MIN || box.h < MIN)) onChange(boxes.filter((b) => b.key !== drag.key))
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, boxes, onChange, update])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.key !== 'Delete' && e.key !== 'Backspace')) return
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      const box = boxes.find((b) => b.key === selected)
      if (box && !box.locked) {
        onChange(boxes.filter((b) => b.key !== selected))
        onSelect(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, boxes, onChange, onSelect])

  function startDraw(e: ReactPointerEvent) {
    if (e.button !== 0) return
    const p = point(e)
    const key = `new-${Date.now()}`
    onChange([...boxes, { key, kind: 'manual', x: p.x, y: p.y, w: 0, h: 0, note: 'added by an admin' }])
    onSelect(key)
    setDrag({ mode: 'draw', startX: p.x, startY: p.y, key })
  }

  return (
    <div
      ref={frame}
      className="relative select-none overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950"
      style={{ touchAction: 'none' }}
      onPointerDown={startDraw}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the admin relay, cookie-authenticated */}
      <img src={src} alt="Template card" className="pointer-events-none block w-full" draggable={false} />
      {showBoxes
        ? boxes.map((b) => (
            <div
              key={b.key}
              role="button"
              aria-label={`${b.kind} box`}
              onPointerDown={(e) => {
                e.stopPropagation()
                onSelect(b.key)
                if (b.locked || e.button !== 0) return
                const p = point(e)
                setDrag({ mode: 'move', key: b.key, startX: p.x, startY: p.y, origin: b })
              }}
              className={cn(
                'absolute border-2',
                KIND_COLOUR[b.kind],
                b.locked ? 'cursor-default border-dashed' : 'cursor-move',
                selected === b.key && 'ring-2 ring-white ring-offset-1 ring-offset-transparent',
              )}
              style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
            >
              {!b.locked && selected === b.key ? (
                <span
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    const p = point(e)
                    setDrag({ mode: 'resize', key: b.key, startX: p.x, startY: p.y, origin: b })
                  }}
                  className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-neutral-900"
                />
              ) : null}
            </div>
          ))
        : null}
    </div>
  )
}
