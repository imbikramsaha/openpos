// Messages from the till to the customer-facing display window. The cart itself is
// mirrored through localStorage ('kasa.cart'), which fires `storage` events across windows.

export type DisplayMessage =
  | { type: 'pay'; amount: number; qr?: string }
  | { type: 'paid'; total: number; change: number }
  | { type: 'idle' }

const CHANNEL = 'kasa-display'
let channel: BroadcastChannel | null = null

export function sendToDisplay(msg: DisplayMessage) {
  if (typeof BroadcastChannel === 'undefined') return
  channel ??= new BroadcastChannel(CHANNEL)
  channel.postMessage(msg)
}

export function onDisplayMessage(fn: (msg: DisplayMessage) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const ch = new BroadcastChannel(CHANNEL)
  ch.onmessage = (e) => fn(e.data as DisplayMessage)
  return () => ch.close()
}

/** Opens the display in a separate window (drag it to the customer-facing monitor). */
export function openCustomerDisplay() {
  window.open(`${location.pathname}${location.search}#/display`, 'kasa-customer-display', 'popup,width=1024,height=768')
}
