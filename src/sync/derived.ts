import type { PosDB } from '@/db/db'
import { rebuildStock, round3 } from '@/db/repo'
import { recomputeAllCustomers, recomputeCustomer } from '@/db/customers'
import type { StockMovement } from '@/core/types'

// Derived per-terminal values (product stock, customer balance and loyalty points)
// recomputed after pulling, for any PosDB instance (the app's, or test terminals').

/** Sum of non-deleted stock movements for one product. */
export async function sumMovements(database: PosDB, productId: string): Promise<number> {
  let total = 0
  await database.stockMovements
    .where('productId')
    .equals(productId)
    .each((m: StockMovement) => {
      if (!m.deleted) total += m.qty
    })
  return round3(total)
}

export const rebuildStockIn = (database: PosDB) => rebuildStock(database)
export const recomputeCustomerIn = (database: PosDB, customerId: string | undefined) => recomputeCustomer(customerId, database)
export const recomputeAllCustomersIn = (database: PosDB) => recomputeAllCustomers(database)

// Kept for the sync tests' terminal helpers.
export const rebuildStockLocal = rebuildStockIn
export const recomputeCustomerLocal = recomputeCustomerIn
