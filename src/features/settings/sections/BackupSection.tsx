import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, FileUp, Upload } from 'lucide-react'
import { db } from '@/db/db'
import { formatDateTime, relativeTime } from '@/lib/dates'
import { formatNumber } from '@/lib/money'
import { pickFile, readFileText } from '@/lib/download'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, Modal } from '@/components/ui'
import { Group, Notice, Row, Stack } from '../ui'
import { InvalidBackup, exportBackup, parseBackup, restoreBackup, tableCounts, type BackupSummary } from '../backup'

const WEEK = 7 * 24 * 3600 * 1000
const SHOWN = ['products', 'customers', 'sales', 'users', 'stockMovements', 'shifts'] as const

export function BackupSection() {
  const { t } = useTranslation('settings')
  const last = useLiveQuery(async () => ((await db.meta.get('lastBackup'))?.value as number | undefined) ?? 0, [])
  const counts = useLiveQuery(tableCounts, [])
  const [exporting, setExporting] = useState(false)
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  const [restoring, setRestoring] = useState(false)
  const stale = last !== undefined && Date.now() - last > WEEK

  const doExport = async () => {
    setExporting(true)
    try {
      const { filename } = await exportBackup()
      toast(t('backup.exported', { file: filename }))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setExporting(false)
    }
  }

  const choose = async () => {
    const file = await pickFile('.json,application/json')
    if (!file) return
    try {
      setSummary(parseBackup(await readFileText(file)))
    } catch (e) {
      const code = e instanceof InvalidBackup ? e.code : 'notJson'
      toast(t(`backup.error.${code}`), 'error')
    }
  }

  const restore = async () => {
    if (!summary) return
    const ok = await confirmDialog({
      title: t('backup.confirmTitle'),
      message: t('backup.confirmMessage', { date: summary.exportedAt ? formatDateTime(summary.exportedAt) : '—' }),
      confirmLabel: t('backup.confirmRestore'),
      danger: true,
    })
    if (!ok) return
    setRestoring(true)
    try {
      await restoreBackup(summary.file)
    } catch (e) {
      setRestoring(false)
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <Stack>
      {stale && (
        <Notice
          tone="warning"
          title={last ? t('backup.staleTitle', { time: relativeTime(last) }) : t('backup.neverTitle')}
          action={
            <Button size="sm" variant="warning" icon={<Download className="size-4" />} loading={exporting} onClick={() => void doExport()}>
              {t('backup.exportNow')}
            </Button>
          }
        >
          {t('backup.staleHint')}
        </Notice>
      )}

      <Group title={t('backup.export')} description={t('backup.exportHint')}>
        <Row id="backup.export">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {SHOWN.map((name) => (
              <div key={name} className="rounded-xl bg-surface-2 px-3 py-2">
                <div className="tnum text-lg font-bold">{counts ? formatNumber(counts[name] ?? 0) : '…'}</div>
                <div className="truncate text-xs text-subtle">{t(`backup.tables.${name}`)}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" icon={<Download className="size-5" />} loading={exporting} onClick={() => void doExport()}>
              {t('backup.exportButton')}
            </Button>
            <span className="text-sm text-muted">
              {last ? (
                <span title={formatDateTime(last)}>{t('backup.lastBackup', { time: relativeTime(last) })}</span>
              ) : (
                t('backup.noBackupYet')
              )}
            </span>
          </div>
        </Row>
      </Group>

      <Group title={t('backup.import')} description={t('backup.importHint')}>
        <Row id="backup.import">
          <Button icon={<Upload className="size-4" />} onClick={() => void choose()}>
            {t('backup.chooseFile')}
          </Button>
        </Row>
      </Group>

      <Modal
        open={!!summary}
        onClose={() => !restoring && setSummary(null)}
        dismissible={!restoring}
        title={t('backup.reviewTitle')}
        subtitle={summary?.businessName}
        footer={
          <>
            <Button onClick={() => setSummary(null)} disabled={restoring}>
              {t('common:cancel')}
            </Button>
            <Button variant="danger" icon={<FileUp className="size-4" />} loading={restoring} onClick={() => void restore()}>
              {t('backup.restore')}
            </Button>
          </>
        }
      >
        {summary && (
          <div className="space-y-4">
            <div className="text-sm">
              <span className="text-muted">{t('backup.exportedAt')}: </span>
              <span className="font-medium">{summary.exportedAt ? formatDateTime(summary.exportedAt) : '—'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SHOWN.map((name) => (
                <div key={name} className="rounded-xl bg-surface-2 px-3 py-2">
                  <div className="tnum font-bold">{formatNumber(summary.counts[name] ?? 0)}</div>
                  <div className="truncate text-xs text-subtle">{t(`backup.tables.${name}`)}</div>
                </div>
              ))}
            </div>
            <Notice tone="danger" title={t('backup.replaceWarningTitle')}>
              {t('backup.replaceWarning')}
            </Notice>
            {summary.unknownTables.length > 0 && <p className="text-xs text-subtle">{t('backup.unknownTables', { tables: summary.unknownTables.join(', ') })}</p>}
          </div>
        )}
      </Modal>
    </Stack>
  )
}
