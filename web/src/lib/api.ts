// Talks to the Phoenix server. Sign-in lives in an HttpOnly cookie; every
// change carries the x-family header, which the server requires.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const messages: Record<string, string> = {
  signed_out: 'You have been signed out.',
  must_change_password: 'Choose a new password first.',
  missing_header: 'Please reload the page.',
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { accept: 'application/json' }, credentials: 'same-origin' };
  const headers = init.headers as Record<string, string>;
  if (method !== 'GET') headers['x-family'] = '1';

  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "Can't reach the family server. Check the Wi-Fi and try again.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : undefined;
    const message = (code && messages[code]) || code || 'Something went wrong. Try again in a minute.';
    if (code === 'signed_out' || code === 'must_change_password') {
      window.dispatchEvent(new CustomEvent('family:auth', { detail: code }));
    }
    throw new ApiError(res.status, message, code);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
