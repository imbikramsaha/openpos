// Tables that replicate between terminals. Keep in sync with SYNCED_TABLES in
// src/core/types.ts (tests/server.test.ts fails if the two lists drift apart).
export const SYNCED_TABLES = Object.freeze([
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
])

export const TABLES = new Set(SYNCED_TABLES)

/**
 * Per-terminal values derived from ledgers (stock from stock movements, balance and
 * loyalty points from sales + customer payments). Terminals strip them before pushing;
 * the server strips them too so an old or buggy client can never replicate them.
 */
export const DERIVED_FIELDS = Object.freeze({
  products: Object.freeze(['stock']),
  customers: Object.freeze(['balance', 'loyaltyPoints']),
})
