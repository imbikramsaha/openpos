import i18n from 'i18next'

/** A user-facing message for an error, with friendly wording for storage-full failures. */
export function errorMessage(e: unknown): string {
  const err = e as { name?: string; inner?: { name?: string }; message?: string } | null
  const names = [err?.name, err?.inner?.name]
  if (names.includes('QuotaExceededError')) return i18n.t('common:storageFull')
  return e instanceof Error ? e.message : String(e)
}
