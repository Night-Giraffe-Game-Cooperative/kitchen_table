import { api } from './api';

// Notifications on this device while the app is closed. The browser keeps a
// subscription at its push service (Google's, Mozilla's or Apple's); the
// server sends to it, encrypted so only this browser can read it.

export type PushState = 'unsupported' | 'install-first' | 'blocked' | 'off' | 'on';

export interface PushDevice {
  id: number;
  device: string | null;
  since: string;
  last_used_at: string | null;
  endpoint_hash: string;
}

interface PushInfo {
  key: string;
  devices: PushDevice[];
}

export function isApple(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function installed(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * The Kitchen Table Android app (android/), as a version like 1.1, when this
 * page is inside it. It can't show notifications: only a browser can.
 */
export function androidApp(): number | null {
  const m = navigator.userAgent.match(/KitchenTableApp\/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

async function subscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  // iPhones and iPads only offer notifications to the app on the Home Screen.
  if (!pushSupported()) return isApple() && !installed() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && (await subscription()) ? 'on' : 'off';
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

// A subscription made for an older server key can't be sent to, so it's renewed.
async function subscribed(reg: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  const serverKey = fromBase64Url(key);
  const current = await reg.pushManager.getSubscription();
  if (current && sameKey(current.options?.applicationServerKey, serverKey)) return current;
  await current?.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
}

/** Asks the browser for permission (it must follow a tap), subscribes, and tells the server. */
export async function enablePush(): Promise<PushDevice[]> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') throw new Error("Notifications are blocked for this site. Allow them in the browser's settings, then try again.");
  if (permission !== 'granted') throw new Error('Notifications stay off until you allow them.');
  const [reg, info] = await Promise.all([registration(), api.get<PushInfo>('/api/push')]);
  const sub = await subscribed(reg, info.key);
  const res = await api.post<{ devices: PushDevice[] }>('/api/push/subscriptions', { subscription: sub.toJSON(), device: deviceName() });
  return res.devices;
}

export async function disablePush(): Promise<PushDevice[] | null> {
  const sub = await subscription();
  if (!sub) return null;
  const res = await api.del<{ devices: PushDevice[] }>('/api/push/subscriptions', { endpoint: sub.endpoint }).catch(() => null);
  await sub.unsubscribe().catch(() => {});
  return res?.devices ?? null;
}

export async function testPush(): Promise<void> {
  const sub = await subscription();
  if (!sub) throw new Error("Notifications aren't on for this device yet.");
  await api.post('/api/push/test', { endpoint: sub.endpoint });
}

/** Which of the person's devices is this one, by a fingerprint of its address. */
export async function thisDevice(devices: PushDevice[]): Promise<PushDevice | undefined> {
  const sub = await subscription();
  if (!sub) return undefined;
  const hash = await endpointHash(sub.endpoint);
  return devices.find((d) => d.endpoint_hash === hash);
}

async function endpointHash(endpoint: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))).slice(0, 9);
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * On opening the app, tells the server about this device's subscription
 * again, so it survives a server restore or a new server key.
 */
export async function refreshPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg || !(await reg.pushManager.getSubscription())) return;
  const info = await api.get<PushInfo>('/api/push');
  const sub = await subscribed(reg, info.key);
  await api.post('/api/push/subscriptions', { subscription: sub.toJSON(), device: deviceName() });
}

/** Clears this app's notifications once someone is looking at the app itself. */
export function clearNotifications() {
  if (!pushSupported()) return;
  navigator.serviceWorker
    .getRegistration()
    .then((reg) => reg?.getNotifications())
    .then((list) => list?.forEach((n) => n.close()))
    .catch(() => {});
}

/** A name for this device people will recognise in a list, such as "Chrome on Android". */
export function deviceName(ua = navigator.userAgent, touch = navigator.maxTouchPoints): string {
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'Chromebook'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Mac OS X|Macintosh/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'this device';
  const browser = /Edg(A|iOS)?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Firefox|FxiOS/.test(ua)
        ? 'Firefox'
        : /OPR\//.test(ua)
          ? 'Opera'
          : /Chrome|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari/.test(ua)
              ? 'Safari'
              : 'Browser';
  return `${browser} on ${os}`;
}
