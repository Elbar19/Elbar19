// ניתוח תמונת החדר בדפדפן: צבעים דומיננטיים (k-means), בהירות, חום/קור,
// והדמיית "אחרי" שממפה את גווני התמונה לפלטת הסגנון הנבחר.

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('לא ניתן לטעון את התמונה'));
    img.src = url;
  });
}

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function sample(img, max = 160) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

function kmeans(px, k = 5, iters = 10) {
  const n = px.length / 3;
  let cents = [];
  for (let i = 0; i < k; i++) {
    const j = Math.floor(((i + 0.5) / k) * n) * 3;
    cents.push([px[j], px[j + 1], px[j + 2]]);
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = px[i * 3] - cents[c][0], dg = px[i * 3 + 1] - cents[c][1], db = px[i * 3 + 2] - cents[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best;
    }
    const sums = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]];
      s[0] += px[i * 3]; s[1] += px[i * 3 + 1]; s[2] += px[i * 3 + 2]; s[3]++;
    }
    cents = sums.map((s, c) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cents[c]));
  }
  const counts = new Array(k).fill(0);
  for (let i = 0; i < n; i++) counts[assign[i]]++;
  return cents
    .map((c, i) => ({ rgb: c, hex: rgbToHex(...c), share: counts[i] / n }))
    .filter((c) => c.share > 0.02)
    .sort((a, b) => b.share - a.share);
}

export function analyzePhoto(img) {
  const data = sample(img);
  const px = [];
  let L = 0, warm = 0, sat = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    px.push(r, g, b);
    L += lum(r, g, b);
    warm += r - b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx ? (mx - mn) / mx : 0;
    n++;
  }
  const brightness = L / n / 255;     // 0..1
  const warmth = warm / n / 255;      // שלילי = קר, חיובי = חם
  const saturation = sat / n;         // 0..1
  const colors = kmeans(px, 6);
  return {
    brightness, warmth, saturation, colors,
    brightLabel: brightness < 0.35 ? 'חשוך' : brightness < 0.55 ? 'בינוני' : 'מואר',
    warmLabel: warmth > 0.08 ? 'חם' : warmth < -0.02 ? 'קר' : 'ניטרלי',
    satLabel: saturation > 0.35 ? 'צבעוני' : saturation > 0.18 ? 'מאופק' : 'מונוכרומטי',
  };
}

export function drawBefore(canvas, img, maxW = 900) {
  const s = Math.min(1, maxW / img.width);
  canvas.width = Math.round(img.width * s);
  canvas.height = Math.round(img.height * s);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
}

// מיפוי טונאלי: צללים -> כהה של הסגנון, אמצע -> גוון ראשי, אור -> צבע קירות.
// מעורבב עם המקור כדי לשמור על פרטים ומרקמים.
export function drawStyled(canvas, img, tone, strength = 0.6, maxW = 900) {
  drawBefore(canvas, img, maxW);
  const ctx = canvas.getContext('2d');
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = im.data;
  const [c0, c1, c2] = tone.map(hexToRgb);
  for (let i = 0; i < d.length; i += 4) {
    const t = lum(d[i], d[i + 1], d[i + 2]) / 255;
    let r, g, b;
    if (t < 0.5) {
      const u = t / 0.5;
      r = c0[0] + (c1[0] - c0[0]) * u; g = c0[1] + (c1[1] - c0[1]) * u; b = c0[2] + (c1[2] - c0[2]) * u;
    } else {
      const u = (t - 0.5) / 0.5;
      r = c1[0] + (c2[0] - c1[0]) * u; g = c1[1] + (c2[1] - c1[1]) * u; b = c1[2] + (c2[2] - c1[2]) * u;
    }
    d[i] = d[i] * (1 - strength) + r * strength;
    d[i + 1] = d[i + 1] * (1 - strength) + g * strength;
    d[i + 2] = d[i + 2] * (1 - strength) + b * strength;
  }
  ctx.putImageData(im, 0, 0);
  // הארה עדינה (וינייטה הפוכה) לתחושת "חדר מעוצב"
  const grd = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.width * 0.1,
    canvas.width / 2, canvas.height / 2, canvas.width * 0.75);
  grd.addColorStop(0, 'rgba(255,245,230,0.10)');
  grd.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// הכנת התמונה לשליחה ל-Claude: JPEG מוקטן ב-base64
export function imageToBase64Jpeg(img, maxSide = 1568) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}
