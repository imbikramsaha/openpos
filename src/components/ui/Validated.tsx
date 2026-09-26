import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { emailError, LIMITS, phoneError, sanitizePhone, sanitizeTaxId, taxIdError } from '@/lib/validate'
import { Input, type InputProps } from './Field'

// Inputs that clean what is typed and explain what's wrong. Errors appear once the
// field has been left (or when the form asks via `showErrors`, e.g. after pressing Save).

type ValidatedProps = Omit<InputProps, 'value' | 'onChange' | 'error'> & {
  value: string | undefined
  onChange: (v: string) => void
  showErrors?: boolean
}

function useTouched(showErrors?: boolean) {
  const [touched, setTouched] = useState(false)
  return { visible: touched || !!showErrors, onBlur: () => setTouched(true) }
}

export function PhoneInput({ value, onChange, showErrors, onBlur, ...rest }: ValidatedProps) {
  const { t } = useTranslation()
  const touch = useTouched(showErrors)
  const err = phoneError(value)
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      dir="ltr"
      maxLength={24}
      value={value ?? ''}
      onChange={(e) => onChange(sanitizePhone(e.target.value))}
      onBlur={(e) => {
        touch.onBlur()
        onBlur?.(e)
      }}
      error={touch.visible && err ? t(`common:${err}`) : undefined}
      {...rest}
    />
  )
}

export function EmailInput({ value, onChange, showErrors, onBlur, ...rest }: ValidatedProps) {
  const { t } = useTranslation()
  const touch = useTouched(showErrors)
  const err = emailError(value)
  return (
    <Input
      type="email"
      inputMode="email"
      autoComplete="email"
      dir="ltr"
      maxLength={LIMITS.email}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value.replace(/\s/g, ''))}
      onBlur={(e) => {
        touch.onBlur()
        onBlur?.(e)
      }}
      error={touch.visible && err ? t(`common:${err}`) : undefined}
      {...rest}
    />
  )
}

export function TaxIdInput({ value, onChange, showErrors, onBlur, country, ...rest }: ValidatedProps & { country: string | undefined }) {
  const { t } = useTranslation()
  const touch = useTouched(showErrors)
  const err = taxIdError(value, country)
  return (
    <Input
      autoComplete="off"
      dir="ltr"
      maxLength={LIMITS.taxId}
      value={value ?? ''}
      onChange={(e) => onChange(sanitizeTaxId(e.target.value))}
      onBlur={(e) => {
        touch.onBlur()
        onBlur?.(e)
      }}
      error={touch.visible && err ? t(`common:${err}`) : undefined}
      className="font-mono tracking-wide uppercase"
      {...rest}
    />
  )
}
