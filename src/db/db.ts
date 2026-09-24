import Dexie, { type EntityTable } from 'dexie'
import type {
  AuditEntry, CashMovement, Category, Customer, CustomerPayment, HeldOrder, Product, Purchase,
  Sale, Settings, Shift, StockMovement, Supplier, Tax, User,
} from '@/core/types'

/** Local change queue drained by the sync engine. */
export interface OutboxEntry {
  seq?: number
  table: string
  id: string
  updatedAt: number
}

export interface MetaEntry {
  key: string
  value: unknown
}

export class PosDB extends Dexie {
  settings!: EntityTable<Settings, 'id'>
  users!: EntityTable<User, 'id'>
  categories!: EntityTable<Category, 'id'>
  taxes!: EntityTable<Tax, 'id'>
  products!: EntityTable<Product, 'id'>
  customers!: EntityTable<Customer, 'id'>
  suppliers!: EntityTable<Supplier, 'id'>
  sales!: EntityTable<Sale, 'id'>
  stockMovements!: EntityTable<StockMovement, 'id'>
  purchases!: EntityTable<Purchase, 'id'>
  shifts!: EntityTable<Shift, 'id'>
  cashMovements!: EntityTable<CashMovement, 'id'>
  customerPayments!: EntityTable<CustomerPayment, 'id'>
  heldOrders!: EntityTable<HeldOrder, 'id'>
  audit!: EntityTable<AuditEntry, 'id'>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  meta!: EntityTable<MetaEntry, 'key'>

  constructor(name = 'kasa-pos') {
    super(name)
    this.version(1).stores({
      settings: 'id',
      users: 'id, name, role',
      categories: 'id, sortOrder, name',
      taxes: 'id',
      products: 'id, name, sku, barcode, categoryId, favorite, updatedAt',
      customers: 'id, name, phone, email, updatedAt',
      suppliers: 'id, name',
      sales: 'id, number, createdAt, type, customerId, shiftId, userId, refundOf',
      stockMovements: 'id, productId, createdAt, type, refId',
      purchases: 'id, number, createdAt, supplierId',
      shifts: 'id, status, openedAt, deviceId',
      cashMovements: 'id, shiftId, createdAt',
      customerPayments: 'id, customerId, createdAt, shiftId',
      heldOrders: 'id, createdAt',
      audit: 'id, createdAt, action',
      outbox: '++seq, [table+id]',
      meta: 'key',
    })
  }
}

export const db = new PosDB()
