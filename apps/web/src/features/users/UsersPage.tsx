import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, SearchX, Users } from 'lucide-react';
import { ROLE_LABELS, ROLES, type User } from '@deviceflow/shared';
import { useCan, useCurrentUser } from '../auth/session';
import { PageHeader, Panel, table } from '../../design/Page';
import { Button } from '../../design/Button';
import { Badge, type Tone } from '../../design/Badge';
import { FilterInput, FilterSelect } from '../../design/Field';
import { EmptyState, ErrorState, TableSkeleton } from '../../design/States';
import { ConfirmDialog } from '../../design/Dialog';
import { formatDateTime } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { useUpdateUser, useUsers, type UserFilters } from './api';
import { CreateUserDialog, EditUserDialog } from './UserDialogs';

const ROLE_TONES: Record<User['role'], Tone> = {
  ADMIN: 'accent',
  TECHNICIAN: 'info',
  INVENTORY_MANAGER: 'warning',
  CUSTOMER: 'neutral',
};

const SORTS = [
  { value: 'fullName:asc', label: 'Name A–Z' },
  { value: 'fullName:desc', label: 'Name Z–A' },
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'role:asc', label: 'Role' },
];

export function UsersPage() {
  const me = useCurrentUser();
  const canManage = useCan('users:manage');
  const [searchInput, setSearchInput] = useState('');
  const [baseFilters, setFilters] = useState<Omit<UserFilters, 'search'>>({
    role: '',
    status: '',
    page: 1,
    sort: 'fullName:asc',
  });
  // The query uses the debounced search; typing resets to page 1 immediately.
  const filters: UserFilters = { ...baseFilters, search: useDebounced(searchInput.trim()) };

  const users = useUsers(filters);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [toggling, setToggling] = useState<User | null>(null);
  const update = useUpdateUser();

  const set = (patch: Partial<Omit<UserFilters, 'search'>>) =>
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const filtered = filters.search !== '' || filters.role !== '' || filters.status !== '';
  const meta = users.data?.meta;

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts and what each person can access."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" /> New user
            </Button>
          )
        }
      />

      <Panel>
        <div
          className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"
          role="search"
        >
          <FilterInput
            type="search"
            aria-label="Search by name or email"
            placeholder="Search name or email"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              set({ page: 1 });
            }}
            className="w-64 max-sm:w-full"
          />
          <FilterSelect
            aria-label="Filter by role"
            value={filters.role}
            onChange={(e) => set({ role: e.target.value as UserFilters['role'] })}
            options={[
              { value: '', label: 'All roles' },
              ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
            ]}
          />
          <FilterSelect
            aria-label="Filter by status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as UserFilters['status'] })}
            options={[
              { value: '', label: 'Any status' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Deactivated' },
            ]}
          />
          <FilterSelect
            aria-label="Sort"
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value })}
            options={SORTS}
            className="ml-auto max-sm:ml-0"
          />
        </div>

        {users.isPending ? (
          <TableSkeleton />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => users.refetch()} />
        ) : users.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No users match these filters"
              description="Try a different search or clear the filters."
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No users yet"
              description="Create the first staff account to get started."
            />
          )
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead>
                <tr>
                  <th className={table.th} scope="col">
                    Name
                  </th>
                  <th className={table.th} scope="col">
                    Role
                  </th>
                  <th className={table.th} scope="col">
                    Status
                  </th>
                  <th className={table.th} scope="col">
                    Last sign-in
                  </th>
                  {canManage && (
                    <th className={table.th} scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className={users.isPlaceholderData ? 'opacity-60' : undefined}>
                {users.data.data.map((user) => (
                  <tr key={user.id} className={table.row}>
                    <td className={table.td}>
                      <div className="font-medium">
                        {user.fullName}
                        {user.id === me.id && (
                          <span className="ml-2 text-[12px] font-normal text-ink-subtle">
                            (you)
                          </span>
                        )}
                      </div>
                      <div className="text-[13px] text-ink-muted">{user.email}</div>
                    </td>
                    <td className={table.td}>
                      <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                    </td>
                    <td className={table.td}>
                      {user.isActive ? (
                        <Badge tone="success" dot>
                          Active
                        </Badge>
                      ) : (
                        <Badge tone="neutral" dot>
                          Deactivated
                        </Badge>
                      )}
                    </td>
                    <td className={`${table.td} tabular text-ink-muted`}>
                      {user.lastLoginAt ? (
                        formatDateTime(user.lastLoginAt)
                      ) : (
                        <span className="text-ink-subtle">Never</span>
                      )}
                    </td>
                    {canManage && (
                      <td className={`${table.td} text-right whitespace-nowrap`}>
                        {user.role !== 'CUSTOMER' && (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(user)}>
                            Edit
                          </Button>
                        )}
                        {user.id !== me.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              update.reset();
                              setToggling(user);
                            }}
                          >
                            {user.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 text-[13px] text-ink-muted">
            <span className="tabular">
              {(meta.page - 1) * meta.pageSize + 1}–
              {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                aria-label="Previous page"
                disabled={meta.page <= 1}
                onClick={() => set({ page: meta.page - 1 })}
              >
                <ChevronLeft size={14} />
              </Button>
              <Button
                size="sm"
                aria-label="Next page"
                disabled={meta.page >= meta.totalPages}
                onClick={() => set({ page: meta.page + 1 })}
              >
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <EditUserDialog
        user={editing}
        isSelf={editing?.id === me.id}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={
          toggling?.isActive
            ? `Deactivate ${toggling.fullName}?`
            : `Reactivate ${toggling?.fullName}?`
        }
        body={
          toggling?.isActive ? (
            <p>
              They will be signed out everywhere immediately and will not be able to sign in. Their
              history is kept.
            </p>
          ) : (
            <p>They will be able to sign in again with their existing password.</p>
          )
        }
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Reactivate'}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        pending={update.isPending}
        error={update.error}
        onConfirm={() =>
          toggling &&
          update.mutate(
            { id: toggling.id, input: { isActive: !toggling.isActive, version: toggling.version } },
            { onSuccess: () => setToggling(null) },
          )
        }
      />
    </>
  );
}
