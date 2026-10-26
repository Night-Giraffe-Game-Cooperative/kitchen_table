import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appBlocked, appDeviceName, appState, deviceName, disableInApp, enableInApp, fromBase64Url, refreshInApp, sameKey, type AppNotifier } from './push';

describe('deviceName', () => {
  it('names the browser and the device the way people would', () => {
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', 5)).toBe('Chrome on Android');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 5)).toBe(
      'Safari on iPhone',
    );
    // iPads say they're Macs, but have a touch screen.
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 5)).toBe('Safari on iPad');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 0)).toBe('Safari on Mac');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0', 0)).toBe('Edge on Windows');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0', 0)).toBe('Firefox on Windows');
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0 Safari/537.36', 5)).toBe(
      'Samsung Internet on Android',
    );
  });
});

describe('server keys', () => {
  it('reads base64url and tells whether a subscription was made with the same key', () => {
    const key = fromBase64Url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    expect(key.length).toBe(65);
    expect(key[0]).toBe(4);
    expect(sameKey(key.slice().buffer, key)).toBe(true);
    const other = key.slice();
    other[64] ^= 1;
    expect(sameKey(other.buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});

// The Android app's side, as MainActivity lends it to the page: Android
// answers "may I?" a moment later with an event, the way the real one does.
function fakeApp(state: string, allow = true, token = '') {
  const calls: unknown[][] = [];
  const app: AppNotifier = {
    state: () => state,
    token: () => token,
    endpoint: () => (token ? 'app:tablet' : ''),
    model: () => 'Galaxy Tab A9',
    ask: () => {
      calls.push(['ask']);
      setTimeout(() => window.dispatchEvent(new CustomEvent('kitchentable:notifications', { detail: allow })));
    },
    start: (...args) => calls.push(['start', ...args]),
    stop: () => calls.push(['stop']),
    check: () => calls.push(['check']),
    clear: () => calls.push(['clear']),
    settings: () => calls.push(['settings']),
  };
  return { app, calls };
}

function fakeServer(reply: unknown = { token: 'new-key', endpoint: 'app:tablet', devices: [{ id: 3 }] }) {
  const sent: unknown[][] = [];
  const respond = (method: string) => (path: string, body?: unknown) => {
    sent.push([method, path, body]);
    return Promise.resolve(reply as never);
  };
  return { server: { post: respond('post'), del: respond('del') }, sent };
}

describe('notifications in the Android app', () => {
  beforeEach(() => vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'https://192.168.1.20:4443' } })));
  afterEach(() => vi.unstubAllGlobals());

  it('shows the same switch as a browser would', () => {
    expect(appState(fakeApp('on').app)).toBe('on');
    expect(appState(fakeApp('off').app)).toBe('off');
    expect(appState(fakeApp('blocked').app)).toBe('blocked');
    expect(appState(fakeApp('something new').app)).toBe('off');
    expect(appDeviceName('Pixel 6 Pro')).toBe('Kitchen Table app on Pixel 6 Pro');
    expect(appDeviceName(' ')).toBe('Kitchen Table app on Android');
  });

  it('asks Android first, then tells the server and hands the app its key', async () => {
    const { app, calls } = fakeApp('off');
    const { server, sent } = fakeServer();
    expect(await enableInApp(app, server)).toEqual([{ id: 3 }]);
    expect(sent).toEqual([['post', '/api/push/app', { token: undefined, device: 'Kitchen Table app on Galaxy Tab A9' }]]);
    expect(calls).toEqual([['ask'], ['start', 'https://192.168.1.20:4443', 'new-key', 'app:tablet']]);
  });

  it("stays off when someone says no, or Android's settings don't allow it", async () => {
    const no = fakeApp('off', false);
    const { server, sent } = fakeServer();
    await expect(enableInApp(no.app, server)).rejects.toThrow('Notifications stay off until you allow them.');
    await expect(enableInApp(fakeApp('blocked').app, server)).rejects.toThrow(appBlocked);
    expect(sent).toEqual([]);
    expect(no.calls).toEqual([['ask']]);
  });

  it('says again that it is on when the app opens, keeping its key', async () => {
    const { app, calls } = fakeApp('on', true, 'old-key');
    const { server, sent } = fakeServer({ token: 'old-key', endpoint: 'app:tablet', devices: [] });
    await refreshInApp(app, server);
    expect(sent).toEqual([['post', '/api/push/app', { token: 'old-key', device: 'Kitchen Table app on Galaxy Tab A9' }]]);
    expect(calls).toEqual([['start', 'https://192.168.1.20:4443', 'old-key', 'app:tablet']]);

    // Nothing to say for a device that's off.
    const off = fakeServer();
    await refreshInApp(fakeApp('off').app, off.server);
    expect(off.sent).toEqual([]);
  });

  it('switching off tells the server and stops the app checking', async () => {
    const { app, calls } = fakeApp('on', true, 'old-key');
    const { server, sent } = fakeServer({ devices: [] });
    expect(await disableInApp(app, server)).toEqual([]);
    expect(sent).toEqual([['del', '/api/push/subscriptions', { endpoint: 'app:tablet' }]]);
    expect(calls).toEqual([['stop']]);
  });
});
