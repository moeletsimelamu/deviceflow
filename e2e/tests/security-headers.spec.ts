import { expect, test } from '@playwright/test';

/*
 * Response headers as the browser receives them from the production web server
 * (nginx in front of the API). Only meaningful against that stack, so these run
 * when E2E_BASE_URL points at it, for example the Docker Compose demo:
 *
 *   E2E_BASE_URL=http://localhost:8080 npm run test:e2e
 *
 * (The development server has no nginx; the API's own headers are tested in
 * apps/api/test/integration/platform.test.ts.)
 */

test.skip(!process.env.E2E_BASE_URL, 'needs the nginx stack (set E2E_BASE_URL)');

const ONCE = [
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];

for (const [what, path] of [
  ['the app page', '/'],
  ['a client-side route', '/repairs/does-not-exist'],
  ['an API response', '/api/v1/auth/me'],
] as const) {
  test(`${what} carries each security header exactly once`, async ({ request }) => {
    const res = await request.get(path);
    const headers = res.headersArray().map((h) => h.name.toLowerCase());
    for (const name of ONCE) {
      expect(headers.filter((h) => h === name).length, `${name} on ${path}`).toBe(1);
    }
    const all = res.headers();
    expect(all['x-frame-options']).toBe('DENY');
    expect(all['x-content-type-options']).toBe('nosniff');
    expect(all['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(all['content-security-policy']).toContain("script-src 'self'");
    expect(all['server'] ?? '').not.toMatch(/\d/); // no version number
    expect(all['x-powered-by']).toBeUndefined();
  });
}

test('the API is never cached, hashed assets are cached for a year', async ({ request, page }) => {
  const api = await request.get('/api/v1/auth/me');
  expect(api.headers()['cache-control']).toBe('no-store');
  const index = await request.get('/');
  expect(index.headers()['cache-control']).toBe('no-cache');

  await page.goto('/login');
  const script = await page.locator('script[src^="/static/"]').first().getAttribute('src');
  const asset = await request.get(script!);
  expect(asset.headers()['cache-control']).toContain('immutable');
});

test('app addresses that share a prefix with build files still load the app', async ({ page }) => {
  // /assets/<id> is a device page; it must reach the app, not a static-file 404.
  const res = await page.goto('/assets/00000000-0000-4000-8000-000000000000');
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', /.+/);
  await expect(page.locator('#root')).toBeAttached();
});
