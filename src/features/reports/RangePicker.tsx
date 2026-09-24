import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fromDateInput, toDateInput } from '@/lib/dates'
import { Button } from '@/components/ui'
import { PRESETS, customRange, presetRange, rangeLabel, type Range } from './range'

// Date-range control: preset rows (a check marks the selection) with a custom
// from/to range behind a hairline in the footer.

export function RangePicker({ value, onChange, locale }: { value: Range; onChange: (r: Range) => void; locale: string }) {
  const { t } = useTranslation('reports')
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(toDateInput(value.from))
  const [to, setTo] = useState(toDateInput(value.to))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setFrom(toDateInput(value.from))
    setTo(toDateInput(value.to))
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, value])

  const pick = (r: Range) => {
    onChange(r)
    setOpen(false)
  }
  const applyCustom = () => {
    if (!from || !to) return
    pick(customRange(fromDateInput(from), fromDateInput(to)))
  }
  const name = value.preset === 'custom' ? t('customRange') : t(`common:${value.preset}`)

  return (
    <div ref={ref} className="relative">
      <Button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        icon={<CalendarDays className="size-4 text-muted" />}
        iconRight={<ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />}
        className="h-11 max-w-full"
      >
        <span className="font-semibold">{name}</span>
        <span className="hidden truncate text-muted sm:inline">· {rangeLabel(value.from, value.to)}</span>
      </Button>
      {open && (
        <div role="dialog" aria-label={t('dateRange')} className="animate-pop absolute start-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-1.5 shadow-pop">
          <ul role="listbox" aria-label={t('dateRange')}>
            {PRESETS.map((p) => {
              const r = presetRange(p, locale)
              const selected = value.preset === p
              return (
                <li key={p}>
                  <button
                    role="option"
                    aria-selected={selected}
                    onClick={() => pick(r)}
                    className={cn('flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors hover:bg-surface-3', selected && 'font-semibold')}
                  >
                    <Check className={cn('size-4 shrink-0 text-primary', !selected && 'invisible')} strokeWidth={3} />
                    <span className="flex-1 text-start">{t(`common:${p}`)}</span>
                    <span className="tnum text-xs font-normal text-subtle">{rangeLabel(r.from, r.to)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <form
            className="mt-1 border-t border-border p-2"
            onSubmit={(e) => {
              e.preventDefault()
              applyCustom()
            }}
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Check className={cn('size-4 shrink-0 text-primary', value.preset !== 'custom' && 'invisible')} strokeWidth={3} />
              {t('customRange')}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">
                {t('common:from')}
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm text-fg focus:border-primary focus:ring-4 focus:ring-[var(--ring)] focus:outline-none" />
              </label>
              <label className="text-xs text-muted">
                {t('common:to')}
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm text-fg focus:border-primary focus:ring-4 focus:ring-[var(--ring)] focus:outline-none" />
              </label>
            </div>
            <Button type="submit" variant="primary" block className="mt-2" disabled={!from || !to}>
              {t('common:apply')}
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
