/**
 * Shrinks a photo in the browser before it's uploaded: phones take 4–12 MB pictures, and
 * crews post from job sites on mobile data. Gives a JPEG up to `max` px on its long side,
 * plus a small thumbnail for the message list.
 */
export interface ResizedPhoto {
  photo: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This photo couldn't be read."))), "image/jpeg", quality));

function draw(source: ImageBitmap, longSide: number): HTMLCanvasElement {
  const scale = Math.min(1, longSide / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This photo couldn't be read.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function resizePhoto(file: Blob, max = 1600, thumbMax = 400): Promise<ResizedPhoto> {
  // imageOrientation: "from-image" keeps phone photos the right way up.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const big = draw(bitmap, max);
    const small = draw(bitmap, thumbMax);
    const [photo, thumb] = await Promise.all([toBlob(big, 0.8), toBlob(small, 0.7)]);
    return { photo, thumb, width: big.width, height: big.height };
  } finally {
    bitmap.close();
  }
}
