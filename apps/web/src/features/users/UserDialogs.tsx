import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  createUserSchema,
  PASSWORD_MIN_LENGTH,
  ROLE_LABELS,
  STAFF_ROLE_OPTIONS,
  type User,
} from '@deviceflow/shared';
import { Dialog, DialogFooter } from '../../design/Dialog';
import { SelectField, TextField } from '../../design/Field';
import { Button } from '../../design/Button';
import { FormError } from '../../design/States';
import { ApiError } from '../../lib/api';
import { useCreateUser, useUpdateUser } from './api';

const roleOptions = STAFF_ROLE_OPTIONS.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateUser();
  const form = useForm<
    z.input<typeof createUserSchema>,
    unknown,
    z.output<typeof createUserSchema>
  >({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', fullName: '', role: 'TECHNICIAN', password: '' },
  });

  useEffect(() => {
    if (!open) {
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
  const bannerError =
    create.error instanceof ApiError && create.error.code === 'EMAIL_TAKEN' ? null : create.error;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New staff user"
      description="The user signs in with this email and password. Share the password through a secure channel."
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={bannerError} />
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
        <SelectField
          label="Role"
          required
          options={roleOptions}
          error={errors.role?.message}
          {...form.register('role')}
        />
        <TextField
          label="Initial password"
          type="password"
          required
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create user
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const editSchema = z.object({
  fullName: createUserSchema.shape.fullName,
  role: z.enum(STAFF_ROLE_OPTIONS),
});

export function EditUserDialog({
  user,
  isSelf,
  onOpenChange,
}: {
  user: User | null;
  isSelf: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const update = useUpdateUser();
  const form = useForm<z.input<typeof editSchema>, unknown, z.output<typeof editSchema>>({
    resolver: zodResolver(editSchema),
  });

  useEffect(() => {
    if (user && user.role !== 'CUSTOMER') {
      form.reset({ fullName: user.fullName, role: user.role });
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) return null;

  const onSubmit = form.handleSubmit((values) => {
    const input = {
      version: user.version,
      ...(values.fullName !== user.fullName ? { fullName: values.fullName } : {}),
      ...(values.role !== user.role ? { role: values.role } : {}),
    };
    if (Object.keys(input).length === 1) return onOpenChange(false);
    update.mutate({ id: user.id, input }, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Edit ${user.fullName}`}
      description={user.email}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={update.error} />
        <TextField
          label="Full name"
          required
          error={form.formState.errors.fullName?.message}
          {...form.register('fullName')}
        />
        <SelectField
          label="Role"
          required
          options={roleOptions}
          disabled={isSelf}
          hint={
            isSelf
              ? 'You cannot change your own role.'
              : 'Changing the role signs the user out so the new permissions apply immediately.'
          }
          {...form.register('role')}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
