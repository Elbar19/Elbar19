// הדמיה תלת-ממדית (איזומטרית) של החדר המתוכנן, מצוירת על canvas ישירות מתוכנית ההעמדה.
// המבט הוא מהפינה הימנית-תחתונה של התוכנית אל הפינה השמאלית-עליונה,
// כך שהקירות העליון והשמאלי בתוכנית הם הקירות הנראים.

const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);

function shade(hex, f) {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = n.map((v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)));
  return `rgb(${out.join(',')})`;
}

// גבהים בס"מ לכל סוג פריט
function heightOf(p) {
  if (p.soft) return 1;
  if (p.id === 'coffee' || p.id === 'side') return p.id === 'coffee' ? 42 : 55;
  if (p.id.startsWith('ns')) return 55;
  if (p.id === 'tv') return 50;
  if (p.id === 'toys' || p.id === 'cabinet') return 75;
  if (p.id === 'dresser' || p.id === 'buffet') return 85;
  if (p.tall) return p.id === 'wardrobe' ? 220 : 190;
  switch (p.cat) {
    case 'table': return 75;
    case 'desk': return 75;
    case 'storage': return 80;
    case 'light': return 160;
    case 'plant': return 130;
    default: return 80;
  }
}

export function render3D(canvas, { W, H, Hc, plan, openings, style, itemFill }) {
  const ctx = canvas.getContext('2d');
  const cssW = canvas.clientWidth || 800;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // גבולות ההטלה
  const proj0 = (x, y, z) => [(x - y) * COS, (x + y) * SIN - z];
  const corners = [[0, 0, 0], [W, 0, 0], [0, H, 0], [W, H, 0], [0, 0, Hc], [W, 0, Hc], [0, H, Hc]];
  const pts = corners.map((c) => proj0(...c));
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  const margin = 16;
  const s = (cssW - margin * 2) / (maxX - minX);
  const cssH = Math.round((maxY - minY) * s + margin * 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const P = (x, y, z) => {
    const [a, b] = proj0(x, y, z);
    return [margin + (a - minX) * s, margin + (b - minY) * s];
  };
  const poly = (points, fill, stroke = 'rgba(0,0,0,.18)') => {
    ctx.beginPath();
    points.forEach(([x, y, z], i) => { const [u, v] = P(x, y, z); i ? ctx.lineTo(u, v) : ctx.moveTo(u, v); });
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  };
  const box = (x, y, z, w, h, ht, color) => {
    if (w <= 0 || h <= 0 || ht <= 0) return;
    poly([[x, y + h, z], [x + w, y + h, z], [x + w, y + h, z + ht], [x, y + h, z + ht]], shade(color, -0.12));
    poly([[x + w, y, z], [x + w, y + h, z], [x + w, y + h, z + ht], [x + w, y, z + ht]], shade(color, -0.28));
    poly([[x, y, z + ht], [x + w, y, z + ht], [x + w, y + h, z + ht], [x, y + h, z + ht]], shade(color, 0.08));
  };

  const wallC = style.colors[0].hex;
  const floorC = style.colors[1].hex;

  // רצפה + קווי פרקט
  poly([[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]], floorC, null);
  ctx.strokeStyle = 'rgba(0,0,0,.07)';
  ctx.lineWidth = 1;
  for (let y = 20; y < H; y += 20) {
    const [a, b] = P(0, y, 0), [c, d] = P(W, y, 0);
    ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
  }

  // קירות אחוריים
  poly([[0, 0, 0], [W, 0, 0], [W, 0, Hc], [0, 0, Hc]], shade(wallC, -0.04));
  poly([[0, 0, 0], [0, H, 0], [0, H, Hc], [0, 0, Hc]], shade(wallC, -0.13));
  // פנל הדגשה עדין בקיר העליון
  poly([[0, 0, 0], [W, 0, 0], [W, 0, 10], [0, 0, 10]], shade(wallC, -0.25), null);
  poly([[0, 0, 0], [0, H, 0], [0, H, 10], [0, 0, 10]], shade(wallC, -0.32), null);

  // פתחים בקירות האחוריים
  const opening = (o, z0, z1, fill, frame) => {
    if (!o) return;
    if (o.wall === 'top') {
      poly([[o.start, 0, z0], [o.end, 0, z0], [o.end, 0, z1], [o.start, 0, z1]], fill, frame);
    } else if (o.wall === 'left') {
      poly([[0, o.start, z0], [0, o.end, z0], [0, o.end, z1], [0, o.start, z1]], fill, frame);
    } else {
      // פתח בקיר קדמי (לא מצויר) — סימון על קו הרצפה
      const t = 6;
      const r = o.wall === 'bottom'
        ? [[o.start, H - t, 0], [o.end, H - t, 0], [o.end, H, 0], [o.start, H, 0]]
        : [[W - t, o.start, 0], [W, o.start, 0], [W, o.end, 0], [W - t, o.end, 0]];
      poly(r, fill, null);
    }
  };
  if (openings.window) {
    const z1 = Math.min(Hc - 25, 215);
    opening(openings.window, 90, z1, '#BFE0F5', '#ffffff');
    // וילון שקוף משני הצדדים
    const o = openings.window;
    if (o.wall === 'top' || o.wall === 'left') {
      const c = 'rgba(255,255,255,.55)';
      const k = 22;
      if (o.wall === 'top') {
        poly([[o.start - k, 1, 0], [o.start + 6, 1, 0], [o.start + 6, 1, Hc - 8], [o.start - k, 1, Hc - 8]], c, null);
        poly([[o.end - 6, 1, 0], [o.end + k, 1, 0], [o.end + k, 1, Hc - 8], [o.end - 6, 1, Hc - 8]], c, null);
      } else {
        poly([[1, o.start - k, 0], [1, o.start + 6, 0], [1, o.start + 6, Hc - 8], [1, o.start - k, Hc - 8]], c, null);
        poly([[1, o.end - 6, 0], [1, o.end + k, 0], [1, o.end + k, Hc - 8], [1, o.end - 6, Hc - 8]], c, null);
      }
    }
  }
  opening(openings.door, 0, 210, shade(style.colors[4]?.hex || '#8a6a4f', 0.15), 'rgba(0,0,0,.35)');

  // פריטים
  const items = plan.placed.map((p) => ({
    ...p,
    r: { x: p.rect.x + (p.dx || 0), y: p.rect.y + (p.dy || 0), w: p.rect.w, h: p.rect.h },
  }));
  const table = items.find((p) => p.id === 'table');

  // שטיחים ראשונים, על הרצפה
  for (const p of items.filter((q) => q.soft)) {
    const { x, y, w, h } = p.r;
    poly([[x, y, 0.5], [x + w, y, 0.5], [x + w, y + h, 0.5], [x, y + h, 0.5]], shade(itemFill(p), 0.15), 'rgba(0,0,0,.12)');
    poly([[x + 12, y + 12, 0.6], [x + w - 12, y + 12, 0.6], [x + w - 12, y + h - 12, 0.6], [x + 12, y + h - 12, 0.6]], 'rgba(0,0,0,0)', 'rgba(255,255,255,.35)');
  }

  // מיון לפי עומק (רחוק -> קרוב)
  const solid = items.filter((q) => !q.soft).sort((a, b) => (a.r.x + a.r.y + (a.r.w + a.r.h) / 2) - (b.r.x + b.r.y + (b.r.w + b.r.h) / 2));

  // צל רך מתחת לכל פריט
  for (const p of solid) {
    const { x, y, w, h } = p.r;
    poly([[x + 4, y + 4, 0.3], [x + w + 6, y + 4, 0.3], [x + w + 6, y + h + 6, 0.3], [x + 4, y + h + 6, 0.3]], 'rgba(0,0,0,.10)', null);
  }

  for (const p of solid) {
    const { x, y, w, h } = p.r;
    const c = itemFill(p);
    const ht = heightOf(p);
    // פריטים גבוהים ליד הקירות הקדמיים (שלא מצוירים) מוסתרים חלקית כדי לא לחסום את המבט לחדר
    const front = !p.group && (p.wall === 'bottom' || p.wall === 'right');
    ctx.globalAlpha = front && (ht >= 100 || p.cat === 'bed' || p.cat === 'sofa') ? 0.55 : 1;
    // צד הגב: הקיר שהפריט צמוד אליו, ולכיסאות סביב שולחן — הצד הרחוק מהשולחן
    let back = p.wall;
    if (p.group && table) {
      const dx = x + w / 2 - (table.r.x + table.r.w / 2), dy = y + h / 2 - (table.r.y + table.r.h / 2);
      back = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
    }
    const backBox = (thick, height, color) => {
      if (back === 'top') box(x, y, 0, w, thick, height, color);
      if (back === 'bottom') box(x, y + h - thick, 0, w, thick, height, color);
      if (back === 'left') box(x, y, 0, thick, h, height, color);
      if (back === 'right') box(x + w - thick, y, 0, thick, h, height, color);
    };

    if (p.cat === 'sofa' || (p.cat === 'chair' && !p.group && p.id !== 'deskchair' && p.id !== 'bean')) {
      box(x, y, 0, w, h, 42, c);
      backBox(Math.min(22, Math.min(w, h) * 0.28), 82, shade(c, -0.05));
      // משענות יד
      if (back === 'top' || back === 'bottom') { box(x, y, 0, 14, h, 60, c); box(x + w - 14, y, 0, 14, h, 60, c); }
      else { box(x, y, 0, w, 14, 60, c); box(x, y + h - 14, 0, w, 14, 60, c); }
    } else if (p.cat === 'bed') {
      box(x, y, 0, w, h, 32, shade(c, -0.15));
      box(x + 4, y + 4, 32, w - 8, h - 8, 20, '#F4F1EC');
      // שמיכה בצבע הסגנון על החלק הקדמי
      const blanket = style.colors[3].hex;
      if (back === 'top') box(x + 3, y + h * 0.4, 33, w - 6, h * 0.6 - 3, 21, blanket);
      if (back === 'bottom') box(x + 3, y + 3, 33, w - 6, h * 0.6 - 3, 21, blanket);
      if (back === 'left') box(x + w * 0.4, y + 3, 33, w * 0.6 - 3, h - 6, 21, blanket);
      if (back === 'right') box(x + 3, y + 3, 33, w * 0.6 - 3, h - 6, 21, blanket);
      backBox(10, 110, c);
    } else if (p.cat === 'table' || p.cat === 'desk') {
      const leg = 5, top = 4;
      box(x, y, 0, leg, leg, ht - top, '#3a3530');
      box(x + w - leg, y, 0, leg, leg, ht - top, '#3a3530');
      box(x, y + h - leg, 0, leg, leg, ht - top, '#3a3530');
      box(x + w - leg, y + h - leg, 0, leg, leg, ht - top, '#3a3530');
      box(x, y, ht - top, w, h, top, c);
    } else if (p.cat === 'chair') {
      // כיסא אוכל / כיסא כתיבה / פוף
      if (p.id === 'bean') { box(x + 5, y + 5, 0, w - 10, h - 10, 40, c); ctx.globalAlpha = 1; continue; }
      box(x + 3, y + 3, 0, w - 6, h - 6, 45, c);
      backBox(6, 88, shade(c, -0.1));
    } else if (p.cat === 'plant') {
      const pw = Math.min(w, h) * 0.6;
      box(x + (w - pw) / 2, y + (h - pw) / 2, 0, pw, pw, 38, '#8C7B6B');
      const [u, v] = P(x + w / 2, y + h / 2, 38 + 45);
      ctx.beginPath();
      ctx.ellipse(u, v, w * s * 0.75, w * s * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#6E9461'; ctx.fill();
      ctx.beginPath();
      ctx.ellipse(u - w * s * 0.2, v - w * s * 0.25, w * s * 0.4, w * s * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#8DB47E'; ctx.fill();
    } else if (p.cat === 'light') {
      box(x + w / 2 - 2, y + h / 2 - 2, 0, 4, 4, 150, '#2b2b2b');
      box(x + 4, y + 4, 140, w - 8, h - 8, 26, '#F7EBD3');
      const [u, v] = P(x + w / 2, y + h / 2, 150);
      const g = ctx.createRadialGradient(u, v, 2, u, v, 90 * s * 2);
      g.addColorStop(0, 'rgba(255,220,150,.35)'); g.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(u, v, 90 * s * 2, 0, Math.PI * 2); ctx.fill();
    } else {
      box(x, y, 0, w, h, ht, c);
      // קווי חזית לארונות
      if (p.cat === 'storage' && ht > 60) {
        const n = Math.max(2, Math.round((back === 'top' || back === 'bottom' ? w : h) / 50));
        ctx.strokeStyle = 'rgba(0,0,0,.25)';
        for (let i = 1; i < n; i++) {
          let a, b2;
          if (back === 'top') { a = P(x + (w * i) / n, y + h, 4); b2 = P(x + (w * i) / n, y + h, ht - 4); }
          else if (back === 'left') { a = P(x + w, y + (h * i) / n, 4); b2 = P(x + w, y + (h * i) / n, ht - 4); }
          else continue; // החזית פונה הרחק מהצופה
          ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b2); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
