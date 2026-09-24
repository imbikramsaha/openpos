import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Crown, ShieldCheck, ShoppingCart, UserPlus, Users } from 'lucide-react'
import type { Role, User } from '@/core/types'
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from '@/core/permissions'
import { db } from '@/db/db'
import { formatDateTime, relativeTime } from '@/lib/dates'
import { cn } from '@/lib/cn'
import { useSession } from '@/stores/session'
import { Avatar, Badge, Button, Card, DataTable, EmptyState, Page, PageBody, PageHeader, SearchInput, Segmented, type Tone } from '@/components/ui'
import { UserEditor } from './UserEditor'

const ROLE_TONE: Record<Role, Tone> = { admin: 'primary', manager: 'warning', cashier: 'neutral' }
const ROLE_ICON: Record<Role, typeof Crown> = { admin: Crown, manager: ShieldCheck, cashier: ShoppingCart }
const ROLE_ORDER: Record<Role, number> = { admin: 0, manager: 1, cashier: 2 }

export default function UsersScreen() {
  const { t } = useTranslation('users')
  const me = useSession((s) => s.user)
  const users = useLiveQuery(async () => (await db.users.toArray()).filter((u) => !u.deleted), [])
  const lastLogin = useLiveQuery(async () => {
    const m = new Map<string, number>()
    await db.audit
      .where('action')
      .equals('login')
      .each((e) => {
        if (e.entityId && e.createdAt > (m.get(e.entityId) ?? 0)) m.set(e.entityId, e.createdAt)
      })
    return m
  }, [])
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Role | 'all'>('all')
  const [editing, setEditing] = useState<User | 'new' | null>(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (users ?? [])
      .filter((u) => (role === 'all' || u.role === role) && (!q || u.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.active) - Number(a.active) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name))
  }, [users, query, role])

  const count = (r: Role) => (users ?? []).filter((u) => u.role === r && u.active).length

  const roleBadge = (u: User) => {
    const Icon = ROLE_ICON[u.role]
    return (
      <Badge tone={ROLE_TONE[u.role]}>
        <Icon className="size-3" /> {t(`common:role.${u.role}`)}
      </Badge>
    )
  }
  const statusBadge = (u: User) => (u.active ? <Badge tone="success">{t('common:active')}</Badge> : <Badge>{t('common:inactive')}</Badge>)
  const login = (u: User) => {
    const ts = lastLogin?.get(u.id)
    return ts ? <span title={formatDateTime(ts)}>{relativeTime(ts)}</span> : <span className="text-subtle">{t('neverLoggedIn')}</span>
  }
  const nameCell = (u: User) => (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={u.name} color={u.color} />
      <div className="min-w-0">
        <div className={cn('flex items-center gap-2 font-medium', !u.active && 'text-muted')}>
          <span className="truncate">{u.name}</span>
          {u.id === me?.id && <Badge tone="primary">{t('you')}</Badge>}
        </div>
        {!!u.extraPermissions?.length && <div className="text-xs text-subtle">{t('extraCount', { count: u.extraPermissions.length })}</div>}
      </div>
    </div>
  )

  return (
    <Page>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setEditing('new')}>
            {t('add')}
          </Button>
        }
      />
      <PageBody className="space-y-5">
        <div className="hidden gap-3 sm:grid sm:grid-cols-3">
          {(['admin', 'manager', 'cashier'] as Role[]).map((r) => {
            const Icon = ROLE_ICON[r]
            const perms = ROLE_PERMISSIONS[r].length
            return (
              <Card key={r} className="flex items-center gap-3 p-4">
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', r === 'admin' ? 'bg-primary-soft text-primary' : r === 'manager' ? 'bg-warning-soft text-warning' : 'bg-surface-3 text-muted')}>
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold">{t(`common:role.${r}`)}</span>
                    <span className="tnum text-lg font-bold">{users ? count(r) : '…'}</span>
                  </div>
                  <div className="truncate text-xs text-subtle">{t('permCount', { count: perms, total: ALL_PERMISSIONS.length })}</div>
                </div>
              </Card>
            )
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput value={query} onChange={setQuery} placeholder={t('search')} className="sm:max-w-xs sm:flex-1" />
          <Segmented
            value={role}
            onChange={setRole}
            options={[
              { value: 'all', label: t('common:all') },
              { value: 'admin', label: t('common:role.admin') },
              { value: 'manager', label: t('common:role.manager') },
              { value: 'cashier', label: t('common:role.cashier') },
            ]}
            className="overflow-x-auto"
          />
        </div>

        {users && (
          <DataTable<User>
            rows={rows}
            rowKey={(u) => u.id}
            onRowClick={setEditing}
            empty={
              <EmptyState
                icon={<Users />}
                title={query || role !== 'all' ? t('noMatches') : t('empty')}
                action={
                  !query && role === 'all' ? (
                    <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setEditing('new')}>
                      {t('add')}
                    </Button>
                  ) : undefined
                }
                className="rounded-2xl border border-border bg-surface"
              />
            }
            columns={[
              { key: 'name', header: t('name'), render: nameCell },
              { key: 'role', header: t('role'), render: roleBadge },
              { key: 'status', header: t('common:status'), render: statusBadge },
              { key: 'login', header: t('lastLogin'), render: (u) => <span className="text-sm whitespace-nowrap text-muted">{login(u)}</span> },
              { key: 'open', header: '', align: 'end', className: 'w-10', render: () => <ChevronRight className="ms-auto size-4 text-subtle rtl:rotate-180" /> },
            ]}
            mobile={(u) => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">{nameCell(u)}</div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {roleBadge(u)}
                  <span className="text-xs text-subtle">{u.active ? login(u) : t('common:inactive')}</span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-subtle rtl:rotate-180" />
              </div>
            )}
          />
        )}
        <p className="text-xs text-subtle">{t('footnote')}</p>
      </PageBody>

      <UserEditor user={editing} users={users ?? []} onClose={() => setEditing(null)} />
    </Page>
  )
}
