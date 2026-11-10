// Domain model shared by the UI, the local database and the sync server.
//
// Money is always stored as an integer in the currency's minor unit (paise, cents…).
// Quantities are plain numbers and may be fractional (weighed items).

export type ID = string
export type Minor = number

/** Fields every synced record carries. */
export interface Base {
  id: ID
  createdAt: number
  updatedAt: number
  /** Soft delete so deletions replicate to other terminals. */
  deleted?: boolean
}

export type Role = 'admin' | 'manager' | 'cashier'

export type Permission =
  | 'sell'
  | 'discount'
  | 'price_override'
  | 'refund'
  | 'void'
  | 'cash_drawer'
  | 'shift_manage'
  | 'sales_view'
  | 'products_manage'
  | 'inventory_manage'
  | 'customers_manage'
  | 'customers_credit'
  | 'reports_view'
  | 'settings_manage'
  | 'users_manage'

export interface User extends Base {
  name: string
  role: Role
  pinHash: string
  pinSalt: string
  /** Hash of the PIN's first 4 digits (same salt), so new PINs can be checked for prefix clashes. */
  pinPrefixHash?: string
  /** Extra permissions on top of the role defaults. */
  extraPermissions?: Permission[]
  active: boolean
  color?: string
}

export interface Category extends Base {
  name: string
  color: string
  sortOrder: number
}

export interface Tax extends Base {
  name: string
  /** Percentage, e.g. 18 for 18%. */
  rate: number
  isDefault?: boolean
}

export type Unit = 'pcs' | 'kg' | 'g' | 'l' | 'ml' | 'm' | 'box' | 'pack' | 'dozen' | 'hour' | 'service'

export interface Product extends Base {
  name: string
  sku?: string
  barcode?: string
  categoryId?: ID
  price: Minor
  cost: Minor
  taxId?: ID
  unit: Unit
  trackStock: boolean
  /** Derived locally from stock movements. Never synced as a value. */
  stock: number
  reorderLevel?: number
  color?: string
  /** Small data URL thumbnail. */
  image?: string
  favorite?: boolean
  active: boolean
  /** HSN/SAC code for Indian GST invoices. */
  hsn?: string
  description?: string
  /** Ask for the price at the till (open-price items). */
  openPrice?: boolean
  /** Sold by weight; the qty dialog opens automatically. */
  weighed?: boolean
  /** Maximum retail price printed on pack (India). */
  mrp?: Minor
}

export interface Customer extends Base {
  name: string
  phone?: string
  email?: string
  taxNumber?: string
  address?: string
  city?: string
  state?: string
  notes?: string
  loyaltyPoints: number
  /** Positive = customer owes the store (credit sale / khata). */
  balance: Minor
  /** Automatic discount percentage for this customer. */
  discountPercent?: number
  creditLimit?: Minor
}

export interface Supplier extends Base {
  name: string
  phone?: string
  email?: string
  taxNumber?: string
  address?: string
  notes?: string
}

export type DiscountType = 'percent' | 'amount'

export interface SaleLine {
  id: ID
  productId?: ID
  name: string
  sku?: string
  barcode?: string
  hsn?: string
  unit: Unit
  qty: number
  /** Unit price as charged (tax inclusive or exclusive per sale.pricesIncludeTax). */
  price: Minor
  cost: Minor
  discountType?: DiscountType
  discountValue?: number
  /** Line discount + share of the cart discount, in minor units. */
  discount: Minor
  taxId?: ID
  taxName?: string
  taxRate: number
  /** Amount excluding tax after discounts. */
  net: Minor
  tax: Minor
  /** Amount including tax after discounts. */
  total: Minor
  note?: string
  /** On refund lines: the id of the original sale line being returned. */
  refLineId?: ID
}

export type PaymentMethod = 'cash' | 'card' | 'upi' | 'credit' | 'voucher' | 'loyalty' | 'bank' | 'other'

export interface Payment {
  id: ID
  method: PaymentMethod
  amount: Minor
  reference?: string
}

export interface TaxBreakdown {
  taxId?: ID
  name: string
  rate: number
  taxable: Minor
  tax: Minor
}

export type OrderType = 'walkin' | 'dinein' | 'takeaway' | 'delivery'

export interface Sale extends Base {
  number: string
  type: 'sale' | 'refund'
  status: 'completed' | 'voided'
  /** For refunds, the original sale. */
  refundOf?: ID
  userId: ID
  userName: string
  customerId?: ID
  customerName?: string
  customerPhone?: string
  customerTaxNumber?: string
  /** The customer's state when the sale was made (a GST state code such as "27" in India). */
  customerState?: string
  shiftId?: ID
  deviceId: string
  lines: SaleLine[]
  pricesIncludeTax: boolean
  /** Sum of line totals before cart-level discount (tax incl.). */
  subtotal: Minor
  discountTotal: Minor
  cartDiscountType?: DiscountType
  cartDiscountValue?: number
  netTotal: Minor
  taxTotal: Minor
  rounding: Minor
  total: Minor
  payments: Payment[]
  paid: Minor
  change: Minor
  taxBreakdown: TaxBreakdown[]
  note?: string
  /** India GST: inter-state supplies use IGST instead of CGST+SGST. */
  interState?: boolean
  orderType?: OrderType
  table?: string
  loyaltyEarned?: number
  loyaltyRedeemed?: number
  voidReason?: string
  currency: string
}

export type StockMovementType = 'sale' | 'refund' | 'purchase' | 'adjustment' | 'count' | 'initial' | 'waste' | 'void'

/** Append-only stock ledger. Product.stock is the sum of these per product. */
export interface StockMovement extends Base {
  productId: ID
  qty: number
  type: StockMovementType
  refId?: ID
  note?: string
  userId?: ID
  cost?: Minor
}

export interface PurchaseLine {
  productId: ID
  name: string
  qty: number
  cost: Minor
}

export interface Purchase extends Base {
  number: string
  supplierId?: ID
  supplierName?: string
  invoiceNo?: string
  lines: PurchaseLine[]
  total: Minor
  paid: Minor
  note?: string
  userId: ID
}

export interface Shift extends Base {
  number: string
  deviceId: string
  userId: ID
  userName: string
  openedAt: number
  closedAt?: number
  openingFloat: Minor
  countedCash?: Minor
  expectedCash?: Minor
  difference?: Minor
  status: 'open' | 'closed'
  notes?: string
  closedById?: ID
  closedByName?: string
}

export interface CashMovement extends Base {
  shiftId?: ID
  type: 'in' | 'out'
  amount: Minor
  reason: string
  userId: ID
  userName: string
}

/** Money collected against a customer's credit balance (or credit added manually). */
export interface CustomerPayment extends Base {
  customerId: ID
  amount: Minor
  method: PaymentMethod
  note?: string
  userId: ID
  shiftId?: ID
  /** The till that took the payment (missing on payments saved before 1.2.1). */
  deviceId?: string
}

export interface HeldOrder extends Base {
  label: string
  cart: CartState
  userId: ID
  userName: string
  deviceId: string
}

export interface AuditEntry extends Base {
  userId?: ID
  userName?: string
  action: string
  entity?: string
  entityId?: ID
  details?: string
}

export interface ReceiptSettings {
  header: string
  footer: string
  showLogo: boolean
  logo?: string
  paperWidth: 58 | 80 | 'a4'
  showTaxBreakdown: boolean
  showBarcode: boolean
  showSku: boolean
  showCustomer: boolean
  autoPrint: boolean
  copies: number
}

export interface ScaleBarcodeSettings {
  enabled: boolean
  /** Leading digits that mark a scale barcode, e.g. "2" matches 20–29. */
  prefixes: string
  itemDigits: number
  valueDigits: number
  valueType: 'weight' | 'price'
  /** Divisor for the value, e.g. 1000 grams → kg. */
  valueDivisor: number
}

export interface Settings extends Base {
  businessName: string
  legalName?: string
  address: string
  phone: string
  email: string
  website?: string
  taxNumber: string
  taxLabel: string
  country: string
  state?: string
  currency: string
  /** Locale for number/currency formatting, e.g. en-IN. Independent of UI language. */
  numberLocale: string
  pricesIncludeTax: boolean
  /** India GST mode: splits tax into CGST/SGST (or IGST) on receipts & reports. */
  gstMode: boolean
  cashRounding: Minor
  allowNegativeStock: boolean
  requireShift: boolean
  loyaltyEnabled: boolean
  /** Points earned per 1 major unit spent. */
  loyaltyEarnRate: number
  /** Money value (minor) of one point when redeemed. */
  loyaltyPointValue: Minor
  upiId?: string
  upiName?: string
  enabledPayments: PaymentMethod[]
  receipt: ReceiptSettings
  scale: ScaleBarcodeSettings
  orderTypes: boolean
  defaultTaxId?: ID
  /** Banknote values in MAJOR units (e.g. 100 = ₹100) for quick-cash buttons. */
  quickCash: number[]
  lockAfterSale: boolean
  autoLockMinutes: number
}

export interface CartLine {
  id: ID
  productId?: ID
  name: string
  sku?: string
  barcode?: string
  hsn?: string
  unit: Unit
  qty: number
  price: Minor
  cost: Minor
  taxId?: ID
  discountType?: DiscountType
  discountValue?: number
  note?: string
  /** Set when the line refers to an original sale line (refund mode). */
  refLineId?: ID
}

export interface CartState {
  lines: CartLine[]
  customerId?: ID
  discountType?: DiscountType
  discountValue?: number
  note?: string
  orderType?: OrderType
  table?: string
  interState?: boolean
  redeemPoints?: number
  /** When set, the cart is a refund against this sale. */
  refundOf?: ID
}

/** Tables replicated between terminals through the sync server. */
export const SYNCED_TABLES = [
  'settings',
  'users',
  'categories',
  'taxes',
  'products',
  'customers',
  'suppliers',
  'sales',
  'stockMovements',
  'purchases',
  'shifts',
  'cashMovements',
  'customerPayments',
  'heldOrders',
  'audit',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]
