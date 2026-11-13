import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router';
import { loginSchema } from '@deviceflow/shared';
import type { z } from 'zod';
import { useLogin } from './session';
import { Button } from '../../design/Button';
import { TextField } from '../../design/Field';
import { FormError } from '../../design/States';

/** Only allow redirects to paths inside this app (prevents open redirects). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => navigate(safeNext(params.get('next')), { replace: true }),
    }),
  );

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_480px]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-ink-inverse lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-base font-semibold tracking-tight">DeviceFlow</span>
        </div>
        <div className="mt-auto max-w-md">
          <p className="font-mono text-[12px] tracking-wide text-accent-bright uppercase">
            Device lifecycle & repair
          </p>
          <h1 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.02em]">
            Every device, every repair, one accountable record.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-sidebar-muted">
            Register assets, run repairs from fault report to collection, and keep parts and
            customers in step — with a full audit trail behind every change.
          </p>
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 size-[420px] rounded-full border border-white/5"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 -right-8 size-[260px] rounded-full border border-white/5"
        />
      </section>

      <section className="flex items-center justify-center bg-surface px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-6" />
            <span className="font-semibold">DeviceFlow</span>
          </div>
          <h2 className="text-xl font-semibold tracking-[-0.01em]">Sign in</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Use the account your administrator created for you.
          </p>

          <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
            {login.error && <FormError error={login.error} />}
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              autoFocus
              error={form.formState.errors.email?.message}
              {...form.register('email')}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              error={form.formState.errors.password?.message}
              {...form.register('password')}
            />
            <Button type="submit" variant="primary" className="w-full" loading={login.isPending}>
              Sign in
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
