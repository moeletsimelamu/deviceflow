import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  Laptop,
  Pencil,
  Plus,
  Wrench,
} from 'lucide-react';
import type { Contact, Customer } from '@deviceflow/shared';
import { useCan } from '../auth/session';
import { DetailList, Panel, PanelHeader } from '../../design/Page';
import { Button } from '../../design/Button';
import { Badge } from '../../design/Badge';
import { ConfirmDialog } from '../../design/Dialog';
import { EmptyState, ErrorState, Skeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { ApiError } from '../../lib/api';
import { formatDateTime, todayIso } from '../../lib/format';
import { CustomerTypeBadge } from '../../lib/status';
import { ActivityFeed } from '../activity/ActivityFeed';
import { AssetTable } from '../assets/AssetsPage';
import { AssetFormDialog } from '../assets/AssetDialogs';
import { useAssets, type AssetFilters } from '../assets/api';
import { useRepairs } from '../repairs/api';
import { RepairTable } from '../repairs/RepairsPage';
import {
  useContacts,
  useCustomer,
  useCustomerUsers,
  useDeleteContact,
  useUpdateCustomer,
} from './api';
import { ContactDialog, CustomerFormDialog, PortalUserDialog } from './CustomerDialogs';

function address(c: Customer): string | null {
  const parts = [c.addressLine1, c.addressLine2, c.city, c.region, c.postalCode].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function RepairsPanel({ customer }: { customer: Customer }) {
  const [page, setPage] = useState(1);
  const repairs = useRepairs(
    {
      search: '',
      state: '',
      status: '',
      technician: '',
      customer: customer.id,
      page,
      sort: 'createdAt:desc',
    },
    5,
  );
  return (
    <Panel>
      <PanelHeader title="Repairs" description="Newest first." />
      {repairs.isPending ? (
        <Skeleton className="m-5 h-16" />
      ) : repairs.isError ? (
        <ErrorState error={repairs.error} onRetry={() => repairs.refetch()} />
      ) : repairs.data.data.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No repairs yet"
          description="Book one of this customer's devices in from its asset page."
        />
      ) : (
        <>
          <RepairTable
            repairs={repairs.data.data}
            dimmed={repairs.isPlaceholderData}
            showCustomer={false}
            compact
          />
          <Pagination meta={repairs.data.meta} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

function DevicesPanel({ customer }: { customer: Customer }) {
  const canManage = useCan('assets:manage');
  const [page, setPage] = useState(1);
  const [registering, setRegistering] = useState(false);
  const filters: AssetFilters = {
    search: '',
    status: '',
    category: '',
    customer: customer.id,
    warranty: '',
    page,
    sort: 'assetTag:asc',
  };
  const assets = useAssets(filters, 10);

  return (
    <Panel>
      <PanelHeader
        title="Devices"
        description={`${customer.assetCount} registered`}
        actions={
          canManage &&
          customer.isActive && (
            <Button size="sm" onClick={() => setRegistering(true)}>
              <Plus size={14} aria-hidden="true" /> Register device
            </Button>
          )
        }
      />
      {assets.isPending ? (
        <div className="p-5" role="status" aria-label="Loading">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : assets.isError ? (
        <ErrorState error={assets.error} onRetry={() => assets.refetch()} />
      ) : assets.data.data.length === 0 ? (
        <EmptyState
          icon={Laptop}
          title="No devices yet"
          description="Devices registered for this customer appear here."
        />
      ) : (
        <>
          <AssetTable
            assets={assets.data.data}
            today={todayIso()}
            dimmed={assets.isPlaceholderData}
            showCustomer={false}
          />
          <Pagination meta={assets.data.meta} onPage={setPage} />
        </>
      )}
      <AssetFormDialog
        open={registering}
        onOpenChange={setRegistering}
        initialCustomer={customer}
      />
    </Panel>
  );
}

function ContactsPanel({ customer }: { customer: Customer }) {
  const canManage = useCan('customers:manage');
  const contacts = useContacts(customer.id);
  const remove = useDeleteContact(customer.id);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);

  return (
    <Panel>
      <PanelHeader
        title="Contacts"
        actions={
          canManage && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={14} aria-hidden="true" /> Add
            </Button>
          )
        }
      />
      {contacts.isPending ? (
        <div className="p-5" role="status" aria-label="Loading">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : contacts.isError ? (
        <ErrorState error={contacts.error} onRetry={() => contacts.refetch()} />
      ) : contacts.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No contacts recorded.</p>
      ) : (
        <ul className="divide-y divide-line">
          {contacts.data.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {c.fullName}
                  {c.isPrimary && (
                    <span className="ml-2">
                      <Badge tone="accent">Primary</Badge>
                    </span>
                  )}
                </p>
                {c.jobTitle && <p className="text-[13px] text-ink-muted">{c.jobTitle}</p>}
                {c.email && (
                  <a
                    href={`mailto:${c.email}`}
                    className="block truncate text-[13px] text-accent hover:underline"
                  >
                    {c.email}
                  </a>
                )}
                {c.phone && <p className="tabular text-[13px] text-ink-muted">{c.phone}</p>}
              </div>
              {canManage && (
                <div className="flex shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      remove.reset();
                      setRemoving(c);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ContactDialog
        customerId={customer.id}
        contact={editing && editing !== 'new' ? editing : undefined}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.fullName ?? 'contact'}?`}
        body={
          <p>
            They will no longer be listed as a contact for {customer.name}. The activity log keeps a
            record of the removed details.
          </p>
        }
        confirmLabel="Remove contact"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          removing && remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })
        }
      />
    </Panel>
  );
}

function PortalUsersPanel({ customer }: { customer: Customer }) {
  const canRead = useCan('users:read');
  const canManage = useCan('users:manage');
  const users = useCustomerUsers(customer.id, canRead);
  const [creating, setCreating] = useState(false);
  if (!canRead) return null;

  return (
    <Panel>
      <PanelHeader
        title="Portal users"
        description="Can sign in and see this customer's devices."
        actions={
          canManage &&
          customer.isActive && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" /> Add
            </Button>
          )
        }
      />
      {users.isPending ? (
        <div className="p-5" role="status" aria-label="Loading">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} />
      ) : users.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No portal access yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {users.data.map((u) => (
            <li key={u.id} className="px-5 py-3 text-sm">
              <p className="font-medium">
                {u.fullName}
                {!u.isActive && (
                  <span className="ml-2">
                    <Badge tone="neutral">Deactivated</Badge>
                  </span>
                )}
              </p>
              <p className="truncate text-[13px] text-ink-muted">{u.email}</p>
              <p className="text-[12px] text-ink-subtle">
                {u.lastLoginAt
                  ? `Last signed in ${formatDateTime(u.lastLoginAt)}`
                  : 'Never signed in'}
              </p>
            </li>
          ))}
        </ul>
      )}
      <PortalUserDialog customer={customer} open={creating} onOpenChange={setCreating} />
    </Panel>
  );
}

function CustomerBody({ customer }: { customer: Customer }) {
  const canManage = useCan('customers:manage');
  const canSeeAudit = useCan('audit:read');
  const update = useUpdateCustomer(customer.id);
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [activityPage, setActivityPage] = useState(1);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{customer.name}</h1>
            <CustomerTypeBadge type={customer.type} />
            {!customer.isActive && <Badge tone="neutral">Archived</Badge>}
          </div>
          <p className="mt-1 font-mono text-[13px] text-ink-muted">{customer.accountNumber}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button
              onClick={() => {
                update.reset();
                setToggling(true);
              }}
            >
              {customer.isActive ? (
                <>
                  <Archive size={14} aria-hidden="true" /> Archive
                </>
              ) : (
                <>
                  <ArchiveRestore size={14} aria-hidden="true" /> Restore
                </>
              )}
            </Button>
            <Button variant="primary" onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden="true" /> Edit
            </Button>
          </div>
        )}
      </header>

      {!customer.isActive && (
        <div className="mb-5 rounded-md border border-line bg-sunken px-4 py-3 text-sm text-ink-muted">
          This account is archived. Its portal users cannot sign in, and devices cannot be assigned
          to it. Its history is kept.
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title="Profile" />
            <DetailList
              items={[
                [
                  'Email',
                  customer.email && (
                    <a className="text-accent hover:underline" href={`mailto:${customer.email}`}>
                      {customer.email}
                    </a>
                  ),
                ],
                ['Phone', customer.phone],
                ...(customer.type === 'ORGANISATION'
                  ? ([['VAT number', customer.vatNumber]] as Array<[string, string | null]>)
                  : []),
                ['Address', address(customer)],
                ['Customer since', formatDateTime(customer.createdAt)],
              ]}
            />
            {customer.notes && (
              <div className="border-t border-line px-5 py-4">
                <p className="text-[12px] font-medium text-ink-subtle">Internal notes</p>
                <p className="mt-0.5 text-sm whitespace-pre-line">{customer.notes}</p>
              </div>
            )}
          </Panel>
          <DevicesPanel customer={customer} />
          <RepairsPanel customer={customer} />
          {canSeeAudit && (
            <Panel>
              <PanelHeader
                title="Activity"
                description="Changes to this account and its devices."
              />
              <ActivityFeed
                filters={{ customerAccountId: customer.id, page: activityPage, pageSize: 10 }}
                onPage={setActivityPage}
              />
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          <ContactsPanel customer={customer} />
          <PortalUsersPanel customer={customer} />
        </div>
      </div>

      <CustomerFormDialog open={editing} onOpenChange={setEditing} customer={customer} />
      <ConfirmDialog
        open={toggling}
        onOpenChange={setToggling}
        title={customer.isActive ? `Archive ${customer.name}?` : `Restore ${customer.name}?`}
        body={
          customer.isActive ? (
            <p>
              Its portal users are signed out immediately and cannot sign in. Devices stay linked to
              the account, but no new devices can be assigned. You can restore it later.
            </p>
          ) : (
            <p>Portal users will be able to sign in again, and devices can be assigned to it.</p>
          )
        }
        confirmLabel={customer.isActive ? 'Archive customer' : 'Restore customer'}
        tone={customer.isActive ? 'danger' : 'primary'}
        pending={update.isPending}
        error={update.error}
        onConfirm={() =>
          update.mutate(
            { isActive: !customer.isActive, version: customer.version },
            { onSuccess: () => setToggling(false) },
          )
        }
      />
    </>
  );
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const customer = useCustomer(id);

  return (
    <>
      <Link
        to="/customers"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Customers
      </Link>
      {customer.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : customer.isError ? (
        customer.error instanceof ApiError &&
        (customer.error.status === 404 || customer.error.status === 400) ? (
          <EmptyState
            icon={Building2}
            title="Customer not found"
            description="Search the customer list instead."
          />
        ) : (
          <ErrorState error={customer.error} onRetry={() => customer.refetch()} />
        )
      ) : (
        <CustomerBody customer={customer.data} />
      )}
    </>
  );
}
