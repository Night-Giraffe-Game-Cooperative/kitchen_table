import { api } from './api';
import type { Media } from './types';

const MAX_SIDE = 1600;

export interface Prepared {
  blob: Blob;
  width: number;
  height: number;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That photo couldn't be opened."));
    img.src = src;
  });
}

/**
 * Shrinks a photo to at most 1600 pixels on its longest side, turned the right
 * way up, as a JPEG. GIFs are sent as they are so they keep moving.
 */
export async function preparePhoto(file: File): Promise<Prepared> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { naturalWidth: w, naturalHeight: h } = img;
    if (file.type === 'image/gif' && file.size < 8_000_000) return { blob: file, width: w, height: h };

    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const width = Math.round(w * scale);
    const height = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const keepPng = file.type === 'image/png' && file.size < 1_500_000;
    const blob = await toBlob(canvas, keepPng ? 'image/png' : 'image/jpeg', 0.86);
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function toBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture couldn't be saved."))), type, quality),
  );
}

export async function upload(roomId: number, picture: Prepared): Promise<{ media: Media; media_id: number }> {
  const form = new FormData();
  const ext = picture.blob.type.split('/')[1] ?? 'jpg';
  form.append('file', picture.blob, `picture.${ext}`);
  form.append('width', String(picture.width));
  form.append('height', String(picture.height));
  return api.post(`/api/rooms/${roomId}/media`, form);
}
