'use client';

/**
 * File bhejne se pehle browser me hone wala kaam.
 *
 * Teen cheezein yahan hoti hain aur teeno ki apni wajah hai:
 *  1. Photo chhoti ki jaati hai — phone ki 4 MB wali photo ~500 KB reh jaati hai. Ye
 *     upload ki speed, S3 ka bill aur saamne wale ka mobile data, teeno bachata hai.
 *  2. Thumbnail yahin banta hai — server ya S3 se nahi banwaya ja sakta bina file ko
 *     kholе, aur wo bekaar ka Lambda kaam aur kharcha hai.
 *  3. Bytes seedhe S3 jaate hain, XHR se — kyunki `fetch` upload ka progress nahi batata,
 *     aur ek badi file bina progress ke "atki hui" lagti hai.
 */

export const MB = 1024 * 1024;

export function prettyBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${Math.round(n / 1024)} KB`;
  return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}

export const isImage = (mime) => String(mime || '').startsWith('image/');
export const isVideo = (mime) => String(mime || '').startsWith('video/');
export const isPdf = (mime) => String(mime || '') === 'application/pdf';

/** Blob → dimensions, ek chhoti si madad. */
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

function canvasToBlob(canvas, quality = 0.82) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/**
 * Photo ko lambi taraf se `max` tak chhota karo. HEIC jaisi file jo browser khol na paaye,
 * wo waise ki waisi chali jaati hai — poora bhejna, bhejne se mana kar dene se behtar hai.
 */
export async function shrinkImage(file, max = 1920) {
  try {
    const { img, url } = await loadImage(file);
    const big = Math.max(img.width, img.height);
    if (big <= max && file.size < 2 * MB) {
      URL.revokeObjectURL(url);
      return { blob: file, width: img.width, height: img.height };
    }
    const scale = Math.min(1, max / big);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await canvasToBlob(canvas);
    URL.revokeObjectURL(url);
    return blob ? { blob, width: w, height: h } : { blob: file, width: img.width, height: img.height };
  } catch {
    return { blob: file, width: 0, height: 0 };
  }
}

/** Chhoti jhalak (thumbnail) — chat me pehle yahi dikhti hai. */
export async function makeImageThumb(file, max = 320) {
  try {
    const { img, url } = await loadImage(file);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 0.7);
    URL.revokeObjectURL(url);
    return blob;
  } catch {
    return null;
  }
}

/**
 * Video ka pehla frame — ek chhupe hue <video> ko 0.1s par le jaakar canvas par utaar
 * lete hain.
 *
 * Har video se nahi banega (HEVC, .mkv, ya koi bhi codec jo browser decode na kar paaye)
 * — aur wo theek hai: aise me thumbnail chhod dete hain aur ek saada icon dikhta hai.
 * Thumbnail na banne se poora bhejna fail nahi hona chahiye.
 */
export async function makeVideoThumb(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let done = false;
    const finish = (out) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(out);
    };
    // Kabhi-kabhi `seeked` aata hi nahi — 6 second baad haar maan lo.
    const timer = setTimeout(() => finish({ blob: null, width: 0, height: 0, durationSec: 0 }), 6000);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => { try { video.currentTime = 0.1; } catch { /* ignore */ } };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          clearTimeout(timer);
          finish({ blob, width: video.videoWidth, height: video.videoHeight, durationSec: Math.round(video.duration) || 0 });
        }, 'image/jpeg', 0.7);
      } catch {
        clearTimeout(timer);
        finish({ blob: null, width: 0, height: 0, durationSec: 0 });
      }
    };
    video.onerror = () => { clearTimeout(timer); finish({ blob: null, width: 0, height: 0, durationSec: 0 }); };
    video.src = url;
  });
}

/**
 * Presigned POST par ek blob chadhao, progress ke saath.
 *
 * XHR isliye ki `fetch` upload ka progress nahi deta. Lautaya hua `abort` cancel ke liye
 * hai — bada video bhejte waqt cancel na hona sabse chidhane wali cheez hoti hai.
 */
export function uploadToS3({ url, fields }, blob, { onProgress } = {}) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    const form = new FormData();
    Object.entries(fields || {}).forEach(([k, v]) => form.append(k, v));
    // File hamesha AAKHIR me — S3 ka presigned POST isi kram ki maang karta hai.
    form.append('file', blob);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Storage rejected the upload (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onabort = () => reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    xhr.open('POST', url);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
