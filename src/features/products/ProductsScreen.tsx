import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileDown, FileSpreadsheet, FileUp, FolderTree, Package, Plus } from 'lucide-react'
import type { Product } from '@/core/types'
import { db } from '@/db/db'
import { downloadText, pickFile, readFileText } from '@/lib/download'
import { navigate, useRoute } from '@/router'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Button, FullScreenLoader, Page, PageBody, PageHeader, Tabs } from '@/components/ui'
import { CategoriesTab } from './CategoriesTab'
import { ImportDialog } from './ImportDialog'
import { LabelDialog } from './LabelDialog'
import { ProductEditor, type EditorTarget } from './ProductEditor'
import { DEFAULT_FILTERS, ProductList, type ListFilters } from './ProductList'
import { ActionMenu } from './shared'
import { planImport, productsToCsv, templateCsv, type ImportPlan } from './csv'
import { byName, categoryMap, fileDate, stockStatus } from './util'

// Products screen: catalogue list (#/products) and categories (#/products/categories).
// Deep links: #/products?edit=<id> opens the editor, #/products?new=1[&barcode=…] starts a new product.

export default function ProductsScreen() {
  const { t } = useTranslation('products')
  const route = useRoute()
  const tab = route.sub === 'categories' ? 'categories' : 'products'
  const taxes = useSettings((s) => s.taxes)
  const taxMap = useSettings((s) => s.taxMap)
  const defaultTaxId = useSettings((s) => s.settings.defaultTaxId)
  const allowNegativeStock = useSettings((s) => s.settings.allowNegativeStock)

  const products = useLiveQuery(async () => (await db.products.toArray()).filter((p) => !p.deleted), [])
  const categories = useLiveQuery(async () => (await db.categories.orderBy('sortOrder').toArray()).filter((c) => !c.deleted), [])
  const catMap = useMemo(() => categoryMap(categories), [categories])
  const lowCount = useMemo(() => (products ?? []).filter((p) => p.active && ['low', 'out'].includes(stockStatus(p))).length, [products])

  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [labelIds, setLabelIds] = useState<string[] | null>(null)
  const [imported, setImported] = useState<{ plan: ImportPlan; file: string } | null>(null)
  const [newCategory, setNewCategory] = useState(false)

  const editId = route.params.get('edit')
  const wantNew = route.params.has('new')
  const newBarcode = route.params.get('barcode') ?? undefined
  useEffect(() => {
    if (editId) void db.products.get(editId).then((p) => p && !p.deleted && setEditor({ product: p }))
    else if (wantNew) setEditor({ nonce: Date.now(), template: newBarcode ? { barcode: newBarcode } : undefined })
  }, [editId, wantNew, newBarcode])

  const closeEditor = () => {
    setEditor(null)
    if (editId || wantNew) navigate(tab === 'categories' ? 'products/categories' : 'products')
  }

  const newProduct = () => setEditor({ nonce: Date.now(), template: catMap.has(filters.category) ? { categoryId: filters.category } : undefined })

  const duplicate = (p: Product) =>
    setEditor({ nonce: Date.now(), template: { ...p, name: t('copyName', { name: p.name }), sku: undefined, barcode: undefined, favorite: false } })

  const exportCsv = () => {
    const list = (products ?? []).slice().sort(byName)
    downloadText(`products-${fileDate()}.csv`, productsToCsv(list, catMap, taxMap), 'text/csv')
    toast(t('exported', { count: list.length }))
  }

  const downloadTemplate = () => {
    const rate = (defaultTaxId && taxMap.get(defaultTaxId)?.rate) || 0
    downloadText('products-template.csv', templateCsv(rate), 'text/csv')
  }

  const importCsv = async () => {
    const file = await pickFile('.csv,text/csv,text/plain,.txt')
    if (!file) return
    const text = await readFileText(file)
    const plan = planImport(text, { products: await db.products.toArray(), categories: await db.categories.toArray(), taxes, defaultTaxId, allowNegativeStock })
    if (plan.fatal) return toast(t(`import.fatal.${plan.fatal.key}`), 'error')
    setImported({ plan, file: file.name })
  }

  const browseCategory = (categoryId: string) => {
    setFilters({ ...DEFAULT_FILTERS, category: categoryId })
    navigate('products')
  }

  const menu = [
    { icon: <FileUp />, label: t('common:importCsv'), onClick: importCsv },
    { icon: <FileDown />, label: t('common:exportCsv'), onClick: exportCsv },
    { icon: <FileSpreadsheet />, label: t('downloadTemplate'), onClick: downloadTemplate },
  ]

  const count = products?.length ?? 0
  return (
    <Page>
      <PageHeader
        title={t('title')}
        subtitle={products ? [t('count', { count }), lowCount > 0 && t('lowCount', { count: lowCount })].filter(Boolean).join(' · ') : undefined}
        actions={
          tab === 'products' ? (
            <>
              <Button icon={<FileUp className="size-4" />} onClick={importCsv} className="max-lg:hidden">
                {t('common:import')}
              </Button>
              <Button icon={<FileDown className="size-4" />} onClick={exportCsv} className="max-lg:hidden" disabled={!count}>
                {t('common:export')}
              </Button>
              <ActionMenu label={t('common:more')} items={menu} />
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={newProduct}>
                {t('new')}
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewCategory(true)}>
              {t('categories.new')}
            </Button>
          )
        }
      >
        <Tabs
          value={tab}
          onChange={(v) => navigate(v === 'categories' ? 'products/categories' : 'products')}
          tabs={[
            { id: 'products', label: t('tabs.products'), icon: <Package />, count: products?.length },
            { id: 'categories', label: t('tabs.categories'), icon: <FolderTree />, count: categories?.length },
          ]}
          className="-mb-3"
        />
      </PageHeader>
      <PageBody>
        {!products || !categories ? (
          <FullScreenLoader />
        ) : tab === 'categories' ? (
          <CategoriesTab categories={categories} products={products} onBrowse={browseCategory} creating={newCategory} onCreatingChange={setNewCategory} />
        ) : (
          <ProductList
            products={products}
            categories={catMap}
            filters={filters}
            onFilters={setFilters}
            onEdit={(p) => setEditor({ product: p })}
            onNew={newProduct}
            onImport={importCsv}
            onLabels={setLabelIds}
          />
        )}
      </PageBody>

      <ProductEditor target={editor} onClose={closeEditor} onDuplicate={duplicate} onPrintLabel={(id) => setLabelIds([id])} />
      <LabelDialog productIds={labelIds} onClose={() => setLabelIds(null)} />
      <ImportDialog plan={imported?.plan ?? null} fileName={imported?.file ?? ''} onClose={() => setImported(null)} />
    </Page>
  )
}
