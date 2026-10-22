import crypto from 'node:crypto';
import http from 'node:http';

// Google and Microsoft for the end-to-end tests: a page to say yes on, the
// token endpoints (checking the PKCE code and the app's ID and secret), and
// enough of each calendar API to link a calendar and add to it. The server
// is started with CALENDAR_CONNECT_STAND_IN pointing here, on port 4190.

export const standInPort = 4190;
export const googleClient = { id: '123-family.apps.googleusercontent.com', secret: 'google-secret' };
export const microsoftClient = { id: '0a1b2c3d-1111-2222-3333-444455556666', secret: 'microsoft-secret' };

type Item = Record<string, unknown> & { id: string };

export async function startFakeConnect() {
  const codes = new Map<string, { provider: string; challenge: string; redirect: string }>();
  const access = new Map<string, string>();
  const refresh = new Map<string, string>();
  const google = new Map<string, Item>();
  const graph = new Map<string, Item>();
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  google.set('ev-bake', {
    id: 'ev-bake',
    status: 'confirmed',
    summary: 'Bake sale',
    description: 'Bring <b>flapjacks</b>',
    start: { dateTime: `${day(2)}T15:00:00Z` },
    end: { dateTime: `${day(2)}T16:00:00Z` },
    etag: '"1"',
  });
  graph.set('ms-dentist', {
    id: 'ms-dentist',
    subject: 'Dentist',
    isAllDay: false,
    type: 'singleInstance',
    start: { dateTime: `${day(3)}T10:00:00.0000000`, timeZone: 'UTC' },
    end: { dateTime: `${day(3)}T10:30:00.0000000`, timeZone: 'UTC' },
    '@odata.etag': 'W/"1"',
  });

  const json = (res: http.ServerResponse, status: number, data: unknown) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));

  const issue = (provider: string) => {
    const token = `${provider}-access-${crypto.randomUUID()}`;
    const again = `${provider}-refresh-${crypto.randomUUID()}`;
    access.set(provider, token);
    refresh.set(provider, again);
    const email = provider === 'google' ? 'family.calendar@gmail.com' : 'family.calendar@outlook.com';
    const claims = Buffer.from(JSON.stringify({ email })).toString('base64url');
    return { access_token: token, refresh_token: again, expires_in: 3599, token_type: 'Bearer', id_token: `e30.${claims}.sig` };
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const body = Buffer.concat(chunks).toString();
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const [area, ...rest] = parts;

      // Saying yes: a page with one button, back to the app with a code.
      if (area === 'google-accounts' || (area === 'microsoft-login' && rest.at(-1) === 'authorize')) {
        const provider = area === 'google-accounts' ? 'google' : 'microsoft';
        const q = url.searchParams;
        const code = crypto.randomUUID();
        codes.set(code, { provider, challenge: q.get('code_challenge') ?? '', redirect: q.get('redirect_uri') ?? '' });
        const back = `${q.get('redirect_uri')}?${new URLSearchParams({ code, state: q.get('state') ?? '' })}`;
        res.writeHead(200, { 'content-type': 'text/html' }).end(
          `<!doctype html><title>Sign in</title><main><h1>${provider === 'google' ? 'Google' : 'Microsoft'}</h1><p>Kitchen Table wants to see and change your calendars.</p><a href="${back}">Allow</a></main>`,
        );
        return;
      }

      if ((area === 'google-oauth' && rest[0] === 'token') || (area === 'microsoft-login' && rest.at(-1) === 'token')) {
        const provider = area === 'google-oauth' ? 'google' : 'microsoft';
        const form = new URLSearchParams(body);
        const client = provider === 'google' ? googleClient : microsoftClient;
        if (form.get('client_id') !== client.id || form.get('client_secret') !== client.secret) return json(res, 401, { error: 'invalid_client' });
        if (form.get('grant_type') === 'authorization_code') {
          const c = codes.get(form.get('code') ?? '');
          const verified = crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
          codes.delete(form.get('code') ?? '');
          if (!c || c.provider !== provider || c.challenge !== verified || c.redirect !== form.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant' });
          return json(res, 200, issue(provider));
        }
        if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === refresh.get(provider)) return json(res, 200, issue(provider));
        return json(res, 400, { error: 'invalid_grant' });
      }

      if (area === 'google-oauth' && rest[0] === 'revoke') return void res.writeHead(200).end();

      const provider = area === 'google-api' ? 'google' : area === 'microsoft-graph' ? 'microsoft' : null;
      if (!provider) return void res.writeHead(404).end();
      if (req.headers.authorization !== `Bearer ${access.get(provider)}`) return void res.writeHead(401).end();

      if (provider === 'google') {
        if (rest.join('/') === 'users/me/calendarList')
          return json(res, 200, {
            items: [
              { id: 'family.calendar@gmail.com', summary: 'family.calendar@gmail.com', summaryOverride: 'Family', backgroundColor: '#7986cb', accessRole: 'owner', primary: true },
              { id: 'en.uk#holiday@group.v.calendar.google.com', summary: 'Holidays in the United Kingdom', backgroundColor: '#16a765', accessRole: 'reader' },
            ],
          });
        const [, calendar, , id] = rest;
        if (calendar !== 'family.calendar@gmail.com') return json(res, 200, { items: [], updated: '2026-01-01T00:00:00Z' });
        if (req.method === 'GET') {
          if (url.searchParams.get('fields') === 'updated') return json(res, 200, { updated: String(google.size) + [...google.values()].map((i) => i.etag).join() });
          return json(res, 200, { items: [...google.values()] });
        }
        if (req.method === 'POST') {
          const item = { ...JSON.parse(body), id: `ev-${crypto.randomUUID()}`, status: 'confirmed', etag: `"${Date.now()}"` };
          google.set(item.id, item);
          return json(res, 200, item);
        }
        if (req.method === 'PATCH' && id && google.has(id)) {
          const item = { ...google.get(id)!, ...JSON.parse(body), etag: `"${Date.now()}"` };
          google.set(id, item);
          return json(res, 200, item);
        }
        if (req.method === 'DELETE' && id) {
          google.delete(id);
          return void res.writeHead(204).end();
        }
        return json(res, 404, {});
      }

      // Microsoft Graph.
      if (rest.join('/') === 'me/calendars')
        return json(res, 200, { value: [{ id: 'ms-cal', name: 'Calendar', hexColor: '#e9a06b', canEdit: true, isDefaultCalendar: true }] });
      if (rest[3] === 'calendarView') return json(res, 200, { value: [...graph.values()] });
      if (req.method === 'POST' && rest[3] === 'events') {
        const item = { ...JSON.parse(body), id: `ms-${crypto.randomUUID()}`, type: 'singleInstance', '@odata.etag': `W/"${Date.now()}"` };
        graph.set(item.id, item);
        return json(res, 201, item);
      }
      const id = rest[2];
      if (req.method === 'PATCH' && id && graph.has(id)) {
        const item = { ...graph.get(id)!, ...JSON.parse(body), '@odata.etag': `W/"${Date.now()}"` };
        graph.set(id, item);
        return json(res, 200, item);
      }
      if (req.method === 'DELETE' && id) {
        graph.delete(id);
        return void res.writeHead(204).end();
      }
      return json(res, 404, {});
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(standInPort, '127.0.0.1', resolve);
  });

  return { google, graph, close: () => server.close() };
}
