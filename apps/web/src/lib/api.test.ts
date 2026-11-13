import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, toQueryString } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('api()', () => {
  it('turns the standard error body into an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'CONFLICT', message: 'Changed elsewhere', requestId: 'req-1' },
          }),
          { status: 409 },
        ),
      ),
    );
    const err = await api('/users/1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Changed elsewhere',
      requestId: 'req-1',
    });
  });

  it('reports network failures distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/auth/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});

describe('toQueryString', () => {
  it('omits empty values', () => {
    expect(toQueryString({ a: 'x', b: '', c: undefined, d: 2, e: false })).toBe('?a=x&d=2&e=false');
    expect(toQueryString({})).toBe('');
  });
});
