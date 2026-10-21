import http from 'node:http';
import type { AddressInfo } from 'node:net';

// A small CalDAV server for the end-to-end tests, standing in for iCloud or
// Fastmail: one account (alex, "app-password") with a family calendar, and a
// school's calendar feed anyone can fetch.

const user = 'alex';
const password = 'app-password';
const home = '/calendars/alex/';
const family = `${home}family/`;

function day(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function vevent(lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

export async function startFakeCaldav() {
  let ctag = 1;
  let etags = 1;
  const objects = new Map<string, { data: string; etag: string }>();
  const put = (path: string, data: string) => {
    objects.set(path, { data, etag: `"${etags++}"` });
    ctag++;
  };

  // Already in the calendar: the dentist this afternoon, and football every Saturday.
  put(`${family}dentist.ics`, vevent(['UID:dentist', `DTSTART;TZID=Europe/London:${day(0)}T163000`, `DTEND;TZID=Europe/London:${day(0)}T171500`, 'SUMMARY:Dentist', 'LOCATION:High Street']));
  put(
    `${family}football.ics`,
    vevent(['UID:football', `DTSTART;TZID=Europe/London:${day(1)}T100000`, `DTEND;TZID=Europe/London:${day(1)}T110000`, 'RRULE:FREQ=WEEKLY;COUNT=10', 'SUMMARY:Football']),
  );

  const school = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Oak Primary',
    'BEGIN:VEVENT',
    'UID:inset',
    `DTSTART;VALUE=DATE:${day(2)}`,
    'SUMMARY:INSET day (school closed)',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const response = (href: string, props: string) =>
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  const multistatus = (res: http.ServerResponse, responses: string[]) => {
    res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
    res.end(
      '<?xml version="1.0" encoding="UTF-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" ' +
        `xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">${responses.join('')}</d:multistatus>`,
    );
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      if (path === '/feeds/school.ics') {
        res.writeHead(200, { 'content-type': 'text/calendar' });
        return res.end(school);
      }
      if (req.headers.authorization !== `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="calendars"' });
        return res.end();
      }
      const method = req.method ?? 'GET';
      if (method === 'PROPFIND' && path === '/') {
        return multistatus(res, [response('/', '<d:current-user-principal><d:href>/principals/alex/</d:href></d:current-user-principal>')]);
      }
      if (method === 'PROPFIND' && path === '/principals/alex/') {
        return multistatus(res, [response(path, `<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`)]);
      }
      if (method === 'PROPFIND' && path === home) {
        return multistatus(res, [
          response(home, '<d:resourcetype><d:collection/></d:resourcetype>'),
          response(
            family,
            '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Family</d:displayname>' +
              '<a:calendar-color>#FF2968FF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>' +
              `<d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege></d:current-user-privilege-set><cs:getctag>${ctag}</cs:getctag>`,
          ),
          response(
            `${home}reminders/`,
            '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname>' +
              '<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>',
          ),
        ]);
      }
      if (method === 'PROPFIND' && path === family) return multistatus(res, [response(family, `<cs:getctag>${ctag}</cs:getctag>`)]);
      if (method === 'REPORT' && path === family) {
        return multistatus(
          res,
          [...objects].map(([href, o]) => response(href, `<d:getetag>${escape(o.etag)}</d:getetag><c:calendar-data>${escape(o.data)}</c:calendar-data>`)),
        );
      }
      const object = objects.get(path);
      if (method === 'GET' && object) {
        res.writeHead(200, { 'content-type': 'text/calendar', etag: object.etag });
        return res.end(object.data);
      }
      if (method === 'PUT') {
        if (req.headers['if-none-match'] === '*' && object) return res.writeHead(412).end();
        if (req.headers['if-match'] && req.headers['if-match'] !== object?.etag) return res.writeHead(412).end();
        put(path, body);
        res.writeHead(object ? 204 : 201, { etag: objects.get(path)!.etag });
        return res.end();
      }
      if (method === 'DELETE') {
        objects.delete(path);
        ctag++;
        return res.writeHead(204).end();
      }
      res.writeHead(404).end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, objects, close: () => server.close() };
}
