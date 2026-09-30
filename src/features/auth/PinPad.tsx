import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

// Brute-force protection shared by every PIN pad on this terminal (login and manager
// override): after MAX_FAILS wrong PINs the pad locks for a while, doubling each time.
const LOCK_KEY = 'kasa.pinLock'
const MAX_FAILS = 5
const BASE_LOCK_MS = 30_000
const MAX_LOCK_MS = 5 * 60_000

interface LockState {
  fails: number
  until: number
  /** A PIN was checked, found wrong and not yet counted (the user may still be typing). */
  pending?: boolean
}

// In-memory copy so the lockout still works when localStorage is unavailable (private mode).
let memoryLock: LockState = { fails: 0, until: 0 }

function readLock(): LockState {
  try {
    const v = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null')
    if (v && typeof v.fails === 'number' && typeof v.until === 'number') {
      // Take whichever is stricter, so clearing storage can't reset the counter mid-session.
      return v.until >= memoryLock.until && v.fails >= memoryLock.fails ? v : memoryLock
    }
  } catch {
    /* storage unavailable */
  }
  return memoryLock
}

function writeLock(v: LockState) {
  memoryLock = v
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(v))
  } catch {
    /* storage unavailable: the in-memory copy still applies */
  }
}

function registerFailure(): LockState {
  const cur = readLock()
  const fails = cur.fails + 1
  const next: LockState = { fails, until: cur.until }
  if (fails >= MAX_FAILS && fails % MAX_FAILS === 0) {
    next.until = Date.now() + Math.min(BASE_LOCK_MS * 2 ** (fails / MAX_FAILS - 1), MAX_LOCK_MS)
  }
  writeLock(next)
  return next
}

export function PinPad({ onPin, minLength = 4, maxLength = 6, disabled, error }: PinPadProps) {
  const { t } = useTranslation('auth')
  const [pin, setPinState] = useState('')
  const [shake, setShake] = useState(false)
  const [wrong, setWrong] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(() => readLock().until)
  const [now, setNow] = useState(Date.now())
  const locked = lockedUntil > now
  // A ref keeps fast typing (or a PIN typed by a keyboard wedge) from reading stale state.
  const pinRef = useRef('')
  const checking = useRef(false)
  const setPin = (v: string) => {
    pinRef.current = v
    setPinState(v)
  }

  // PINs are 4 to 6 digits, so every PIN from minLength on is checked as it is typed, and a
  // wrong one only counts once the user gives up on it: at the last digit, on Enter, on
  // Backspace, or by leaving the pad. Otherwise "digit, Backspace" (or switching user, or a
  // reload) could try every PIN without ever reaching the lockout. The pending guess is kept
  // with the lock state, so a pad opened after one was left or reloaded counts it.
  useEffect(() => {
    if (readLock().pending) setLockedUntil(registerFailure().until)
    return () => {
      if (readLock().pending) registerFailure()
    }
  }, [])

  // Count down while locked (and pick up a lock set by another PIN pad on this terminal).
  useEffect(() => {
    if (!locked) return
    const id = setInterval(() => {
      setNow(Date.now())
      setLockedUntil(readLock().until)
    }, 1000)
    return () => clearInterval(id)
  }, [locked])

  /** Counts a wrong guess; true when it started the lockout. */
  const countFailure = () => {
    const state = registerFailure()
    setLockedUntil(state.until)
    setNow(Date.now())
    return state.until > Date.now()
  }

  const fail = () => {
    countFailure()
    setWrong(true)
    setShake(true)
    // Clear at once so a quick retry isn't lost; the shake is only an animation.
    setPin('')
    setTimeout(() => setShake(false), 450)
  }

  const isLocked = () => {
    const until = readLock().until
    if (until > Date.now()) {
      setLockedUntil(until)
      setNow(Date.now())
      return true
    }
    return false
  }

  const push = async (key: string) => {
    if (disabled || checking.current || isLocked()) return
    if (key === 'back') {
      if (readLock().pending && countFailure()) return setPin('')
      return setPin(pinRef.current.slice(0, -1))
    }
    if (key === 'enter') {
      // Enter confirms a PIN shorter than the maximum: wrong 4-digit PINs get feedback too.
      if (pinRef.current.length >= minLength) fail()
      return
    }
    if (!/^\d$/.test(key)) return
    if (pinRef.current.length >= maxLength) return
    const next = pinRef.current + key
    setPin(next)
    setWrong(false)
    if (next.length >= minLength) {
      checking.current = true
      try {
        const ok = await onPin(next)
        if (ok) {
          writeLock({ fails: 0, until: 0 })
          setPin('')
        } else if (next.length >= maxLength) fail()
        else writeLock({ ...readLock(), pending: true })
      } finally {
        checking.current = false
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
      } else if (e.key === 'Enter') {
        e.preventDefault()
        void push('enter')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const seconds = Math.max(1, Math.ceil((lockedUntil - now) / 1000))
  const message = locked ? t('tooManyAttempts', { seconds }) : error || (wrong ? t('wrongPin') : '')

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex h-5 items-center gap-3" dir="ltr" style={shake ? { animation: 'shake 0.4s' } : undefined}>
        {Array.from({ length: Math.max(minLength, pin.length) }).map((_, i) => (
          <span key={i} className={cn('size-3.5 rounded-full border-2 transition-colors', i < pin.length ? 'border-primary bg-primary' : 'border-border-strong', shake && 'border-danger bg-danger')} />
        ))}
      </div>
      <div className="min-h-4 text-center text-sm text-danger" role="alert">
        {message}
      </div>
      <div className={cn('w-full max-w-[280px]', locked && 'pointer-events-none opacity-50')} dir="ltr">
        <NumPad onKey={push} decimal={false} extra={{ label: t('common:ok'), key: 'enter' }} />
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  )
}
