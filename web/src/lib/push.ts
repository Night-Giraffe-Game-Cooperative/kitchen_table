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
 * page is inside it. Before 1.3 it can't show notifications; from 1.3 it
 * fetches and shows them itself (appNotifier).
 */
export function androidApp(): number | null {
  const m = navigator.userAgent.match(/KitchenTableApp\/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/**
 * The Android app's own notifications, lent to the page as
 * KitchenTableNotifications. Its web view has no push service, so the app
 * checks the server for them itself with a key the server gives it: about
 * every minute while it's open or in the background, otherwise every 15
 * minutes or so. The page switches them on and off as it would in a browser.
 */
export interface AppNotifier {
  /** 'on', 'off', or 'blocked' when Android's settings won't let the app show any. */
  state(): string;
  /** The key it checks with, or '' if it has none. */
  token(): string;
  endpoint(): string;
  /** What the device is called, like "Pixel 6 Pro". */
  model(): string;
  /** Asks Android's permission, answering with a kitchentable:notifications event. */
  ask(): void;
  start(origin: string, token: string, endpoint: string): void;
  stop(): void;
  /** Checks for new ones straight away. */
  check(): void;
  /** Clears the ones showing, and lets go of any waiting, once someone's using the app. */
  clear(): void;
  /** Opens the app's notification settings. */
  settings(): void;
}

export function appNotifier(): AppNotifier | undefined {
  return typeof window !== 'undefined' ? (window as unknown as { KitchenTableNotifications?: AppNotifier }).KitchenTableNotifications : undefined;
}

interface AppDevice {
  token: string;
  endpoint: string;
  devices: PushDevice[];
}

type Server = Pick<typeof api, 'post' | 'del'>;

export const appBlocked = "Notifications are switched off for Kitchen Table in this device's settings. Allow them there, then try again.";

export function appState(app: AppNotifier): PushState {
  const state = app.state();
  return state === 'on' || state === 'blocked' ? state : 'off';
}

export function appDeviceName(model: string): string {
  return `Kitchen Table app on ${model.trim() || 'Android'}`;
}

// Android answers the page through an event, once someone has tapped Allow or Don't allow.
function askApp(app: AppNotifier): Promise<boolean> {
  return new Promise((resolve) => {
    const answer = (e: Event) => {
      window.removeEventListener('kitchentable:notifications', answer);
      resolve((e as CustomEvent).detail === true);
    };
    window.addEventListener('kitchentable:notifications', answer);
    app.ask();
  });
}

// Tells the server about this device (again), and the app the key to check with.
async function registerApp(app: AppNotifier, server: Server): Promise<AppDevice> {
  const res = await server.post<AppDevice>('/api/push/app', { token: app.token() || undefined, device: appDeviceName(app.model()) });
  app.start(window.location.origin, res.token, res.endpoint);
  return res;
}

export async function enableInApp(app: AppNotifier, server: Server = api): Promise<PushDevice[]> {
  if (app.state() === 'blocked') throw new Error(appBlocked);
  if (!(await askApp(app))) throw new Error('Notifications stay off until you allow them.');
  return (await registerApp(app, server)).devices;
}

export async function disableInApp(app: AppNotifier, server: Server = api): Promise<PushDevice[] | null> {
  const endpoint = app.endpoint();
  const res = endpoint ? await server.del<{ devices: PushDevice[] }>('/api/push/subscriptions', { endpoint }).catch(() => null) : null;
  app.stop();
  return res?.devices ?? null;
}

/**
 * In the Android app, news that comes in while it's in the background (but
 * still connected) is checked for straight away, rather than at the app's
 * next check: a call only rings for 45 seconds. A quick run of messages
 * makes one check.
 */
let checking: number | undefined;

export function checkSoon() {
  const app = appNotifier();
  if (!app || document.visibilityState !== 'hidden' || checking !== undefined) return;
  checking = window.setTimeout(() => {
    checking = undefined;
    app.check();
  }, 2000);
}

/** On opening the app, says again that this device's notifications are on, so they follow a new sign-in or a server restore. */
export async function refreshInApp(app: AppNotifier, server: Server = api): Promise<void> {
  if (!app.token() || app.state() !== 'on') return;
  await registerApp(app, server);
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
  const app = appNotifier();
  if (app) return appState(app);
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
  const app = appNotifier();
  if (app) return enableInApp(app);
  const permission = await Notification.requestPermission();
  if (permission === 'denied') throw new Error("Notifications are blocked for this site. Allow them in the browser's settings, then try again.");
  if (permission !== 'granted') throw new Error('Notifications stay off until you allow them.');
  const [reg, info] = await Promise.all([registration(), api.get<PushInfo>('/api/push')]);
  const sub = await subscribed(reg, info.key);
  const res = await api.post<{ devices: PushDevice[] }>('/api/push/subscriptions', { subscription: sub.toJSON(), device: deviceName() });
  return res.devices;
}

export async function disablePush(): Promise<PushDevice[] | null> {
  const app = appNotifier();
  if (app) return disableInApp(app);
  const sub = await subscription();
  if (!sub) return null;
  const res = await api.del<{ devices: PushDevice[] }>('/api/push/subscriptions', { endpoint: sub.endpoint }).catch(() => null);
  await sub.unsubscribe().catch(() => {});
  return res?.devices ?? null;
}

export async function testPush(): Promise<void> {
  const app = appNotifier();
  const endpoint = app ? app.endpoint() : (await subscription())?.endpoint;
  if (!endpoint) throw new Error("Notifications aren't on for this device yet.");
  await api.post('/api/push/test', { endpoint });
  // The app would otherwise only find it on its next check.
  app?.check();
}

/** Which of the person's devices is this one, by a fingerprint of its address. */
export async function thisDevice(devices: PushDevice[]): Promise<PushDevice | undefined> {
  const app = appNotifier();
  const endpoint = app ? app.endpoint() : (await subscription())?.endpoint;
  if (!endpoint) return undefined;
  const hash = await endpointHash(endpoint);
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
  const app = appNotifier();
  if (app) return refreshInApp(app);
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg || !(await reg.pushManager.getSubscription())) return;
  const info = await api.get<PushInfo>('/api/push');
  const sub = await subscribed(reg, info.key);
  await api.post('/api/push/subscriptions', { subscription: sub.toJSON(), device: deviceName() });
}

/** Clears this app's notifications once someone is looking at the app itself. */
export function clearNotifications() {
  const app = appNotifier();
  if (app) return app.clear();
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
