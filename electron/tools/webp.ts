/* WebP for the documents' pictures, encoded and decoded by the running app's
   own Chromium (canvas.toBlob('image/webp')), so it is the same on Linux and
   on the Windows runner and needs nothing installed.  Playwright saves PNG or
   JPEG only.

   Lossless for the window's screens: the same pixels as the PNG, in less.
   Lossy for the first screen: a field of thin bright lines on a dark ground
   is what JPEG does worst (the MIPS edition had to take its quality from 85
   down to 78 to stay under its cap); WebP holds it better at the same size.
   Chromium encodes losslessly at quality 1: a 1280x800 window decoded back
   from it is the PNG's pixels, every byte of 4,096,000 (and 10 % smaller). */

import type { Running } from '../tests/e2e/harness.ts';

export type Quality = 'lossless' | number;

export async function toWebp(r: Running, png: Buffer, quality: Quality): Promise<Buffer> {
  const b64 = await r.page.evaluate(async ([data, q]) => {
    const raw = atob(data), u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    const img = await createImageBitmap(new Blob([u8], { type: 'image/png' }));   // not fetch(data:): the window's CSP forbids it
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d')!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((done) => c.toBlob(done, 'image/webp', q === 'lossless' ? 1 : (q as number)));
    if (!blob || blob.type !== 'image/webp') throw new Error(`no WebP from the canvas (${blob?.type ?? 'nothing'})`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, [png.toString('base64'), quality] as const);
  return Buffer.from(b64, 'base64');
}

/** RGBA of a picture (PNG, JPEG or WebP), decoded by the page. */
export async function pixels(r: Running, file: Buffer, type: string): Promise<{ width: number; height: number; data: Buffer }> {
  const got = await r.page.evaluate(async ([data, t]) => {
    const raw = atob(data), u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    const img = await createImageBitmap(new Blob([u8], { type: t }));
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = '';
    for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { width: c.width, height: c.height, data: btoa(s) };
  }, [file.toString('base64'), type] as const);
  return { width: got.width, height: got.height, data: Buffer.from(got.data, 'base64') };
}

export const mime = (file: string): string =>
  file.endsWith('.webp') ? 'image/webp' : file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
