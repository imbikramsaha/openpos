import type { Category, Product, Tax, Unit } from '@/core/types'
import { ean13CheckDigit } from '@/core/barcode'
import { currencyDecimals } from '@/lib/money'
import { uuid } from '@/lib/uuid'
import { db } from './db'
import { moveStock, tx } from './repo'

// Demo catalogue so a new shop can try the till immediately. Prices are defined in
// roughly USD terms and scaled per currency to look plausible.

const SCALE: Record<string, number> = {
  INR: 40, PKR: 150, BDT: 60, NPR: 60, LKR: 150, IDR: 8000, JPY: 80, KRW: 700, VND: 12000, CNY: 4, THB: 20, PHP: 25,
  MYR: 2.5, AED: 2, SAR: 2, EGP: 25, TRY: 15, RUB: 50, BRL: 3, MXN: 10, ZAR: 10, NGN: 500, KES: 70, IRR: 20000, PLN: 2.5,
  TWD: 15, HKD: 4, SEK: 5, NOK: 5, DKK: 4, CAD: 1, AUD: 1, NZD: 1, SGD: 1, GBP: 1, EUR: 1, USD: 1, CHF: 1,
}

type Demo = [name: string, price: number, unit?: Unit, extra?: Partial<Product>]

const CATALOGUE: Array<{ name: string; color: string; zeroTax?: boolean; items: Demo[] }> = [
  {
    name: 'Beverages', color: '#0ea5e9',
    items: [['Espresso', 2.2], ['Cappuccino', 3.2], ['Masala Chai', 1.5], ['Green Tea', 1.8], ['Orange Juice', 3], ['Mineral Water 1L', 0.8], ['Cola 500ml', 1.2], ['Cold Coffee', 3.5]],
  },
  {
    name: 'Bakery', color: '#f59e0b',
    items: [['Croissant', 2.5], ['Blueberry Muffin', 2.8], ['Chocolate Cookie', 1.2], ['Sandwich Bread', 2], ['Veg Puff', 1], ['Cheese Sandwich', 3.8]],
  },
  {
    name: 'Snacks', color: '#ef4444',
    items: [['Potato Chips', 1], ['Salted Peanuts', 1.4], ['Chocolate Bar', 1.5], ['Samosa', 0.6], ['Popcorn', 1.6]],
  },
  {
    name: 'Dairy', color: '#8b5cf6',
    items: [['Milk 1L', 1.4], ['Paneer 200g', 2.2], ['Butter 100g', 1.5], ['Yogurt Cup', 0.9], ['Cheese Slices', 2.6]],
  },
  {
    name: 'Fruits & Veg', color: '#22c55e', zeroTax: true,
    items: [['Bananas', 1.2, 'kg', { weighed: true }], ['Apples', 3, 'kg', { weighed: true }], ['Tomatoes', 1.5, 'kg', { weighed: true }], ['Onions', 1, 'kg', { weighed: true }], ['Potatoes', 0.9, 'kg', { weighed: true }]],
  },
  {
    name: 'Household', color: '#64748b',
    items: [['Dish Soap', 2.5], ['Laundry Detergent 1kg', 5], ['Paper Towels', 3], ['Garbage Bags', 2.2]],
  },
  {
    name: 'Personal Care', color: '#ec4899',
    items: [['Toothpaste', 2], ['Shampoo 200ml', 4.5], ['Hand Wash', 2.4], ['Face Cream', 6]],
  },
]

function niceRound(v: number): number {
  if (v >= 1000) return Math.round(v / 50) * 50
  if (v >= 100) return Math.round(v / 5) * 5
  if (v >= 10) return Math.round(v)
  return Math.round(v * 10) / 10
}

export async function seedDemoData(currency: string, taxes: Tax[]): Promise<void> {
  const scale = SCALE[currency] ?? 1
  const d = currencyDecimals(currency)
  const toMinor = (v: number) => Math.round(niceRound(v * scale) * 10 ** d)
  const defaultTax = taxes.find((t) => t.isDefault) ?? taxes[0]
  const zeroTax = taxes.find((t) => t.rate === 0)
  const now = Date.now()
  let code = 1

  await tx(['categories', 'products'], async () => {
    for (const [ci, cat] of CATALOGUE.entries()) {
      const category: Category = { id: uuid(), createdAt: now, updatedAt: now, name: cat.name, color: cat.color, sortOrder: ci }
      await db.categories.add(category)
      await db.outbox.add({ table: 'categories', id: category.id, updatedAt: now })
      for (const [name, price, unit = 'pcs', extra] of cat.items) {
        const body = `2${String(ci + 1).padStart(2, '0')}${String(code++).padStart(9, '0')}`.slice(0, 12)
        const p: Product = {
          id: uuid(), createdAt: now, updatedAt: now, name, price: toMinor(price), cost: Math.round(toMinor(price) * 0.62),
          categoryId: category.id, taxId: (cat.zeroTax ? zeroTax : defaultTax)?.id, unit, trackStock: true, stock: 0,
          reorderLevel: unit === 'kg' ? 5 : 10, active: true, barcode: body + ean13CheckDigit(body), sku: `SKU-${String(code).padStart(4, '0')}`,
          favorite: ci === 0 && code < 5, ...extra,
        }
        await db.products.add(p)
        await db.outbox.add({ table: 'products', id: p.id, updatedAt: now })
        await moveStock(p.id, unit === 'kg' ? 40 : 24 + (code % 5) * 6, 'initial', undefined, 'Demo stock', p.cost)
      }
    }
  })
}
