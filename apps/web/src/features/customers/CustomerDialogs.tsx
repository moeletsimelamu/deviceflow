import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  createContactSchema,
  createCustomerSchema,
  createCustomerUserSchema,
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPES,
  PASSWORD_MIN_LENGTH,
  type Contact,
  type Customer,
} from '@deviceflow/shared';
import { Dialog, DialogFooter } from '../../design/Dialog';
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../design/Field';
import { Button } from '../../design/Button';
import { FormError } from '../../design/States';
import { ApiError } from '../../lib/api';
import { useCreateCustomer, useCreateCustomerUser, useSaveContact, useUpdateCustomer } from './api';

type CustomerFormIn = z.input<typeof createCustomerSchema>;
type CustomerFormOut = z.output<typeof createCustomerSchema>;

const emptyCustomer: CustomerFormIn = {
  type: 'ORGANISATION',
  name: '',
  email: '',
  phone: '',
  vatNumber: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  postalCode: '',
  notes: '',
};

function toFormValues(c: Customer): CustomerFormIn {
  return {
    type: c.type,
    name: c.name,
    email: c.email ?? '',
    phone: c.phone ?? '',
    vatNumber: c.vatNumber ?? '',
    addressLine1: c.addressLine1 ?? '',
    addressLine2: c.addressLine2 ?? '',
    city: c.city ?? '',
    region: c.region ?? '',
    postalCode: c.postalCode ?? '',
    notes: c.notes ?? '',
  };
}

/** Field errors from the API (400 details) are shown on the matching inputs. */
function applyServerErrors(
  err: unknown,
  setError: (name: never, error: { message: string }) => void,
): boolean {
  if (!(err instanceof ApiError) || err.details.length === 0) return false;
  for (const d of err.details) setError(d.path as never, { message: d.message });
  return true;
}

/** Creates a customer (then opens it), or edits one when `customer` is given. */
export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customer?: Customer;
}) {
  const navigate = useNavigate();
  const create = useCreateCustomer();
  const update = useUpdateCustomer(customer?.id ?? '');
  const mutation = customer ? update : create;
  const form = useForm<CustomerFormIn, unknown, CustomerFormOut>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: emptyCustomer,
  });
  const type = useWatch({ control: form.control, name: 'type' });

  useEffect(() => {
    if (open) {
      form.reset(customer ? toFormValues(customer) : emptyCustomer);
      create.reset();
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = form.handleSubmit((values) => {
    const onError = (err: unknown) => applyServerErrors(err, form.setError);
    if (customer) {
      update.mutate(
        { ...values, version: customer.version },
        { onSuccess: () => onOpenChange(false), onError },
      );
    } else {
      create.mutate(values, {
        onSuccess: (created) => {
          onOpenChange(false);
          void navigate(`/customers/${created.id}`);
        },
        onError,
      });
    }
  });

  const errors = form.formState.errors;
  const isOrg = type === 'ORGANISATION';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={customer ? `Edit ${customer.name}` : 'New customer'}
      description={
        customer
          ? customer.accountNumber
          : 'An account number is assigned automatically when you save.'
      }
      width="max-w-xl"
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError
          error={
            mutation.error instanceof ApiError && mutation.error.details.length > 0
              ? null
              : mutation.error
          }
        />
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <SelectField
            label="Account type"
            required
            options={CUSTOMER_TYPES.map((t) => ({ value: t, label: CUSTOMER_TYPE_LABELS[t] }))}
            {...form.register('type')}
          />
          <TextField
            label={isOrg ? 'Organisation name' : 'Full name'}
            required
            autoComplete="off"
            error={errors.name?.message}
            {...form.register('name')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={isOrg ? 'Accounts email' : 'Email'}
            type="email"
            autoComplete="off"
            error={errors.email?.message}
            {...form.register('email')}
          />
          <TextField
            label="Phone"
            type="tel"
            autoComplete="off"
            error={errors.phone?.message}
            {...form.register('phone')}
          />
        </div>
        {isOrg && (
          <TextField
            label="VAT number"
            autoComplete="off"
            error={errors.vatNumber?.message}
            {...form.register('vatNumber')}
          />
        )}
        <fieldset className="space-y-3">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Address</legend>
          <TextField
            label="Street address"
            autoComplete="off"
            error={errors.addressLine1?.message}
            {...form.register('addressLine1')}
          />
          <TextField
            label="Suburb or building (optional)"
            autoComplete="off"
            error={errors.addressLine2?.message}
            {...form.register('addressLine2')}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="City" error={errors.city?.message} {...form.register('city')} />
            <TextField
              label="Province"
              error={errors.region?.message}
              {...form.register('region')}
            />
            <TextField
              label="Postal code"
              error={errors.postalCode?.message}
              {...form.register('postalCode')}
            />
          </div>
        </fieldset>
        <TextAreaField
          label="Internal notes"
          hint="Visible to staff only, never in the customer portal."
          error={errors.notes?.message}
          {...form.register('notes')}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            {customer ? 'Save changes' : 'Create customer'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

type ContactFormIn = z.input<typeof createContactSchema>;
type ContactFormOut = z.output<typeof createContactSchema>;

export function ContactDialog({
  customerId,
  contact,
  open,
  onOpenChange,
}: {
  customerId: string;
  /** Undefined to add a new contact. */
  contact?: Contact;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const save = useSaveContact(customerId);
  const form = useForm<ContactFormIn, unknown, ContactFormOut>({
    resolver: zodResolver(createContactSchema),
  });

  useEffect(() => {
    if (open) {
      form.reset({
        fullName: contact?.fullName ?? '',
        email: contact?.email ?? '',
        phone: contact?.phone ?? '',
        jobTitle: contact?.jobTitle ?? '',
        isPrimary: contact?.isPrimary ?? false,
      });
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = form.handleSubmit((values) => {
    const options = {
      onSuccess: () => onOpenChange(false),
      onError: (err: unknown) => applyServerErrors(err, form.setError),
    };
    if (contact)
      save.mutate({ id: contact.id, input: { ...values, version: contact.version } }, options);
    else save.mutate({ input: values }, options);
  });
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={contact ? `Edit ${contact.fullName}` : 'Add contact'}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError
          error={
            save.error instanceof ApiError && save.error.details.length > 0 ? null : save.error
          }
        />
        <TextField
          label="Full name"
          required
          autoComplete="off"
          error={errors.fullName?.message}
          {...form.register('fullName')}
        />
        <TextField
          label="Job title"
          autoComplete="off"
          hint="For example: Principal, IT coordinator, Bursar."
          error={errors.jobTitle?.message}
          {...form.register('jobTitle')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Email"
            type="email"
            autoComplete="off"
            error={errors.email?.message}
            {...form.register('email')}
          />
          <TextField
            label="Phone"
            type="tel"
            autoComplete="off"
            error={errors.phone?.message}
            {...form.register('phone')}
          />
        </div>
        <CheckboxField
          label="Primary contact"
          hint="The person to call first. Replaces the current primary contact."
          {...form.register('isPrimary')}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {contact ? 'Save changes' : 'Add contact'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

type PortalUserIn = z.input<typeof createCustomerUserSchema>;

export function PortalUserDialog({
  customer,
  open,
  onOpenChange,
}: {
  customer: Customer;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateCustomerUser(customer.id);
  const form = useForm<PortalUserIn, unknown, z.output<typeof createCustomerUserSchema>>({
    resolver: zodResolver(createCustomerUserSchema),
    defaultValues: { email: '', fullName: '', password: '' },
  });

  useEffect(() => {
    if (open) {
      form.reset();
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = form.handleSubmit((values) =>
    create.mutate(values, {
      onSuccess: () => onOpenChange(false),
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') {
          form.setError('email', { message: err.message });
        }
      },
    }),
  );
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New portal user"
      description={`Signs in to the customer portal and sees only ${customer.name}'s devices.`}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError
          error={
            create.error instanceof ApiError && create.error.code === 'EMAIL_TAKEN'
              ? null
              : create.error
          }
        />
        <TextField
          label="Full name"
          required
          autoComplete="off"
          error={errors.fullName?.message}
          {...form.register('fullName')}
        />
        <TextField
          label="Email"
          type="email"
          required
          autoComplete="off"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label="Initial password"
          type="password"
          required
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Share it through a secure channel.`}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create portal user
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
