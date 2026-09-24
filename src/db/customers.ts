import { db } from './db'

/**
 * Customer balance (credit/khata) and loyalty points are derived from the sales and
 * customer-payment ledgers rather than stored as synced values, so concurrent sales on
 * different terminals can never overwrite each other's balance changes.
 */
export async function recomputeCustomer(customerId: string | undefined): Promise<void> {
  if (!customerId) return
  const sales = await db.sales.where('customerId').equals(customerId).toArray()
  let balance = 0
  let points = 0
  for (const s of sales) {
    if (s.deleted || s.status === 'voided') continue
    for (const p of s.payments) if (p.method === 'credit') balance += p.amount
    points += (s.loyaltyEarned ?? 0) - (s.loyaltyRedeemed ?? 0)
  }
  const payments = await db.customerPayments.where('customerId').equals(customerId).toArray()
  for (const p of payments) if (!p.deleted) balance -= p.amount
  await db.customers.update(customerId, { balance, loyaltyPoints: Math.max(0, points) })
}

export async function recomputeAllCustomers(): Promise<void> {
  const ids = await db.customers.toCollection().primaryKeys()
  for (const id of ids) await recomputeCustomer(id)
}
