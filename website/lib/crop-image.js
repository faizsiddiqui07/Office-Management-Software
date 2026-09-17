/**
 * Cropper (react-easy-crop) ka chuna hua hissa → square JPEG data-URL.
 *
 * `area` = { x, y, width, height } asli tasveer ke pixel me (croppedAreaPixels). Output
 * hamesha `size`×`size` ka square hai — Avatar use rounded-full se circle dikhata hai,
 * to circle ka mask yahan nahi lagate (JPEG me transparency hoti bhi nahi).
 */
export async function cropToDataUrl(src, area, { size = 384, mime = 'image/jpeg', quality = 0.88 } = {}) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not read the photo'));
    el.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);
  return canvas.toDataURL(mime, quality);
}
