import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Undo2 } from 'lucide-react'
import type { Sale } from '@/core/types'
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
  const busy = useRef(false)
  const find = async () => {
    const q = number.trim().toUpperCase()
    if (!q || busy.current) return
    busy.current = true
    try {
      const usable = (s: Sale) => s.type === 'sale' && !s.deleted
      let sale = (await db.sales.where('number').equals(q).toArray()).find(usable)
      if (!sale) {
        // Typing just the end of the number ("000123") works, but only when it is unambiguous:
        // "1" must not open whichever sale happens to end in 1.
        const tail = await db.sales.filter((s) => usable(s) && s.number.endsWith(q)).limit(2).toArray()
        if (tail.length > 1) return toast(t('receiptAmbiguous', { number: q }), 'error')
        sale = tail[0]
      }
      if (!sale) return toast(t('receiptNotFound', { number: q }), 'error')
      onClose()
      navigate(`sales/${sale.id}?refund=1`)
    } finally {
      busy.current = false
    }
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
        <Input label={t('receiptNumber')} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="INV-XXXX-000001" autoFocus maxLength={40} autoComplete="off" />
      </form>
    </Modal>
  )
}
