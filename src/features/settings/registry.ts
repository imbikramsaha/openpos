import { CloudUpload,
  Archive, Barcode, Coins, Info, MonitorSmartphone, Percent, Receipt, RefreshCw, ScrollText, ShoppingCart, Store, TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

// Settings navigation + search index. Each item id is both the i18n label key in the
// `settings` namespace and the `data-setting` anchor the search scrolls to.

export type SectionId =
  | 'business' | 'taxes' | 'formats' | 'checkout' | 'receipt' | 'scale'
  | 'device' | 'sync'
  | 'backup' | 'autoBackup' | 'audit' | 'danger' | 'about'

export type SectionGroup = 'store' | 'terminal' | 'system'

export interface SectionDef {
  id: SectionId
  group: SectionGroup
  icon: LucideIcon
  /** Setting ids (i18n keys) that search can find. */
  items: string[]
  /** Wider content area (live previews). */
  wide?: boolean
}

export const SECTIONS: SectionDef[] = [
  {
    id: 'business', group: 'store', icon: Store,
    items: ['business.name', 'business.legalName', 'business.address', 'business.phone', 'business.email', 'business.website', 'business.taxLabel', 'business.taxNumber', 'business.country', 'business.state', 'business.logo'],
  },
  { id: 'taxes', group: 'store', icon: Percent, items: ['taxes.rates', 'taxes.pricesIncludeTax', 'taxes.gstMode'] },
  { id: 'formats', group: 'store', icon: Coins, items: ['formats.currency', 'formats.numberLocale', 'formats.cashRounding'] },
  {
    id: 'checkout', group: 'store', icon: ShoppingCart,
    items: ['checkout.allowNegativeStock', 'checkout.requireShift', 'checkout.orderTypes', 'checkout.lockAfterSale', 'checkout.autoLock', 'checkout.payments', 'checkout.quickCash', 'checkout.upiId', 'checkout.upiName', 'checkout.loyalty', 'checkout.loyaltyEarnRate', 'checkout.loyaltyPointValue'],
  },
  {
    id: 'receipt', group: 'store', icon: Receipt, wide: true,
    items: ['receipt.header', 'receipt.footer', 'receipt.paperWidth', 'receipt.showLogo', 'receipt.showTaxBreakdown', 'receipt.showBarcode', 'receipt.showSku', 'receipt.showCustomer', 'receipt.autoPrint', 'receipt.copies', 'receipt.testPrint'],
  },
  { id: 'scale', group: 'store', icon: Barcode, items: ['scale.enabled', 'scale.prefixes', 'scale.itemDigits', 'scale.valueDigits', 'scale.valueType', 'scale.divisor', 'scale.test'] },
  {
    id: 'device', group: 'terminal', icon: MonitorSmartphone,
    items: ['device.terminal', 'device.terminalName', 'device.language', 'device.theme', 'device.cartSide', 'device.gridSize', 'device.showImages', 'device.sound', 'device.cameraScanner', 'device.printer', 'device.silentPrint', 'device.testPage'],
  },
  { id: 'sync', group: 'terminal', icon: RefreshCw, items: ['sync.status', 'sync.serverUrl', 'sync.storeKey', 'sync.enabled', 'sync.test', 'sync.now'] },
  { id: 'backup', group: 'system', icon: Archive, items: ['backup.export', 'backup.import'] },
  { id: 'autoBackup', group: 'system', icon: CloudUpload, items: ['autoBackup.schedule', 'autoBackup.encrypt', 'autoBackup.device', 'autoBackup.folder', 'autoBackup.gdrive', 'autoBackup.onedrive', 'autoBackup.dropbox'] },
  { id: 'audit', group: 'system', icon: ScrollText, items: ['audit.log'] },
  { id: 'danger', group: 'system', icon: TriangleAlert, items: ['danger.erase'] },
  { id: 'about', group: 'system', icon: Info, items: ['about.version', 'about.storage', 'about.persist', 'about.shortcuts'] },
]

export const GROUPS: SectionGroup[] = ['store', 'terminal', 'system']

export const findSection = (id?: string) => SECTIONS.find((s) => s.id === id)

/** Case- and accent-insensitive match used by the settings search. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}
