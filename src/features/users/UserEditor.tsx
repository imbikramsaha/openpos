import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Crown, Lock, ShieldCheck, ShoppingCart, Trash2 } from 'lucide-react'
import type { Permission, Role, User } from '@/core/types'
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from '@/core/permissions'
import { audit, put, remove } from '@/db/repo'
import { pinFields } from '@/features/auth/users'
import { cn } from '@/lib/cn'
import { useSession } from '@/stores/session'
import { confirmDialog, toast } from '@/stores/ui'
import { Avatar, Badge, Button, Input, Sheet, Toggle } from '@/components/ui'
import { checkUserChange, describeChanges, extrasFor, pinConflict, type RuleError } from './rules'

/** User colours are data (shown on avatars and receipts), not theme colours. */
export const USER_COLORS = ['#4f46e5', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#475569']

const ROLES: Array<{ role: Role; icon: typeof Crown }> = [
  { role: 'admin', icon: Crown },
  { role: 'manager', icon: ShieldCheck },
  { role: 'cashier', icon: ShoppingCart },
]

const PIN = /^\d{4,6}$/

export function UserEditor({ user, users, onClose }: { user: User | 'new' | null; users: User[]; onClose: () => void }) {
  const { t } = useTranslation('users')
  const me = useSession((s) => s.user)
  const login = useSession((s) => s.login)
  const existing = user && user !== 'new' ? user : null
  const open = !!user
  const isMe = !!existing && existing.id === me?.id

  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('cashier')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [color, setColor] = useState<string | undefined>(undefined)
  const [active, setActive] = useState(true)
  const [extra, setExtra] = useState<Set<Permission>>(new Set())
  const [pinError, setPinError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(existing?.name ?? '')
    setRole(existing?.role ?? 'cashier')
    setPin('')
    setPin2('')
    setColor(existing?.color)
    setActive(existing?.active ?? true)
    setExtra(new Set(existing?.extraPermissions ?? []))
    setPinError('')
    setTried(false)
  }, [open, existing?.id])

  const ruleText = (e: RuleError) => t(`rules.${e}`)
  const ruleError = existing ? checkUserChange(users, me?.id, existing, { role, active }) : null
  const nameError = tried && !name.trim() ? t('nameRequired') : ''
  const duplicateName = users.some((u) => !u.deleted && u.id !== existing?.id && u.name.trim().toLowerCase() === name.trim().toLowerCase())
  const pinFormat = pin && !PIN.test(pin) ? t('pinFormat') : ''
  const pinMismatch = pin2 && pin !== pin2 ? t('pinMismatch') : ''
  const needPin = !existing
  const pinMissing = tried && needPin && !pin ? t('pinRequired') : ''
  const roleDefaults = ROLE_PERMISSIONS[role]

  const save = async () => {
    setTried(true)
    if (!name.trim() || (needPin && !pin) || pinFormat || (pin && pin !== pin2) || ruleError) return
    setBusy(true)
    try {
      if (pin) {
        // PIN hashing is deliberately slow; let the spinner paint before checking.
        await new Promise((r) => setTimeout(r, 0))
        const clash = pinConflict(pin, users, existing?.id)
        if (clash) {
          const key = clash.kind === 'inUse' ? 'pinInUse' : clash.kind === 'shadowedBy' ? 'pinShadowed' : 'pinPrefixClash'
          return setPinError(t(key, { name: clash.user.name }))
        }
      }
      if (isMe && existing && role !== existing.role) {
        const ok = await confirmDialog({ title: t('selfRoleTitle'), message: t('selfRoleMessage', { role: t(`common:role.${role}`) }) })
        if (!ok) return
      }
      const fields = {
        name: name.trim(),
        role,
        color,
        active,
        extraPermissions: extrasFor(role, extra),
      }
      if (existing) {
        const saved = await put<User>('users', { ...existing, ...fields, ...(pin ? pinFields(pin) : {}) })
        void audit('user.update', 'user', existing.id, describeChanges(existing, fields, !!pin))
        if (isMe) login(saved)
        toast(t('saved', { name: saved.name }))
      } else {
        const created = await put<User>('users', { ...fields, ...pinFields(pin) })
        void audit('user.create', 'user', created.id, `${created.name} (${created.role})`)
        toast(t('created', { name: created.name }))
      }
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const deleteUser = async () => {
    if (!existing) return
    const err = checkUserChange(users, me?.id, existing, null)
    if (err) return toast(ruleText(err), 'error')
    const ok = await confirmDialog({ title: t('deleteTitle', { name: existing.name }), message: t('deleteMessage'), confirmLabel: t('common:delete'), danger: true })
    if (!ok) return
    await remove('users', existing.id)
    void audit('user.delete', 'user', existing.id, existing.name)
    toast(t('deleted', { name: existing.name }))
    onClose()
  }

  const deleteBlocked = existing ? checkUserChange(users, me?.id, existing, null) : null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? t('editTitle') : t('newTitle')}
      width="sm:w-[520px]"
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              className="me-auto text-danger"
              icon={<Trash2 className="size-4" />}
              disabled={!!deleteBlocked}
              title={deleteBlocked ? ruleText(deleteBlocked) : undefined}
              onClick={() => void deleteUser()}
            >
              {t('common:delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!!ruleError} onClick={() => void save()} icon={<Check className="size-4" />}>
            {existing ? t('common:save') : t('create')}
          </Button>
        </>
      }
    >
      <form className="space-y-6" onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="flex items-center gap-4">
          <Avatar name={name.trim() || '?'} color={color} size="lg" />
          <div className="min-w-0 flex-1">
            <Input label={t('name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!existing} maxLength={40} error={nameError} hint={!nameError && duplicateName ? t('duplicateName') : undefined} />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-muted">{t('role')}</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
            {ROLES.map(({ role: r, icon: Icon }) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                onClick={() => setRole(r)}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3 text-start transition-colors sm:flex-col sm:gap-1.5',
                  role === r ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-3',
                )}
              >
                <Icon className={cn('mt-0.5 size-5 shrink-0 sm:mt-0', role === r ? 'text-primary' : 'text-subtle')} />
                <span className="min-w-0">
                  <span className={cn('block text-sm font-semibold', role === r && 'text-primary')}>{t(`common:role.${r}`)}</span>
                  <span className="block text-xs text-subtle">{t(`roleHint.${r}`)}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={existing ? t('newPin') : t('pin')}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''))
                setPinError('')
              }}
              error={pinFormat || pinError || pinMissing}
              hint={existing ? t('pinKeep') : t('pinHint')}
              left={<Lock className="size-4" />}
            />
            <Input
              label={t('confirmPin')}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
              error={pinMismatch || (tried && pin && !pin2 ? t('pinMismatch') : '')}
              disabled={!pin}
              left={<Lock className="size-4" />}
            />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-muted">{t('color')}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={!color}
              aria-label={t('colorAuto')}
              title={t('colorAuto')}
              onClick={() => setColor(undefined)}
              className={cn('flex size-10 items-center justify-center rounded-full border-2 text-xs font-semibold text-muted', !color ? 'border-primary' : 'border-dashed border-border-strong')}
            >
              {t('colorAutoShort')}
            </button>
            {USER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn('flex size-10 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition', color === c && 'ring-2 ring-primary')}
                style={{ background: c }}
              >
                {color === c && <Check className="size-5 text-white" />}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="rounded-xl border border-border p-4">
          <Toggle checked={active} onChange={setActive} disabled={isMe} label={t('active')} description={isMe ? t('rules.selfDeactivate') : t('activeHint')} />
        </div>

        {ruleError && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{ruleText(ruleError)}</p>}

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-muted">{t('permissions')}</legend>
          <p className="mb-3 text-xs text-subtle">{role === 'admin' ? t('permissionsAdmin') : t('permissionsHint', { role: t(`common:role.${role}`) })}</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {ALL_PERMISSIONS.map((p) => {
              const inRole = roleDefaults.includes(p)
              const checked = inRole || extra.has(p)
              return (
                <li key={p}>
                  <label className={cn('flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm', inRole ? 'cursor-default' : 'cursor-pointer hover:bg-surface-2')}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={inRole}
                      onChange={(e) => {
                        const next = new Set(extra)
                        if (e.target.checked) next.add(p)
                        else next.delete(p)
                        setExtra(next)
                      }}
                      className="size-4.5 shrink-0 accent-[var(--primary)]"
                    />
                    <span className={cn('min-w-0 flex-1', inRole && 'text-muted')}>{t(`common:perm.${p}`)}</span>
                    {inRole ? <Badge>{t('inRole')}</Badge> : extra.has(p) ? <Badge tone="primary">{t('extra')}</Badge> : null}
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>
        <button type="submit" className="hidden" />
      </form>
    </Sheet>
  )
}
