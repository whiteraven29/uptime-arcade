import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, post, refreshAccess, setAccess, setSignedOutHandler } from './client.js';

const json = (status, body) => ({ status, ok: status < 400, json: async () => body });

beforeEach(() => {
  setAccess(null);
  setSignedOutHandler(() => {});
});

describe('the API client', () => {
  it('sends the access token', async () => {
    setAccess('tok');
    const fetchMock = vi.fn(async () => json(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/player/');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });
  it('never puts tokens in the URL or anywhere but the header', async () => {
    setAccess('secret-token');
    const fetchMock = vi.fn(async () => json(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await post('/sessions/open/', { a: 1 });
    expect(fetchMock.mock.calls[0][0]).not.toContain('secret-token');
    expect(fetchMock.mock.calls[0][1].body).not.toContain('secret-token');
  });
  it('turns the error shape into an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: { code: 'no_active_session', message: 'Open a session first.' } })));
    await expect(post('/sessions/close/')).rejects.toMatchObject({ status: 409, code: 'no_active_session', message: 'Open a session first.' });
  });
  it('says so when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(api('/player/')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/player/')).rejects.toMatchObject({ code: 'offline' });
  });
  it('refreshes once on a 401 and retries', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/auth/refresh/')) return json(200, { access: 'new' });
      calls += 1;
      return calls === 1 ? json(401, { error: { code: 'not_authenticated', message: 'x' } }) : json(200, { fine: true });
    }));
    await expect(api('/player/')).resolves.toEqual({ fine: true });
  });
  it('shares one refresh between requests, because each refresh token works once', async () => {
    let refreshes = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/auth/refresh/')) {
        refreshes += 1;
        return json(200, { access: 'new' });
      }
      return json(200, {});
    }));
    await Promise.all([refreshAccess(), refreshAccess(), refreshAccess()]);
    expect(refreshes).toBe(1);
  });
  it('signs out when the refresh fails too', async () => {
    const out = vi.fn();
    setSignedOutHandler(out);
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: { code: 'not_logged_in', message: 'Please log in.' } })));
    await expect(api('/player/')).rejects.toBeInstanceOf(ApiError);
    expect(out).toHaveBeenCalledOnce();
  });
  it("doesn't try to refresh after a wrong password", async () => {
    const fetchMock = vi.fn(async () => json(401, { error: { code: 'bad_credentials', message: 'Wrong username or password.' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(post('/auth/login/', {})).rejects.toMatchObject({ code: 'bad_credentials' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
