import { z } from 'zod';

/**
 * Environment configuration, validated once at startup. The process exits with a
 * readable message instead of failing later with an obscure error.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://'), {
        message: 'must be a postgresql:// connection string',
      }),
    ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    COOKIE_SECURE: z.stringbool().default(false),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    SESSION_ABSOLUTE_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(12),
    SESSION_IDLE_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(120),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(10),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production (session cookies require HTTPS)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // The logger depends on env, so write directly to stderr here.
    process.stderr.write(`Invalid environment configuration:\n${problems}\n`);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
