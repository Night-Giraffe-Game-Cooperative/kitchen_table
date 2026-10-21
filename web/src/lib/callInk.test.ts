import { describe, expect, it } from 'vitest';
import { addPoint, inkIdea, pictureHeight, toPicture, toScreen, type Fit } from './callInk';

describe('drawing over the call', () => {
  const wide: Fit = { w: 800, h: 300, vw: 640, vh: 480, mirrored: false };
  const tall: Fit = { w: 300, h: 600, vw: 640, vh: 480, mirrored: false };

  it('turns screen points into picture points and back', () => {
    for (const fit of [wide, tall, { ...wide, mirrored: true }]) {
      const [u, v] = toPicture(fit, 123, 87);
      const [x, y] = toScreen(fit, u, v);
      expect(x).toBeCloseTo(123, 0);
      expect(y).toBeCloseTo(87, 0);
    }
  });

  it('keeps a point on the same part of the picture whatever the frame', () => {
    // The middle of the picture is the middle of every frame, however it's cropped.
    expect(toScreen(wide, 0.5, 0.5)).toEqual([400, 150]);
    expect(toScreen(tall, 0.5, 0.5)).toEqual([150, 300]);
    // A wide frame crops the top and bottom; a tall one crops the sides.
    expect(toScreen(wide, 0, 0)[1]).toBeLessThan(0);
    expect(toScreen(tall, 0, 0)[0]).toBeLessThan(0);
  });

  it('flips left and right on a mirrored picture', () => {
    const mirrored = { ...wide, mirrored: true };
    const [u] = toPicture(mirrored, 100, 150);
    expect(u).toBeGreaterThan(0.5);
    expect(toScreen(mirrored, u, 0.5)[0]).toBeCloseTo(100, 0);
  });

  it('scales sizes with the picture, not the frame', () => {
    expect(pictureHeight(wide)).toBe(600);
    expect(pictureHeight(tall)).toBe(600);
  });

  it('skips points too close to the last one', () => {
    const points = [0.5, 0.5];
    expect(addPoint(points, 0.501, 0.5)).toBe(false);
    expect(addPoint(points, 0.51, 0.5)).toBe(true);
    expect(points).toEqual([0.5, 0.5, 0.51, 0.5]);
  });

  it('suggests something to draw on someone in the call', () => {
    const idea = inkIdea(['Mia', 'Jo'], () => 0);
    expect(idea).toBe('Give Mia a big curly moustache');
    expect(inkIdea([], () => 0.99)).not.toContain('{name}');
  });
});
