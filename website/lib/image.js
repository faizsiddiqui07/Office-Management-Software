'use client';

/**
 * Downscale + compress an image File into a small data URL before upload.
 * Images are stored as base64 in the settings document, so keeping them small
 * matters (smaller DB doc + lighter responses). SVGs are vector + tiny, so they
 * pass through unchanged.
 *
 * @param {File} file
 * @param {{ maxDim?: number, mime?: 'image/jpeg'|'image/png', quality?: number }} opts
 * @returns {Promise<string>} a "data:...;base64,..." URL
 */
export function downscaleImage(file, { maxDim = 1600, mime = 'image/jpeg', quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read that file'));
      r.readAsDataURL(file);
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height || 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not process image'));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL(mime, quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load that image'));
    };
    img.src = url;
  });
}
