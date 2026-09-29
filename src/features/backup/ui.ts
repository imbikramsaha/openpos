import i18n from 'i18next'
import { promptDialog } from '@/stores/ui'

/** Asks for the passphrase of an encrypted (.openpos) backup file. */
export function askBackupPassphrase(): Promise<string | null> {
  return promptDialog({
    title: i18n.t('settings:autoBackup.encryptedFileTitle'),
    message: i18n.t('settings:autoBackup.encryptedFileHint'),
    label: i18n.t('settings:autoBackup.passphrase'),
    type: 'password',
  })
}
