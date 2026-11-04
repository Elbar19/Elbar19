import { STYLES, ROOMS, ITEM_COLORS } from './data.js';
import { planLayout, buildOpenings } from './layout.js';
import { loadImage, analyzePhoto, drawBefore, drawStyled, imageToBase64Jpeg } from './photo.js';
import { fitBudget, priceAt, tierName, BUDGET_PRESETS } from './pricing.js';
import { render3D } from './render3d.js';
import { initChat } from './chat.js';

const $ = (id) => document.getElementById(id);
const ICONS = { sofa: '🛋️', bed: '🛏️', chair: '🪑', table: '▭', storage: '🗄️', desk: '💻', soft: '', light: '💡', plant: '🪴' };
const fmt = (n) => '₪' + Math.round(n).toLocaleString('he-IL');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PAD = 40;
let selectedStyle = 'scandinavian';
let photoImg = null;
let photoB64 = null;
let current = null; // העיצוב האחרון שהופק

// ---------- אתחול טופס ----------
for (const [key, r] of Object.entries(ROOMS)) {
  $('roomType').add(new Option(r.name, key));
}

function renderStyleCards() {
  $('styleGrid').innerHTML = Object.entries(STYLES).map(([key, s]) => `
    <button type="button" class="style-card" role="radio" data-style="${key}" aria-checked="${key === selectedStyle}">
      <span class="sw">${s.colors.map((c) => `<i style="background:${c.hex}"></i>`).join('')}</span>
      <b>${s.name}</b><small>${s.blurb}</small>
    </button>`).join('');
}
renderStyleCards();
$('styleGrid').addEventListener('click', (e) => {
  const card = e.target.closest('.style-card');
  if (!card) return;
  selectedStyle = card.dataset.style;
  renderStyleCards();
});

// ---------- מפתח API (משותף לטופס ולצ'אט) ----------
function getApiKey() {
  return ($('apiKey')?.value || $('chatKey')?.value || '').trim();
}
function setApiKey(key) {
  if ($('apiKey')) $('apiKey').value = key;
  if ($('chatKey')) $('chatKey').value = key;
  try { if (key) localStorage.setItem('anthropicKey', key); } catch { /* אחסון חסום */ }
}
try { setApiKey(localStorage.getItem('anthropicKey') || ''); } catch { /* אחסון חסום */ }
$('apiKey')?.addEventListener('change', () => setApiKey($('apiKey').value.trim()));

// ---------- טווח מחיר ----------
$('budgetPresets').innerHTML = BUDGET_PRESETS.map((b, i) =>
  `<button type="button" class="preset" data-i="${i}">${b.label}</button>`).join('');
function markPreset() {
  const min = +$('budgetMin').value, max = +$('budgetMax').value;
  document.querySelectorAll('.preset').forEach((el) => {
    const b = BUDGET_PRESETS[+el.dataset.i];
    el.setAttribute('aria-pressed', String(b.min === min && b.max === max));
  });
}
$('budgetPresets').addEventListener('click', (e) => {
  const el = e.target.closest('.preset');
  if (!el) return;
  const b = BUDGET_PRESETS[+el.dataset.i];
  $('budgetMin').value = b.min; $('budgetMax').value = b.max;
  markPreset();
});
$('budgetMin').addEventListener('input', markPreset);
$('budgetMax').addEventListener('input', markPreset);
markPreset();

// ---------- העלאת תמונה ----------
async function setPhoto(file) {
  if (!file || !file.type.startsWith('image/')) return;
  photoImg = await loadImage(file);
  photoB64 = null;
  $('photoPreview').src = photoImg.src;
  $('photoPreview').hidden = false;
  $('dropText').hidden = true;
}
$('photo').addEventListener('change', (e) => setPhoto(e.target.files[0]));
const dz = $('dropZone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => {
  e.preventDefault(); dz.classList.remove('over');
  setPhoto(e.dataTransfer.files[0]);
});

$('printBtn')?.addEventListener('click', () => window.print());

// ---------- הפקת עיצוב ----------
function readForm() {
  let min = Math.max(0, +$('budgetMin').value || 0), max = Math.max(0, +$('budgetMax').value || 0);
  if (min > max) [min, max] = [max, min];
  if (max === 0) max = 30000;
  return {
    room: {
      length: +$('length').value, width: +$('width').value, height: +$('height').value,
      type: $('roomType').value,
      doorWall: $('doorWall').value, windowWall: $('windowWall').value,
    },
    styleKey: selectedStyle,
    budgetMin: min, budgetMax: max,
  };
}

$('roomForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('roomForm').reportValidity()) return;
  runDesign(readForm());
  showResults();
  await maybeRunAi();
});

function showResults() {
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// מפיק את העיצוב ומציג אותו. משמש גם את הטופס וגם את נציגת ה-AI.
function runDesign({ room, styleKey, budgetMin, budgetMax, clientSummary = '' }) {
  selectedStyle = styleKey;
  const style = STYLES[styleKey];
  const roomDef = ROOMS[room.type];
  const W = Math.round(room.length * 100), H = Math.round(room.width * 100);

  const openings = buildOpenings(W, H, room.doorWall, room.windowWall);
  const plan = planLayout({ W, H }, roomDef.items, openings);
  const pricing = priceDesign(plan, style, room, budgetMin, budgetMax);
  const photo = photoImg ? analyzePhoto(photoImg) : null;

  current = { room, style, styleKey, roomDef, plan, openings, W, H, pricing, budgetMin, budgetMax, clientSummary };

  $('results').hidden = false;
  $('drawFigure').hidden = true;
  $('drawStatus').textContent = '';
  renderHeader(room, style, roomDef, plan);
  renderBudget(pricing, budgetMin, budgetMax);
  $('clientSummary').hidden = !clientSummary;
  $('clientSummary').textContent = clientSummary;
  renderPhoto(photo, style);
  renderPalette(style, photo);
  renderFloorplan(W, H, plan, openings, style);
  draw3D();
  renderItems(pricing);
  renderDetails(style);
  renderTips(room, style, plan, photo, openings, pricing);
  $('aiPanel').hidden = true;

  return {
    room_type: roomDef.name,
    style: style.name,
    placed_items: pricing.rows.filter((r) => r.item).map((r) => `${r.name} (${r.dims} ס"מ, ${fmt(r.price)})`),
    did_not_fit: plan.skipped.map((s) => s.name),
    removed_for_budget: pricing.removed,
    finish_level: tierName(pricing.t),
    estimated_total_ils: Math.round(pricing.total),
    budget_range_ils: [budgetMin, budgetMax],
    budget_status: pricing.status,
    free_floor_percent: plan.freePct,
    palette: style.colors.map((c) => `${c.role}: ${c.name} ${c.hex}`),
  };
}

// בונה את שורות רשימת הקניות ומתאים את רמת הגימור לטווח המחיר.
// אם גם הגרסה הזולה ביותר יקרה מדי, מוותרים על פריטים לא הכרחיים (מהפחות חשוב).
function priceDesign(plan, style, room, min, max) {
  const paintL = Math.ceil((2 * (room.length + room.width) * room.height - 3) / 10 * 1.1);
  const extras = [
    { name: `צבע לקירות (${paintL} ל')`, dims: '—', hint: `${style.colors[0].name} ${style.colors[0].hex}`, price: [35 * paintL, 60 * paintL, 110 * paintL], qty: 1 },
    { name: 'גופי תאורה', dims: '—', hint: style.lighting[0], price: [400, 1200, 4000], qty: 1 },
    { name: 'טקסטיל ואקססוריז', dims: '—', hint: style.decor.slice(0, 2).join(', '), price: [400, 1200, 3500], qty: 1 },
  ];

  const buildLines = () => {
    const lines = [];
    const seen = new Set();
    for (const p of plan.placed) {
      const key = p.group || p.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const qty = p.group ? plan.placed.filter((q) => q.group === p.group).length : 1;
      const mult = p.compact ? 0.8 : 1;
      lines.push({
        item: key, prio: p.prio,
        name: p.group ? `${p.name} ×${qty}` : p.name,
        dims: `${p.w}×${p.d}`,
        hint: style.hints[p.cat] || (p.cat === 'light' ? style.lighting[1] : style.materials[0]),
        price: p.price.map((v) => v * mult), qty,
      });
    }
    return lines.concat(extras);
  };

  const removed = [];
  let lines = buildLines();
  let fit = fitBudget(lines, min, max);
  while (fit.status === 'over') {
    const optional = lines.filter((l) => l.item && l.prio >= 4).sort((a, b) => b.prio - a.prio)[0];
    if (!optional) break;
    removed.push(optional.name);
    plan.placed = plan.placed.filter((p) => (p.group || p.id) !== optional.item);
    lines = buildLines();
    fit = fitBudget(lines, min, max);
  }
  const rows = lines.map((l) => ({ ...l, price: priceAt(l.price, fit.t) * l.qty }));
  return { rows, total: fit.total, t: fit.t, status: fit.status, removed };
}

function renderBudget(pricing, min, max) {
  const el = $('budgetStatus');
  const range = `${fmt(min)}–${fmt(max)}`;
  const level = `רמת גימור: <b>${tierName(pricing.t)}</b>`;
  if (pricing.status === 'over') {
    el.className = 'budget-status warn';
    el.innerHTML = `⚠️ גם בגרסה החסכונית ביותר העיצוב עולה ${fmt(pricing.total)}, מעל הטווח (${range}). ` +
      (pricing.removed.length ? `ויתרנו על: ${esc(pricing.removed.join(', '))}. ` : '') +
      'אפשר להרחיב את התקציב או לשמור רהיטים קיימים.';
  } else if (pricing.status === 'under') {
    el.className = 'budget-status ok';
    el.innerHTML = `✓ ${level}. גם ברמה הגבוהה ביותר העיצוב עולה ${fmt(pricing.total)}, מתחת לטווח (${range}). נשאר לכם מקום לפריטי אמנות או לרהיטים בהזמנה אישית.`;
  } else {
    el.className = 'budget-status ok';
    el.innerHTML = `✓ ${level} · סה"כ משוער ${fmt(pricing.total)}, בתוך הטווח ${range}` +
      (pricing.removed.length ? ` (ויתרנו על: ${esc(pricing.removed.join(', '))})` : '');
  }
}

function draw3D() {
  if (!current) return;
  const { W, H, room, plan, openings, style } = current;
  render3D($('view3d'), { W, H, Hc: Math.round(room.height * 100), plan, openings, style, itemFill: (p) => itemFill(style, p) });
}
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw3D, 150); });

function renderHeader(room, style, roomDef, plan) {
  const area = room.length * room.width;
  const volume = area * room.height;
  $('resTitle').textContent = `${roomDef.name} בסגנון ${style.name}`;
  $('resSummary').textContent = style.blurb;
  const stats = [
    [area.toFixed(1) + ' מ"ר', 'שטח'],
    [volume.toFixed(1) + ' מ"ק', 'נפח'],
    [plan.placed.filter((p) => !p.group || p.id.endsWith('_0')).length, 'פריטים בתוכנית'],
    [plan.freePct + '%', 'שטח רצפה פנוי'],
    [Math.ceil((2 * (room.length + room.width) * room.height - 3) / 10 * 1.1) + ' ל\'', 'צבע לקירות (2 שכבות)'],
  ];
  $('stats').innerHTML = stats.map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');
}

function renderPhoto(photo, style) {
  $('photoPanel').hidden = !photo;
  if (!photo) return;
  drawBefore($('beforeCanvas'), photoImg);
  drawStyled($('afterCanvas'), photoImg, style.tone);
  $('afterCaption').textContent = `הדמיית אווירה בסגנון ${style.name}`;
  $('photoInsights').innerHTML = `
    <span class="chip">תאורה: <b>${photo.brightLabel}</b></span>
    <span class="chip">גוון: <b>${photo.warmLabel}</b></span>
    <span class="chip">צבעוניות: <b>${photo.satLabel}</b></span>
    <span class="chip">הצבעים בחדר היום:
      ${photo.colors.map((c) => `<span class="dot" title="${c.hex}" style="background:${c.hex}"></span>`).join(' ')}
    </span>`;
}

function renderPalette(style) {
  $('palette').innerHTML = style.colors.map((c) => `
    <div class="swatch"><div class="c" style="background:${c.hex}"></div>
      <div class="t"><b>${c.role}</b>${c.name} · <code>${c.hex}</code></div></div>`).join('');
}

// ---------- תוכנית קומה (SVG) ----------
function itemFill(style, p) {
  const k = ITEM_COLORS[p.cat];
  if (k === 'plant') return '#7FA36B';
  return style.colors[k]?.hex || style.colors[2].hex;
}
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#222' : '#fff';
}

function renderFloorplan(W, H, plan, openings, style) {
  const pad = PAD, wallT = 12;
  const vbW = W + pad * 2, vbH = H + pad * 2;
  const fs = Math.max(11, Math.min(W, H) / 28);
  const floor = style.colors[1].hex;

  const seg = (o, thick, color) => {
    const { wall, start, end } = o;
    const L = end - start;
    if (wall === 'top') return `<rect x="${pad + start}" y="${pad - thick}" width="${L}" height="${thick}" style="fill:${color}"/>`;
    if (wall === 'bottom') return `<rect x="${pad + start}" y="${pad + H}" width="${L}" height="${thick}" style="fill:${color}"/>`;
    if (wall === 'left') return `<rect x="${pad - thick}" y="${pad + start}" width="${thick}" height="${L}" style="fill:${color}"/>`;
    return `<rect x="${pad + W}" y="${pad + start}" width="${thick}" height="${L}" style="fill:${color}"/>`;
  };

  // קשת פתיחת הדלת
  const d = openings.door;
  let arc = '';
  {
    const s = d.start, L = d.end - d.start;
    const P = (x, y) => `${pad + x},${pad + y}`;
    if (d.wall === 'top') arc = `M${P(s, 0)} L${P(s, L)} A${L},${L} 0 0 0 ${P(s + L, 0)}`;
    if (d.wall === 'bottom') arc = `M${P(s, H)} L${P(s, H - L)} A${L},${L} 0 0 1 ${P(s + L, H)}`;
    if (d.wall === 'left') arc = `M${P(0, s)} L${P(L, s)} A${L},${L} 0 0 1 ${P(0, s + L)}`;
    if (d.wall === 'right') arc = `M${P(W, s)} L${P(W - L, s)} A${L},${L} 0 0 0 ${P(W, s + L)}`;
  }

  const items = [...plan.placed].sort((a, b) => (b.soft ? 1 : 0) - (a.soft ? 1 : 0));
  const itemSvg = items.map((p, idx) => {
    const r = p.rect;
    const fill = itemFill(style, p);
    const showLabel = !p.group || p.id.endsWith('_0');
    const minSide = Math.min(r.w, r.h);
    const vertical = r.h > r.w * 1.4;
    const label = showLabel && minSide >= 35 ? p.name.replace(/\s*\(.*\)/, '') : '';
    const lf = Math.min(fs, ((vertical ? r.h : r.w) / Math.max(label.length, 1)) * 1.7, minSide * 0.45);
    // פס "גב" צמוד לקיר
    let back = '';
    if (!p.soft && ['sofa', 'bed', 'chair'].includes(p.cat) && !p.group) {
      const t = Math.min(18, minSide * 0.22);
      if (p.wall === 'top') back = `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${t}" rx="3" fill="#0003"/>`;
      if (p.wall === 'bottom') back = `<rect x="${r.x}" y="${r.y + r.h - t}" width="${r.w}" height="${t}" rx="3" fill="#0003"/>`;
      if (p.wall === 'left') back = `<rect x="${r.x}" y="${r.y}" width="${t}" height="${r.h}" rx="3" fill="#0003"/>`;
      if (p.wall === 'right') back = `<rect x="${r.x + r.w - t}" y="${r.y}" width="${t}" height="${r.h}" rx="3" fill="#0003"/>`;
    }
    const shape = p.cat === 'plant'
      ? `<circle cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" r="${minSide / 2}" fill="${fill}"/>`
      : `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${p.soft ? 8 : 5}"
           fill="${fill}" ${p.soft ? 'fill-opacity=".45" stroke-dasharray="6 5"' : ''} stroke="#0005" stroke-width="1.5"/>`;
    const icon = ICONS[p.cat] && minSide >= 45 && showLabel && !vertical
      ? `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2 - lf * 0.4}" text-anchor="middle" font-size="${Math.min(fs * 1.3, minSide / 2.6)}">${ICONS[p.cat]}</text>` : '';
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const txt = !label ? '' : vertical
      ? `<text x="${cx}" y="${cy + lf * 0.35}" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})"
           font-size="${lf}" fill="${p.soft ? '#222' : textOn(fill)}" font-weight="600">${esc(label)}</text>`
      : `<text x="${cx}" y="${cy + (icon ? lf * 0.9 : lf * 0.35)}" text-anchor="middle"
           font-size="${lf}" fill="${p.soft ? '#222' : textOn(fill)}" font-weight="600">${esc(label)}</text>`;
    return `<g class="item" data-idx="${idx}" transform="translate(${pad},${pad})">${shape}${back}${icon}${txt}<title>${esc(p.name)} — ${p.w}×${p.d} ס"מ</title></g>`;
  }).join('');

  const dims = `
    <text x="${pad + W / 2}" y="${pad - 18}" text-anchor="middle" font-size="${fs}" style="fill:var(--muted)">${(W / 100).toFixed(2)} מ'</text>
    <text x="${pad - 18}" y="${pad + H / 2}" text-anchor="middle" font-size="${fs}" style="fill:var(--muted)"
      transform="rotate(-90 ${pad - 18} ${pad + H / 2})">${(H / 100).toFixed(2)} מ'</text>`;

  const svg = `
  <svg viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg" font-family="Rubik, Arial, sans-serif">
    <defs>
      <pattern id="planks" width="60" height="20" patternUnits="userSpaceOnUse">
        <rect width="60" height="20" fill="${floor}" fill-opacity=".35"/>
        <path d="M0 20H60M30 0V20" stroke="#0001" stroke-width="1"/>
      </pattern>
    </defs>
    <rect x="${pad}" y="${pad}" width="${W}" height="${H}" fill="url(#planks)"/>
    <rect x="${pad - wallT / 2}" y="${pad - wallT / 2}" width="${W + wallT}" height="${H + wallT}" fill="none" style="stroke:var(--wall)" stroke-width="${wallT}"/>
    ${openings.window ? seg(openings.window, wallT + 2, '#9ED0F0') : ''}
    ${seg({ ...d }, wallT + 2, 'var(--panel)')}
    <path d="${arc}" fill="none" stroke="#999" stroke-width="2" stroke-dasharray="5 4"/>
    ${dims}
    ${itemSvg}
  </svg>`;
  $('floorplan').innerHTML = svg;
  enableDrag($('floorplan').querySelector('svg'), items, W, H);
}

// גרירת פריטים בתוכנית
function enableDrag(svg, items, W, H) {
  let drag = null;
  const pt = (e) => {
    const p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  };
  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.item');
    if (!g) return;
    const it = items[+g.dataset.idx];
    const p = pt(e);
    drag = { g, it, sx: p.x, sy: p.y, ox: it.dx || 0, oy: it.dy || 0 };
    g.setPointerCapture(e.pointerId);
    svg.appendChild(g);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pt(e);
    const { it } = drag, r = it.rect;
    const bx = it.dx || 0, by = it.dy || 0;
    drag.ox = Math.max(-r.x, Math.min(W - r.x - r.w, bx + p.x - drag.sx));
    drag.oy = Math.max(-r.y, Math.min(H - r.y - r.h, by + p.y - drag.sy));
    drag.g.setAttribute('transform', `translate(${PAD + drag.ox},${PAD + drag.oy})`);
  });
  const end = () => {
    if (drag) { drag.it.dx = drag.ox; drag.it.dy = drag.oy; draw3D(); }
    drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

// ---------- רשימת פריטים ----------
function renderItems(pricing) {
  $('itemsBody').innerHTML = pricing.rows.map((r) =>
    `<tr><td>${esc(r.name)}</td><td>${r.dims}</td><td>${esc(r.hint)}</td><td>${fmt(r.price)}</td></tr>`).join('');
  $('total').textContent = fmt(pricing.total);
  const plan = current.plan;
  $('skipped').textContent = plan.skipped.length
    ? `לא נכנסו בחדר בלי לחסום מעברים: ${plan.skipped.map((s) => s.name).join(', ')}.`
    : '';
}

function renderDetails(style) {
  const block = (t, arr) => `<h4>${t}</h4><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  $('details').innerHTML =
    block('חומרים וגימורים', style.materials) +
    block('תאורה', style.lighting) +
    block('אקססוריז ודקור', style.decor);
}

// ---------- טיפים לפי מידות ותמונה ----------
function renderTips(room, style, plan, photo, openings, pricing) {
  const tips = [];
  const area = room.length * room.width;
  const ratio = Math.max(room.length, room.width) / Math.min(room.length, room.width);

  if (area < 10) tips.push('החדר קטן — העדיפו רהיטים על רגליים גבוהות ודקות, מראה גדולה וקיר אחד בגוון בהיר מאוד כדי להגדיל את התחושה.');
  else if (area > 25) tips.push('החדר גדול — חלקו אותו לאזורים (ישיבה, קריאה, אחסון) בעזרת שטיחים ותאורה נפרדת לכל אזור.');
  if (ratio > 1.6) tips.push('החדר מוארך — הציבו את הרהיט הגדול לאורך הקיר הארוך וצרו "עוגן" בקיר הקצר (מדף, תמונה גדולה) כדי לאזן את הפרופורציות.');
  if (room.height < 2.5) tips.push('תקרה נמוכה — וילונות מהתקרה עד הרצפה, צבע תקרה לבן נקי ותאורה שקועה ייצרו תחושת גובה.');
  if (room.height >= 2.9) tips.push('תקרה גבוהה — נצלו אותה למנורת תלייה גדולה או לספרייה גבוהה עד התקרה.');
  if (openings.window) tips.push('שמרו על מעבר אור פתוח מול החלון — וילון שקוף ביום ווילון האפלה בשכבה נוספת.');
  else tips.push('אין חלון — תכננו 3 שכבות תאורה (כללית, משימה, אווירה) ובחרו בגוונים בהירים וחמים.');
  if (plan.freePct < 45) tips.push(`רק ${plan.freePct}% מהרצפה פנויים — שקלו לוותר על פריט אחד או לבחור דגמים קומפקטיים.`);
  if (plan.skipped.length) tips.push(`כדי לשלב גם ${plan.skipped[0].name}, אפשר להחליף לגרסה צרה יותר או להשתמש באחסון תלוי על הקיר.`);

  if (photo) {
    if (photo.brightness < 0.4) tips.push('התמונה מראה חדר חשוך יחסית — בחרו את גוון הקירות הבהיר מהפלטה, הוסיפו מראה מול החלון ונורות 3000K.');
    if (photo.brightness > 0.7) tips.push('החדר מואר מאוד — אפשר להעז בקיר הדגשה בגוון ' + style.colors[3].name + '.');
    if (photo.warmLabel === 'קר' && ['scandinavian', 'boho', 'japandi', 'classic'].includes(selectedStyle))
      tips.push('האור בחדר נוטה לקר — כדי להגיע לתחושה החמה של הסגנון, הוסיפו עץ, טקסטיל ונורות בגוון חם.');
    if (photo.warmLabel === 'חם' && ['modern', 'minimalist'].includes(selectedStyle))
      tips.push('החדר היום בגוונים חמים — איזון עם אפורים ולבן קר יעזור להגיע למראה ' + style.name + ' נקי.');
    if (photo.satLabel === 'צבעוני' && selectedStyle === 'minimalist')
      tips.push('יש היום הרבה צבעים בחדר — מינימליזם מתחיל מצמצום: הוציאו חפצים צבעוניים והשאירו 2–3 גוונים בלבד.');
  }
  if (pricing.status === 'over') tips.push('התקציב צפוף: התחילו מהפריטים החשובים (ספה / מיטה, תאורה וצבע), וחפשו יד שנייה לפריטי עץ ומתכת שמחזיקים מעמד.');
  tips.push(`כלל ה-60/30/10: כ-60% ${style.colors[0].name}, 30% ${style.colors[2].name}, ו-10% ${style.colors[3].name} כצבע הדגשה.`);
  $('tips').innerHTML = tips.map((t) => `<li>${esc(t)}</li>`).join('');
}

// ---------- Claude (אופציונלי) ----------
function getPhotoB64() {
  if (!photoImg) return null;
  if (!photoB64) photoB64 = imageToBase64Jpeg(photoImg);
  return photoB64;
}
const budgetText = () => `${fmt(current.budgetMin)}–${fmt(current.budgetMax)}`;

async function maybeRunAi() {
  const key = getApiKey();
  const use = !!$('useAi')?.checked;
  if (!use || !current) { $('aiPanel').hidden = true; return; }
  $('aiPanel').hidden = false;
  if (!key) { $('aiContent').innerHTML = '<p class="err">כדי להשתמש בניתוח AI יש להזין מפתח API.</p>'; return; }
  if (!photoImg) { $('aiContent').innerHTML = '<p class="err">כדי לנתח עם AI יש להעלות תמונה של החדר.</p>'; return; }
  setApiKey(key);

  const { room, style, roomDef } = current;
  const btn = document.querySelector('#roomForm .primary');
  btn.disabled = true;
  $('aiContent').innerHTML = '<p class="muted">Claude מנתח את התמונה… (עשוי לקחת עד דקה)</p>';
  try {
    const { analyzeWithClaude } = await import('./ai.js');
    const r = await analyzeWithClaude({
      apiKey: key, imageB64: getPhotoB64(),
      room, styleName: style.name, roomTypeName: roomDef.name, budgetText: budgetText(),
    });
    const list = (t, a) => (a?.length ? `<h4>${t}</h4><ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    $('aiContent').innerHTML =
      list('מה רואים בחדר', r.observations) +
      list('מה להשאיר', r.keep) +
      list('מה לשנות / להוסיף', r.change) +
      list('העמדה', r.layout_tips) +
      (r.color_plan ? `<h4>תוכנית צבע</h4><p>${esc(r.color_plan)}</p>` : '') +
      list('3 צעדים ראשונים', r.first_steps);
  } catch (err) {
    $('aiContent').innerHTML = `<p class="err">שגיאה בניתוח: ${esc(err.message || err)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

// ---------- ציור החדר עם Claude ----------
const WALL_HE = { top: 'עליון', bottom: 'תחתון', left: 'שמאלי', right: 'ימני' };
function designForDrawing() {
  const { room, style, roomDef, plan, openings, W, H } = current;
  const seen = new Set();
  return {
    room: roomDef.name, style: style.name, style_description: style.blurb,
    size_cm: { length_x: W, width_y: H, ceiling: Math.round(room.height * 100) },
    door: { wall: openings.door.wall, from_cm: Math.round(openings.door.start), to_cm: Math.round(openings.door.end) },
    window: openings.window ? { wall: openings.window.wall, from_cm: Math.round(openings.window.start), to_cm: Math.round(openings.window.end) } : 'none',
    palette: style.colors.map((c) => ({ role: c.role, name: c.name, hex: c.hex })),
    materials: style.materials, lighting: style.lighting, decor: style.decor,
    furniture: plan.placed.filter((p) => {
      const k = p.group || p.id; if (seen.has(k)) return false; seen.add(k); return true;
    }).map((p) => ({
      item: p.name, size_cm: `${p.w}x${p.d}`, against_wall: p.group ? 'around the dining table' : p.wall,
      x_cm: Math.round(p.rect.x + (p.dx || 0)), y_cm: Math.round(p.rect.y + (p.dy || 0)),
      look: style.hints[p.cat] || '',
      count: p.group ? plan.placed.filter((q) => q.group === p.group).length : 1,
    })),
  };
}

$('drawBtn')?.addEventListener('click', async () => {
  if (!current) return;
  const key = getApiKey();
  if (!key) {
    $('drawStatus').textContent = 'כדי ש-Claude יצייר את החדר צריך מפתח API. פתחו את החלק "Claude" בטופס והדביקו אותו.';
    document.querySelector('details.ai')?.setAttribute('open', '');
    return;
  }
  const btn = $('drawBtn');
  btn.disabled = true;
  $('drawFigure').hidden = true;
  $('drawStatus').textContent = 'Claude מצייר את החדר… זה יכול לקחת כמה דקות.';
  try {
    const { drawRoomWithClaude } = await import('./ai.js');
    const { svg, caption } = await drawRoomWithClaude({ apiKey: key, imageB64: getPhotoB64(), design: designForDrawing() });
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    $('drawImg').src = url;
    $('drawDownload').href = url;
    $('drawCaption').textContent = caption;
    $('drawFigure').hidden = false;
    $('drawStatus').textContent = 'זהו איור שמבוסס על תוכנית העיצוב. הוא לא צילום, ולכן הפרטים בו משוערים.';
  } catch (err) {
    $('drawStatus').textContent = `לא הצלחתי לצייר: ${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- נציגת AI ----------
const WINDOW_MAP = { opposite_door: 'top', right_of_door: 'right', left_of_door: 'left', same_wall_as_door: 'bottom', none: 'none' };
if ($('chatPanel')) {
  initChat({
    getApiKey, setApiKey,
    hasPhoto: () => !!photoImg,
    getPhotoB64,
    setPhoto,
    showResults,
    runDesign: (inp) => {
      // מעדכנים גם את הטופס, כדי שהמשתמש יוכל להמשיך לשנות ידנית
      $('roomType').value = inp.room_type;
      $('length').value = inp.length_m; $('width').value = inp.width_m; $('height').value = inp.height_m;
      $('doorWall').value = 'bottom'; $('windowWall').value = WINDOW_MAP[inp.window_position];
      $('budgetMin').value = inp.budget_min; $('budgetMax').value = inp.budget_max;
      markPreset();
      selectedStyle = inp.style;
      renderStyleCards();
      return runDesign({ ...readForm(), clientSummary: inp.client_summary });
    },
  });
}
