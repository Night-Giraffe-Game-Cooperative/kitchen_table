import { describe, expect, it } from 'vitest';
import { deviceName, fromBase64Url, sameKey } from './push';

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
