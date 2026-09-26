import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Category } from '@/core/types'
import { db } from '@/db/db'
import { toast } from '@/stores/ui'
import { Button, Input, Label, Modal } from '@/components/ui'
import { ColorSwatches } from './shared'
import { saveCategory } from './service'
import { SWATCHES } from './util'

/** Create or rename a category. Used by the Categories tab and the product editor's quick-add. */
export function CategoryDialog({ open, category, onClose, onSaved }: {
  open: boolean
  category?: Category
  onClose: () => void
  onSaved?: (c: Category) => void
}) {
  const { t } = useTranslation('products')
  const [name, setName] = useState('')
  const [color, setColor] = useState(SWATCHES[11])
  const [busy, setBusy] = useState(false)
  const taken = useLiveQuery(async () => new Set((await db.categories.toArray()).filter((c) => !c.deleted && c.id !== category?.id).map((c) => c.name.trim().toLowerCase())), [category?.id])
  // Names must be unique: CSV import and reports match categories by name.
  const duplicate = !!name.trim() && !!taken?.has(name.trim().toLowerCase())
  useEffect(() => {
    if (!open) return
    setName(category?.name ?? '')
    setColor(category?.color ?? SWATCHES[Math.floor(Math.random() * SWATCHES.length)])
  }, [open, category])

  const save = async () => {
    if (!name.trim() || duplicate || busy) return
    setBusy(true)
    try {
      const c = await saveCategory({ id: category?.id, name: name.trim(), color })
      toast(category ? t('categories.saved') : t('categories.created', { name: c.name }))
      onSaved?.(c)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? t('categories.edit') : t('categories.new')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" onClick={save} disabled={!name.trim() || duplicate} loading={busy}>
            {t('common:save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), void save())}>
        <Input label={t('categories.name')} value={name} onChange={(e) => setName(e.target.value)} error={duplicate ? t('categories.duplicate') : undefined} autoFocus maxLength={60} />
        <div>
          <Label>{t('categories.color')}</Label>
          <ColorSwatches value={color} onChange={(c) => c && setColor(c)} />
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
          <span className="size-3 rounded-full" style={{ background: color }} />
          <span className="truncate text-sm font-medium">{name.trim() || t('categories.name')}</span>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
