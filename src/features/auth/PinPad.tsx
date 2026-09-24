import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { NumPad } from '@/components/ui'

export interface PinPadProps {
  /** Return true when the PIN is accepted. Called on each digit once length >= minLength. */
  onPin: (pin: string) => boolean | Promise<boolean>
  minLength?: number
  maxLength?: number
  disabled?: boolean
  error?: string
}

export function PinPad({ onPin, minLength = 4, maxLength = 6, disabled, error }: PinPadProps) {
  const [pin, setPinState] = useState('')
  const [shake, setShake] = useState(false)
  // A ref keeps fast typing (or a PIN typed by a keyboard wedge) from reading stale state.
  const pinRef = useRef('')
  const setPin = (v: string) => {
    pinRef.current = v
    setPinState(v)
  }

  const push = async (key: string) => {
    if (disabled) return
    if (key === 'back') return setPin(pinRef.current.slice(0, -1))
    if (!/^\d$/.test(key)) return
    const next = (pinRef.current + key).slice(0, maxLength)
    setPin(next)
    if (next.length >= minLength) {
      const ok = await onPin(next)
      if (ok) setPin('')
      else if (next.length >= maxLength) {
        setShake(true)
        setTimeout(() => {
          setShake(false)
          setPin('')
        }, 450)
      }
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // preventDefault stops the digit from also landing in the search box once unlocked.
      if (/^\d$/.test(e.key)) {
        e.preventDefault()
        void push(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        void push('back')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex h-5 items-center gap-3" style={shake ? { animation: 'shake 0.4s' } : undefined}>
        {Array.from({ length: Math.max(minLength, pin.length) }).map((_, i) => (
          <span key={i} className={cn('size-3.5 rounded-full border-2 transition-colors', i < pin.length ? 'border-primary bg-primary' : 'border-border-strong', shake && 'border-danger bg-danger')} />
        ))}
      </div>
      <div className="h-4 text-sm text-danger">{error}</div>
      <NumPad onKey={push} decimal={false} className="w-full max-w-[280px]" />
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  )
}
