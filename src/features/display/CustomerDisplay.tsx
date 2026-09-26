import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Smartphone } from 'lucide-react'
import type { CartState } from '@/core/types'
import { calculateCart } from '@/core/cart'
import { formatMoney, formatQty, fromMinor, moneyConfig } from '@/lib/money'
import { useSettings } from '@/stores/settings'
import { onDisplayMessage, type DisplayMessage } from './channel'

// Customer-facing screen (second monitor, or a tablet mirrored to it). Read-only and
// shown without login; it mirrors the till's cart and shows a UPI QR at payment time.

function readCart(): CartState {
  try {
    const c = JSON.parse(localStorage.getItem('kasa.cart') || 'null')
    if (c && Array.isArray(c.lines)) return c
  } catch {
    /* ignore */
  }
  return { lines: [] }
}

export default function CustomerDisplay() {
  const { t } = useTranslation('sell')
  const settings = useSettings((s) => s.settings)
  const taxMap = useSettings((s) => s.taxMap)
  const [cart, setCart] = useState<CartState>(readCart)
  const [msg, setMsg] = useState<DisplayMessage>({ type: 'idle' })
  const [qr, setQr] = useState('')

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'kasa.cart') return
      const next = readCart()
      setCart(next)
      // The next customer's items replace the "thank you" screen right away.
      if (next.lines.length) setMsg((cur) => (cur.type === 'paid' ? { type: 'idle' } : cur))
    }
    window.addEventListener('storage', onStorage)
    const off = onDisplayMessage((m) => {
      setMsg(m)
      if (m.type === 'paid') setTimeout(() => setMsg((cur) => (cur === m ? { type: 'idle' } : cur)), 8000)
    })
    document.title = settings.businessName
    return () => {
      window.removeEventListener('storage', onStorage)
      off()
    }
  }, [settings.businessName])

  const calc = useMemo(
    () => calculateCart(cart.lines, { pricesIncludeTax: settings.pricesIncludeTax, cashRounding: settings.cashRounding, cartDiscountType: cart.discountType, cartDiscountValue: cart.discountValue, taxes: taxMap }),
    [cart, settings, taxMap],
  )

  const upiReady = !!settings.upiId && settings.enabledPayments.includes('upi')
  useEffect(() => {
    if (msg.type !== 'pay' || !upiReady || msg.amount <= 0) return setQr('')
    const url = `upi://pay?pa=${encodeURIComponent(settings.upiId!)}&pn=${encodeURIComponent(settings.upiName || settings.businessName)}&am=${fromMinor(msg.amount).toFixed(moneyConfig().decimals)}&cu=${settings.currency}`
    void import('qrcode').then(({ toDataURL }) => toDataURL(url, { margin: 1, width: 480 })).then(setQr)
  }, [msg, upiReady, settings])

  const logo = settings.receipt.logo

  if (msg.type === 'paid') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-bg p-10 text-center">
        <CheckCircle2 className="size-28 text-success" strokeWidth={1.4} />
        <h1 className="text-5xl font-bold">{t('display.thankYou')}</h1>
        {msg.change > 0 && (
          <div>
            <div className="text-xl text-muted">{t('change')}</div>
            <div className="tnum text-7xl font-extrabold text-success">{formatMoney(msg.change)}</div>
          </div>
        )}
        {settings.receipt.footer && <p className="max-w-xl text-xl whitespace-pre-line text-muted">{settings.receipt.footer}</p>}
      </div>
    )
  }

  if (!cart.lines.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-bg p-10 text-center">
        {logo ? <img src={logo} alt="" className="max-h-40 max-w-sm object-contain" /> : <img src="./icons/icon.svg" alt="" className="size-28" />}
        <h1 className="text-5xl font-bold tracking-tight">{settings.businessName}</h1>
        <p className="text-2xl text-muted">{t('display.welcome')}</p>
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-1 bg-bg lg:grid-cols-[1.4fr_1fr]">
      <section className="flex min-h-0 flex-col border-border lg:border-e">
        <header className="flex items-center gap-4 border-b border-border bg-surface px-8 py-5">
          {logo && <img src={logo} alt="" className="h-12 object-contain" />}
          <h1 className="text-2xl font-bold">{settings.businessName}</h1>
        </header>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto bg-surface">
          {cart.lines.map((l, i) => (
            <li key={l.id} className="flex items-center gap-6 px-8 py-4 text-xl">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{l.name}</span>
                <span className="tnum text-base text-muted">
                  {formatQty(l.qty)} × {formatMoney(l.price)}
                </span>
              </span>
              <span className="tnum font-bold">{formatMoney(calc.lines[i]?.total ?? 0)}</span>
            </li>
          ))}
        </ul>
      </section>
      <aside className="flex flex-col items-center justify-center gap-6 p-10 text-center">
        {calc.discountTotal > 0 && (
          <div className="tnum text-xl text-success">
            {t('discount')}: −{formatMoney(calc.discountTotal)}
          </div>
        )}
        <div>
          <div className="text-xl text-muted">{msg.type === 'pay' ? t('display.toPay') : t('receipt.total')}</div>
          <div className="tnum text-7xl font-extrabold tracking-tight">{formatMoney(msg.type === 'pay' ? msg.amount : calc.total)}</div>
          <div className="mt-2 text-lg text-muted">{t('itemsCount', { count: cart.lines.length })}</div>
        </div>
        {msg.type === 'pay' && qr && (
          <div className="flex flex-col items-center gap-3">
            <img src={qr} alt="UPI QR" className="size-72 rounded-3xl border border-border bg-white p-3" />
            <div className="flex items-center gap-2 text-lg font-medium text-muted">
              <Smartphone className="size-5" /> {t('display.scanUpi')}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
