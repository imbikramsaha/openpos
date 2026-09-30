import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { ArrowUpRight, ChevronRight, SearchX, UserCog } from 'lucide-react'
import { navigate, useRoute } from '@/router'
import { useSession } from '@/stores/session'
import { cn } from '@/lib/cn'
import { Card, EmptyState, Page, PageBody, PageHeader, SearchInput } from '@/components/ui'
import { BRAND_LABELS, DESKTOP_ONLY, FALLBACK_ANCHOR, GROUPS, SECTIONS, findSection, normalize, type SectionDef, type SectionId } from './registry'
import { isElectron } from '@/lib/platform'
import { useMediaQuery } from './hooks'
import { BusinessSection } from './sections/BusinessSection'
import { TaxesSection } from './sections/TaxesSection'
import { FormatsSection } from './sections/FormatsSection'
import { CheckoutSection } from './sections/CheckoutSection'
import { ReceiptSection } from './sections/ReceiptSection'
import { ScaleSection } from './sections/ScaleSection'
import { DeviceSection } from './sections/DeviceSection'
import { SyncSection } from './sections/SyncSection'
import { BackupSection } from './sections/BackupSection'
import { AutoBackupSection } from './sections/AutoBackupSection'
import { AuditSection } from './sections/AuditSection'
import { DangerSection } from './sections/DangerSection'
import { AboutSection } from './sections/AboutSection'

const COMPONENTS: Record<SectionId, ComponentType> = {
  business: BusinessSection,
  taxes: TaxesSection,
  formats: FormatsSection,
  checkout: CheckoutSection,
  receipt: ReceiptSection,
  scale: ScaleSection,
  device: DeviceSection,
  sync: SyncSection,
  backup: BackupSection,
  autoBackup: AutoBackupSection,
  audit: AuditSection,
  danger: DangerSection,
  about: AboutSection,
}

interface SearchHit {
  section: SectionDef
  items: Array<{ id: string; label: string }>
}

function useSearch(query: string): SearchHit[] | null {
  const { t } = useTranslation('settings')
  return useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return null
    // Also match English labels so staff can search with English terms in any UI language.
    const en = i18n.getFixedT('en', 'settings')
    // Short queries match at the start of a word ("upi" shouldn't find "grouping"); longer ones
    // anywhere, which also covers compound words and scripts written without spaces.
    const wordStart = new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u')
    const matches = (text: string) => {
      const n = normalize(text)
      return q.length >= 4 || !/\s/.test(n) ? n.includes(q) : wordStart.test(n)
    }
    const hit = (key: string) => {
      if (!i18n.exists(`settings:${key}`)) return false
      return matches(t(key)) || matches(en(key))
    }
    // An item's label is its own string, else its card title ("…Title"), else a product name.
    const label = (id: string) => BRAND_LABELS[id] ?? (i18n.exists(`settings:${id}`) ? t(id) : i18n.exists(`settings:${id}Title`) ? t(`${id}Title`) : undefined)
    const itemHit = (id: string) => (BRAND_LABELS[id] ? matches(BRAND_LABELS[id]) : false) || hit(id) || hit(`${id}Title`) || hit(`${id}Hint`)
    const available = (id: string) => !DESKTOP_ONLY.has(id) || isElectron()
    return SECTIONS.map((section) => {
      const base = `sections.${section.id}`
      const sectionHit = hit(`${base}.title`) || hit(`${base}.desc`) || hit(`${base}.keywords`)
      const items = section.items.filter((id) => available(id) && !!label(id) && itemHit(id)).map((id) => ({ id, label: label(id)! }))
      return sectionHit || items.length ? { section, items } : null
    }).filter((x): x is SearchHit => !!x)
  }, [query, t])
}

/** Scrolls to a setting and briefly highlights it. */
function useHighlight(target: { id: string; n: number } | null) {
  useEffect(() => {
    if (!target) return
    let tries = 0
    let raf = 0
    let el: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const cls = ['bg-primary-soft', 'ring-2', 'ring-inset', 'ring-primary']
    const find = () => {
      // A setting that's hidden right now (e.g. loyalty rates while loyalty is off) highlights the switch that shows it.
      const id = tries > 20 && FALLBACK_ANCHOR[target.id] ? FALLBACK_ANCHOR[target.id] : target.id
      el = document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(id)}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add(...cls)
        timer = setTimeout(() => el?.classList.remove(...cls), 1800)
      } else if (tries++ < 40) raf = requestAnimationFrame(find)
    }
    raf = requestAnimationFrame(find)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      el?.classList.remove(...cls)
    }
  }, [target])
}

export default function SettingsScreen() {
  const { t } = useTranslation('settings')
  const route = useRoute()
  const wide = useMediaQuery('(min-width: 1024px)')
  const canUsers = useSession((s) => s.can('users_manage'))
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const results = useSearch(query)
  const current = findSection(route.sub.split('/')[0])
  const active = current ?? (wide ? SECTIONS[0] : undefined)
  useHighlight(focus)

  const open = (id: SectionId, item?: string) => {
    navigate(`settings/${id}`)
    if (item) setFocus({ id: item, n: Date.now() })
    else scrollRef.current?.scrollTo({ top: 0 })
  }

  const search = (
    <SearchInput value={query} onChange={setQuery} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
  )

  const nav = results ? (
    <SearchResults results={results} activeId={active?.id} onOpen={open} query={query} />
  ) : (
    <SectionNav activeId={active?.id} onOpen={open} card={!wide} canUsers={canUsers} />
  )

  if (!wide) {
    if (!active) {
      return (
        <Page>
          <PageHeader title={t('title')} subtitle={t('subtitle')}>
            {search}
          </PageHeader>
          <PageBody>{nav}</PageBody>
        </Page>
      )
    }
    const Section = COMPONENTS[active.id]
    return (
      <Page>
        <PageHeader onBack={() => navigate('settings')} title={t(`sections.${active.id}.title`)} subtitle={t(`sections.${active.id}.desc`)} />
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Section key={active.id} />
        </div>
      </Page>
    )
  }

  const Section = COMPONENTS[active!.id]
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-e border-border bg-surface xl:w-80">
        <div className="space-y-3 px-4 pt-5 pb-3">
          <h1 className="px-1 text-xl font-semibold tracking-tight">{t('title')}</h1>
          {search}
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-6" aria-label={t('title')}>
          {nav}
        </nav>
      </aside>
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
        <div className={cn('mx-auto px-6 py-6 xl:px-10', active!.wide ? 'max-w-6xl' : 'max-w-3xl')}>
          <header className="mb-5 flex items-start gap-3">
            <SectionIcon section={active!} />
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight">{t(`sections.${active!.id}.title`)}</h2>
              <p className="text-sm text-muted">{t(`sections.${active!.id}.desc`)}</p>
            </div>
          </header>
          <Section key={active!.id} />
        </div>
      </div>
    </div>
  )
}

function SectionIcon({ section, small }: { section: SectionDef; small?: boolean }) {
  const Icon = section.icon
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl',
        small ? 'size-9 [&>svg]:size-[18px]' : 'size-11 [&>svg]:size-5.5',
        section.id === 'danger' ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary',
      )}
    >
      <Icon />
    </span>
  )
}

function SectionNav({ activeId, onOpen, card, canUsers }: { activeId?: SectionId; onOpen: (id: SectionId) => void; card: boolean; canUsers: boolean }) {
  const { t } = useTranslation('settings')
  return (
    <div className={card ? 'space-y-6' : 'space-y-5'}>
      {GROUPS.map((g) => {
        const list = SECTIONS.filter((s) => s.group === g)
        const rows = (
          <ul className={card ? 'divide-y divide-border' : 'space-y-0.5'}>
            {list.map((s) => (
              <li key={s.id}>
                <NavButton section={s} active={!card && s.id === activeId} card={card} onClick={() => onOpen(s.id)} />
              </li>
            ))}
            {g === 'store' && canUsers && (
              <li>
                <button
                  onClick={() => navigate('users')}
                  className={cn('flex w-full items-center gap-3 text-start transition-colors', card ? 'min-h-16 px-4 py-3 active:bg-surface-3' : 'min-h-11 rounded-xl px-2.5 py-2 text-muted hover:bg-surface-3 hover:text-fg')}
                >
                  {card ? (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary [&>svg]:size-[18px]">
                      <UserCog />
                    </span>
                  ) : (
                    <UserCog className="size-[18px] shrink-0" strokeWidth={1.9} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate', card ? 'font-medium text-fg' : 'text-sm font-medium')}>{t('usersLink')}</span>
                    {card && <span className="block truncate text-xs text-subtle">{t('usersLinkHint')}</span>}
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-subtle rtl:-scale-x-100" />
                </button>
              </li>
            )}
          </ul>
        )
        return (
          <section key={g}>
            <h3 className={cn('mb-2 text-xs font-semibold tracking-wide text-subtle uppercase', card ? 'px-1' : 'px-2.5')}>{t(`groups.${g}`)}</h3>
            {card ? <Card className="overflow-hidden">{rows}</Card> : rows}
          </section>
        )
      })}
    </div>
  )
}

function NavButton({ section, active, card, onClick }: { section: SectionDef; active: boolean; card: boolean; onClick: () => void }) {
  const { t } = useTranslation('settings')
  const Icon = section.icon
  if (card) {
    return (
      <button onClick={onClick} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start transition-colors active:bg-surface-3">
        <SectionIcon section={section} small />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{t(`sections.${section.id}.title`)}</span>
          <span className="block truncate text-xs text-subtle">{t(`sections.${section.id}.desc`)}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-subtle rtl:rotate-180" />
      </button>
    )
  }
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start text-sm font-medium transition-colors',
        active ? 'bg-primary-soft text-primary' : section.id === 'danger' ? 'text-danger hover:bg-danger-soft' : 'text-muted hover:bg-surface-3 hover:text-fg',
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={active ? 2.3 : 1.9} />
      <span className="min-w-0 flex-1 truncate">{t(`sections.${section.id}.title`)}</span>
    </button>
  )
}

function SearchResults({ results, activeId, onOpen, query }: { results: SearchHit[]; activeId?: SectionId; onOpen: (id: SectionId, item?: string) => void; query: string }) {
  const { t } = useTranslation('settings')
  if (!results.length) {
    return <EmptyState icon={<SearchX />} title={t('noMatches', { query: query.trim() })} description={t('noMatchesHint')} className="py-10" />
  }
  return (
    <div className="space-y-4">
      <p className="px-2.5 text-xs text-subtle">{t('results', { count: results.reduce((s, r) => s + Math.max(1, r.items.length), 0) })}</p>
      {results.map(({ section, items }) => (
        <section key={section.id}>
          <button
            onClick={() => onOpen(section.id)}
            className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-sm font-semibold transition-colors hover:bg-surface-3', section.id === activeId && 'text-primary')}
          >
            <SectionIcon section={section} small />
            <span className="min-w-0 flex-1 truncate">{t(`sections.${section.id}.title`)}</span>
          </button>
          {items.length > 0 && (
            <ul className="ms-7 mt-0.5 space-y-0.5 border-s border-border ps-3">
              {items.map((it) => (
                <li key={it.id}>
                  <button onClick={() => onOpen(section.id, it.id)} className="flex min-h-10 w-full items-center rounded-lg px-2.5 py-1.5 text-start text-sm text-muted transition-colors hover:bg-surface-3 hover:text-fg">
                    <Highlight text={it.label} query={query} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return <>{text}</>
  return (
    <span>
      {text.slice(0, i)}
      <mark className="rounded bg-warning-soft px-0.5 text-fg">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </span>
  )
}
