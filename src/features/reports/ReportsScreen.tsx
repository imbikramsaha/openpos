import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, ChartLine, Landmark, LayoutGrid, Package, Printer, Users, UserRound, Wallet } from 'lucide-react'
import { navigate, useRoute } from '@/router'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/cn'
import { toDateInput } from '@/lib/dates'
import { Button, Page, PageBody, PageHeader, Select, Spinner, Tabs, type TabItem } from '@/components/ui'
import { presetRange, rangeLabel, type PresetId, type Range } from './range'
import { useReport } from './useReport'
import { RangePicker } from './RangePicker'
import { ReportMetaContext, terminalLabel, type ReportMeta } from './context'
import { printSummary } from './summary'
import { OverviewTab } from './tabs/Overview'
import { CategoriesTab, ProductsTab } from './tabs/Products'
import { TaxTab } from './tabs/Tax'
import { PaymentsTab } from './tabs/Payments'
import { StaffTab } from './tabs/Staff'
import { CustomersTab } from './tabs/Customers'
import { InventoryTab } from './tabs/Inventory'

type TabId = 'overview' | 'products' | 'categories' | 'tax' | 'payments' | 'staff' | 'customers' | 'inventory'
const TAB_IDS: TabId[] = ['overview', 'products', 'categories', 'tax', 'payments', 'staff', 'customers', 'inventory']
const STORE = 'kasa.reports.range'

function loadRange(locale: string): Range {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null') as { preset: PresetId; from?: number; to?: number } | null
    if (saved?.preset === 'custom' && saved.from && saved.to) return { preset: 'custom', from: saved.from, to: saved.to }
    if (saved?.preset) return presetRange(saved.preset, locale)
  } catch {
    /* storage unavailable */
  }
  return presetRange('today', locale)
}

function saveRange(r: Range) {
  try {
    localStorage.setItem(STORE, JSON.stringify(r.preset === 'custom' ? r : { preset: r.preset }))
  } catch {
    /* ignore */
  }
}

export default function ReportsScreen() {
  const { t } = useTranslation('reports')
  const route = useRoute()
  const settings = useSettings((s) => s.settings)
  const locale = settings.numberLocale || 'en'
  const tab: TabId = TAB_IDS.includes(route.sub as TabId) ? (route.sub as TabId) : 'overview'
  const [range, setRange] = useState<Range>(() => loadRange(locale))
  const [terminal, setTerminal] = useState('')
  const report = useReport(range, terminal)
  const { data, loading } = report

  // Presets are relative to "now": refresh them when the day rolls over.
  useEffect(() => {
    if (range.preset === 'custom') return
    const id = setInterval(() => {
      const next = presetRange(range.preset, locale)
      if (next.from !== range.from || next.to !== range.to) setRange(next)
    }, 60_000)
    return () => clearInterval(id)
  }, [range, locale])

  const changeRange = (r: Range) => {
    setRange(r)
    saveRange(r)
  }

  const meta: ReportMeta = useMemo(
    () => ({
      rangeLabel: rangeLabel(range.from, range.to),
      prevLabel: rangeLabel(report.prev.from, report.prev.to),
      fileTag: range.preset === 'today' || toDateInput(range.from) === toDateInput(range.to) ? toDateInput(range.from) : `${toDateInput(range.from)}_${toDateInput(range.to)}`,
      settings,
    }),
    [range, report.prev, settings],
  )

  const terminals = data ? [...data.cur.allTerminals] : []
  // Keep the selected till listed (with the code seen earlier) even when the new range has no sales from it.
  const seenTerminals = useRef(new Map<string, string>())
  for (const [id, code] of terminals) seenTerminals.current.set(id, code)
  if (terminal && !terminals.some(([id]) => id === terminal)) terminals.push([terminal, seenTerminals.current.get(terminal) ?? ''])
  const tabs: TabItem<TabId>[] = [
    { id: 'overview', label: t('tabs.overview'), icon: <ChartLine /> },
    { id: 'products', label: t('tabs.products'), icon: <Package /> },
    { id: 'categories', label: t('tabs.categories'), icon: <LayoutGrid /> },
    { id: 'tax', label: t('tabs.tax'), icon: <Landmark /> },
    { id: 'payments', label: t('tabs.payments'), icon: <Wallet /> },
    { id: 'staff', label: t('tabs.staff'), icon: <UserRound /> },
    { id: 'customers', label: t('tabs.customers'), icon: <Users /> },
    { id: 'inventory', label: t('tabs.inventory'), icon: <Boxes /> },
  ]

  const body = () => {
    if (!data) return null
    const props = { data, report }
    switch (tab) {
      case 'products':
        return <ProductsTab {...props} />
      case 'categories':
        return <CategoriesTab {...props} />
      case 'tax':
        return <TaxTab {...props} />
      case 'payments':
        return <PaymentsTab {...props} />
      case 'staff':
        return <StaffTab {...props} />
      case 'customers':
        return <CustomersTab {...props} />
      case 'inventory':
        return <InventoryTab {...props} />
      default:
        return <OverviewTab {...props} />
    }
  }

  return (
    <ReportMetaContext.Provider value={meta}>
      <Page>
        <PageHeader
          title={t('title')}
          subtitle={tab === 'inventory' ? t('inventory.asOfNow') : t('comparedWith', { range: meta.prevLabel })}
          actions={
            tab === 'overview' && data ? (
              <Button icon={<Printer className="size-4" />} onClick={() => printSummary(data, report, settings, meta.rangeLabel)}>
                <span className="hidden sm:inline">{t('printSummary')}</span>
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            {tab !== 'inventory' && <RangePicker value={range} onChange={changeRange} locale={locale} />}
            {tab !== 'inventory' && (terminals.length > 1 || terminal) && (
              <Select
                value={terminal}
                onChange={(e) => setTerminal(e.target.value)}
                options={terminals.map(([id, code]) => ({ value: id, label: terminalLabel(id, code) }))}
                placeholder={t('allTerminals')}
                wrapperClassName="w-44"
                aria-label={t('terminal')}
              />
            )}
            {loading && data && <Spinner className="size-4" />}
          </div>
          <Tabs tabs={tabs} value={tab} onChange={(id) => navigate(id === 'overview' ? 'reports' : `reports/${id}`)} className="-mx-4 -mb-3 mt-2 border-b-0 px-2 sm:-mx-6 sm:px-4" />
        </PageHeader>
        <PageBody className={cn('bg-bg transition-opacity duration-200', loading && data && 'opacity-60')}>
          {data ? (
            <div className="mx-auto max-w-[1600px]" aria-busy={loading}>
              {body()}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-8" />
            </div>
          )}
        </PageBody>
      </Page>
    </ReportMetaContext.Provider>
  )
}
