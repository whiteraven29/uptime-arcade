/* The HTTP client for /api/v1 (section 16).

The access token is kept in this module's memory and nowhere else, so a script on the page can't find
it in storage. It lasts 15 minutes. When it runs out, the refresh cookie gets a new one, and the
browser sends that cookie by itself because scripts can't read it. */
const BASE = '/api/v1';

let access = null;
let onSignedOut = () => {};
let refreshing = null;

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const setSignedOutHandler = (fn) => {
  onSignedOut = fn;
};
export const setAccess = (token) => {
  access = token;
};

async function send(path, { method = 'GET', body } = {}) {
  const headers = {};
  const isFile = body instanceof FormData;
  if (body !== undefined && !isFile) headers['Content-Type'] = 'application/json';
  if (access) headers.Authorization = `Bearer ${access}`;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined || isFile ? body : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch { /* an empty or non-JSON body falls through to the error below */ }
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(res.status, e.code || 'error', e.message || 'Something went wrong. Try again.', e.details);
  }
  return data;
}

/** Only one refresh at a time: each refresh token works once, so a second one would log you out. */
export function refreshAccess() {
  if (!refreshing) {
    refreshing = send('/auth/refresh/', { method: 'POST' })
      .then((d) => {
        access = d.access;
        return true;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api(path, options) {
  try {
    return await send(path, options);
  } catch (e) {
    if (e.status !== 401 || e.code === 'bad_credentials' || path.startsWith('/auth/refresh')) throw e;
    try {
      await refreshAccess();
    } catch {
      access = null;
      onSignedOut();
      throw e;
    }
    return send(path, options);
  }
}

export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const del = (path, body) => api(path, { method: 'DELETE', body });
export const get = (path) => api(path);
