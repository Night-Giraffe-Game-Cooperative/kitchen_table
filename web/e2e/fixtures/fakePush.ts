import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// A push service for the end-to-end tests, standing in for Google's or
// Apple's: it keeps what the server sends, and plays the browser's part in
// opening it, with a key pair and secret made here.

export interface Pushed {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac('sha256', key).update(data).digest();

export async function startFakePush() {
  const received: Pushed[] = [];
  const browser = crypto.createECDH('prime256v1');
  browser.generateKeys();
  const auth = crypto.randomBytes(16);

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url ?? '/', headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  /** Opens a notification as the browser would (RFC 8291). */
  const open = ({ body }: Pushed): Record<string, unknown> => {
    const salt = body.subarray(0, 16);
    const idLen = body[20];
    const sender = body.subarray(21, 21 + idLen);
    const ciphertext = body.subarray(21 + idLen);
    const shared = browser.computeSecret(sender);
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), sender, Buffer.from([1])]);
    const prk = hmac(salt, hmac(hmac(auth, shared), info));
    const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
    const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
    let end = plain.length - 1;
    while (plain[end] === 0) end--;
    return JSON.parse(plain.subarray(0, end).toString('utf8'));
  };

  return {
    endpoint: `http://127.0.0.1:${port}/send/mums-phone`,
    keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    received,
    open,
    close: () => server.close(),
  };
}
