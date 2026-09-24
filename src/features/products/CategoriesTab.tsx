import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronRight, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Category, Product } from '@/core/types'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, Card, EmptyState } from '@/components/ui'
import { CategoryDialog } from './CategoryDialog'
import { deleteCategory, moveCategory } from './service'

export function CategoriesTab({ categories, products, onBrowse, creating, onCreatingChange }: {
  categories: Category[]
  products: Product[]
  /** Shows the product list filtered to a category ('none' = uncategorised). */
  onBrowse: (categoryId: string) => void
  creating: boolean
  onCreatingChange: (v: boolean) => void
}) {
  const { t } = useTranslation('products')
  const [editing, setEditing] = useState<Category | null>(null)
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    const known = new Set(categories.map((c) => c.id))
    let none = 0
    for (const p of products) {
      if (p.categoryId && known.has(p.categoryId)) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1)
      else none++
    }
    return { m, none }
  }, [categories, products])

  const move = async (i: number, dir: -1 | 1) => {
    if (busy) return
    setBusy(true)
    try {
      await moveCategory(categories, i, dir)
    } finally {
      setBusy(false)
    }
  }

  const del = async (c: Category) => {
    const n = counts.m.get(c.id) ?? 0
    const ok = await confirmDialog({
      title: t('categories.deleteTitle', { name: c.name }),
      message: n ? t('categories.deleteMessage', { count: n }) : t('categories.deleteEmpty'),
      danger: true,
      confirmLabel: t('common:delete'),
    })
    if (!ok) return
    await deleteCategory(c.id)
    toast(t('categories.deleted', { name: c.name }))
  }

  return (
    <div className="mx-auto max-w-3xl">
      {!categories.length ? (
        <EmptyState
          icon={<FolderTree />}
          title={t('categories.empty')}
          description={t('categories.emptyHint')}
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => onCreatingChange(true)}>
              {t('categories.new')}
            </Button>
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{t('categories.orderHint')}</p>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {categories.map((c, i) => {
                const n = counts.m.get(c.id) ?? 0
                return (
                  <li key={c.id} className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
                    <button onClick={() => setEditing(c)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 text-start">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={{ background: `${c.color}26`, color: c.color }}>
                        {[...c.name.trim()][0]?.toUpperCase() ?? '?'}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block text-xs text-muted">{t('categories.productCount', { count: n })}</span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center">
                      <Button size="icon-sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0 || busy} aria-label={t('categories.moveUp')} title={t('categories.moveUp')}>
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === categories.length - 1 || busy} aria-label={t('categories.moveDown')} title={t('categories.moveDown')}>
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => setEditing(c)} aria-label={t('common:edit')} title={t('common:edit')} className="max-sm:hidden">
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => del(c)} aria-label={t('common:delete')} title={t('common:delete')}>
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => onBrowse(c.id)} aria-label={t('categories.viewProducts')} title={t('categories.viewProducts')}>
                        <ChevronRight className="size-4 rtl:rotate-180" />
                      </Button>
                    </div>
                  </li>
                )
              })}
              {counts.none > 0 && (
                <li>
                  <button onClick={() => onBrowse('none')} className="flex w-full items-center gap-3 px-3 py-3 text-start hover:bg-surface-2 sm:px-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border-strong text-subtle">
                      <FolderTree className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-muted">{t('uncategorised')}</span>
                      <span className="block text-xs text-subtle">{t('categories.productCount', { count: counts.none })}</span>
                    </span>
                    <ChevronRight className="size-4 text-subtle rtl:rotate-180" />
                  </button>
                </li>
              )}
            </ul>
          </Card>
        </>
      )}
      <CategoryDialog open={creating || !!editing} category={editing ?? undefined} onClose={() => (setEditing(null), onCreatingChange(false))} />
    </div>
  )
}
