import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Undo2 } from 'lucide-react'
import { db } from '@/db/db'
import { navigate } from '@/router'
import { toast } from '@/stores/ui'
import { Button, Input, Modal } from '@/components/ui'

/** Find the original receipt (typed or scanned from the receipt barcode) to refund against. */
export function RefundLookup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('sell')
  const [number, setNumber] = useState('')
  useEffect(() => {
    if (open) setNumber('')
  }, [open])
  const find = async () => {
    const q = number.trim().toUpperCase()
    if (!q) return
    const matches = await db.sales.where('number').equals(q).toArray()
    const sale = matches.find((s) => s.type === 'sale' && !s.deleted) ?? (await db.sales.filter((s) => s.type === 'sale' && s.number.endsWith(q)).first())
    if (!sale) return toast(t('receiptNotFound', { number: q }), 'error')
    onClose()
    navigate(`sales/${sale.id}?refund=1`)
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('refund')}
      subtitle={t('refundLookupHint')}
      size="sm"
      footer={
        <>
          <Button onClick={() => (onClose(), navigate('sales'))}>{t('browseSales')}</Button>
          <Button variant="primary" onClick={find} icon={<Undo2 className="size-4" />}>
            {t('findReceipt')}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), void find())}>
        <Input label={t('receiptNumber')} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="INV-XXXX-000001" autoFocus />
      </form>
    </Modal>
  )
}
