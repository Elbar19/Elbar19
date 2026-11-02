// אלגוריתם העמדה: מציב רהיטים בחדר מלבני לפי כללים פשוטים
// (צמוד לקיר, פינה, ליד/מול פריט אחר, מרכז), עם בדיקת התנגשויות ומרווחי מעבר.
// מערכת צירים בס"מ: x לאורך האורך (W), y לאורך הרוחב (H). 0,0 = פינה שמאלית-עליונה במבט על.

const OPP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const DOOR_W = 90;
const STEP = 5;

const overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const area = (r) => r.w * r.h;

function wallLength(wall, W, H) {
  return wall === 'top' || wall === 'bottom' ? W : H;
}

// מלבן של פריט הצמוד לקיר במיקום t לאורך הקיר
function wallRect(wall, t, w, d, W, H) {
  switch (wall) {
    case 'top': return { x: t, y: 0, w, h: d };
    case 'bottom': return { x: t, y: H - d, w, h: d };
    case 'left': return { x: 0, y: t, w: d, h: w };
    case 'right': return { x: W - d, y: t, w: d, h: w };
  }
}

// אזור המעבר שלפני הפריט (בכיוון הפנים של החדר)
function frontRect(r, wall, clear) {
  if (!clear) return null;
  switch (wall) {
    case 'top': return { x: r.x, y: r.y + r.h, w: r.w, h: clear };
    case 'bottom': return { x: r.x, y: r.y - clear, w: r.w, h: clear };
    case 'left': return { x: r.x + r.w, y: r.y, w: clear, h: r.h };
    case 'right': return { x: r.x - clear, y: r.y, w: clear, h: r.h };
    default: return null;
  }
}

// מקטע (התחלה, סוף) של פריט לאורך הקיר שלו
function segOnWall(r, wall) {
  return wall === 'top' || wall === 'bottom' ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
}

function inside(r, W, H) {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 0.01 && r.y + r.h <= H + 0.01;
}

export function buildOpenings(W, H, doorWall, windowWall) {
  const dLen = wallLength(doorWall, W, H);
  const dStart = Math.max(10, Math.min(25, dLen - DOOR_W - 10));
  const door = { wall: doorWall, start: dStart, end: dStart + DOOR_W };
  // אזור סיבוב הדלת — אסור להציב בו רהיטים
  door.zone = wallRect(doorWall, dStart, DOOR_W, DOOR_W, W, H);

  let windowO = null;
  if (windowWall !== 'none') {
    const len = wallLength(windowWall, W, H);
    const ww = Math.min(180, Math.round(len * 0.45));
    let s = (len - ww) / 2;
    // אם החלון באותו קיר כמו הדלת — הזזה הרחק מהדלת
    if (windowWall === doorWall) s = Math.max(s, door.end + 30);
    if (s + ww > len - 10) s = len - 10 - ww;
    windowO = { wall: windowWall, start: s, end: s + ww };
  }
  return { door, window: windowO };
}

export function planLayout(room, items, openings) {
  const { W, H } = room;
  const placed = [];
  const skipped = [];
  const byId = {};

  const blockers = [{ rect: openings.door.zone, id: '__door', solid: true }];

  const collides = (rect, clearRect, ignore = new Set(), ignoreClear = false) => {
    if (!inside(rect, W, H)) return true;
    for (const b of blockers) {
      // אזור מעבר יכול לחפוף לאזור הדלת (שניהם שטח הליכה), אבל רהיט לא
      if (overlap(rect, b.rect)) return true;
    }
    for (const p of placed) {
      if (p.soft || ignore.has(p.id)) continue;
      if (overlap(rect, p.rect)) return true;
      if (!ignoreClear && p.clearRect && overlap(rect, p.clearRect)) return true;
      if (clearRect && overlap(clearRect, p.rect)) return true;
    }
    return false;
  };

  const windowOverlap = (r, wall) => {
    const w = openings.window;
    if (!w || w.wall !== wall) return 0;
    const [a, b] = segOnWall(r, wall);
    return Math.max(0, Math.min(b, w.end) - Math.max(a, w.start));
  };

  function tryWall(it, w, d) {
    let best = null;
    for (const wall of ['top', 'bottom', 'left', 'right']) {
      const len = wallLength(wall, W, H);
      if (w > len) continue;
      for (let t = 0; t <= len - w; t += STEP) {
        const rect = wallRect(wall, t, w, d, W, H);
        const clr = frontRect(rect, wall, it.clear || 0);
        if (clr && !inside(clr, W, H)) continue;
        if (collides(rect, clr)) continue;
        // מקום שמור לפריטים שיוצבו לצד הפריט (למשל שידות לילה ליד המיטה)
        if (it.reserve) {
          if (t - it.reserve < 0 || t + w + it.reserve > len) continue;
          const wide = wallRect(wall, t - it.reserve, w + 2 * it.reserve, Math.min(d, 45), W, H);
          if (collides(wide, null)) continue;
        }
        const wo = windowOverlap(rect, wall);
        if (it.tall && wo > 0) continue;

        let score = 0;
        const mid = t + w / 2;
        const centered = 1 - Math.abs(mid - len / 2) / (len / 2);
        score += centered * (it.center ? 40 : 10);
        for (const p of it.pref || []) {
          if (p === 'notDoorWall' && wall === openings.door.wall) score -= 50;
          if (p === 'oppositeDoor' && wall === OPP[openings.door.wall]) score += 30;
          if (p === 'notWindow' && wo > 0) score -= 40;
          if (p === 'window') {
            if (wo > 0) score += 40 + (wo / w) * 30;
          }
          if (p.startsWith('oppositeOf:')) {
            const target = byId[p.split(':')[1]];
            if (target) {
              if (wall === OPP[target.wall]) {
                score += 70;
                const [ta, tb] = segOnWall(target.rect, target.wall);
                score -= Math.abs((ta + tb) / 2 - mid) / 4;
              } else if (wall === target.wall) score -= 30;
            }
          }
        }
        // עדיפות לקירות ארוכים לפריטים גדולים
        score += (len / Math.max(W, H)) * (w / 40);
        if (!best || score > best.score) best = { rect, clearRect: clr, wall, score };
      }
    }
    return best;
  }

  function tryCorner(it, w, d) {
    const cands = [
      { x: 0, y: 0, wall: 'top' },
      { x: W - w, y: 0, wall: 'top' },
      { x: 0, y: H - d, wall: 'bottom' },
      { x: W - w, y: H - d, wall: 'bottom' },
    ];
    const dz = openings.door.zone;
    const doorC = { x: dz.x + dz.w / 2, y: dz.y + dz.h / 2 };
    const sofa = byId.sofa || byId.bed || byId.desk;
    let best = null;
    for (const c of cands) {
      const rect = { x: c.x, y: c.y, w, h: d };
      const clr = frontRect(rect, c.wall, it.clear || 0);
      if (collides(rect, clr && inside(clr, W, H) ? clr : null)) continue;
      const cx = rect.x + w / 2, cy = rect.y + d / 2;
      let score = Math.hypot(cx - doorC.x, cy - doorC.y) / 10;
      if (sofa && (it.cat === 'light' || it.cat === 'chair')) {
        const sc = { x: sofa.rect.x + sofa.rect.w / 2, y: sofa.rect.y + sofa.rect.h / 2 };
        score -= Math.hypot(cx - sc.x, cy - sc.y) / 8;
      }
      if (!best || score > best.score) best = { rect, clearRect: clr && inside(clr, W, H) ? clr : null, wall: c.wall, score };
    }
    // אם הפינות תפוסות — נסה לאורך קיר כלשהו
    return best || tryWall({ ...it, clear: 0 }, w, d);
  }

  function tryBeside(it, w, d, targetId) {
    const target = byId[targetId];
    if (!target) return null;
    const [a, b] = segOnWall(target.rect, target.wall);
    const sides = it.side === undefined ? [0, 1] : [it.side, 1 - it.side];
    for (const s of sides) {
      const t = s === 0 ? a - w - 3 : b + 3;
      const rect = wallRect(target.wall, t, w, d, W, H);
      if (!collides(rect, null)) return { rect, wall: target.wall, clearRect: null };
    }
    return null;
  }

  function tryFront(it, w, d, targetId) {
    const target = byId[targetId];
    if (!target) return null;
    const r = target.rect;
    const gap = it.gap ?? 40;
    let rect;
    switch (target.wall) {
      case 'top': rect = { x: r.x + (r.w - w) / 2, y: r.y + r.h + gap, w, h: d }; break;
      case 'bottom': rect = { x: r.x + (r.w - w) / 2, y: r.y - gap - d, w, h: d }; break;
      case 'left': rect = { x: r.x + r.w + gap, y: r.y + (r.h - w) / 2, w: d, h: w }; break;
      case 'right': rect = { x: r.x - gap - d, y: r.y + (r.h - w) / 2, w: d, h: w }; break;
    }
    // פריט קטן מול פריט אחר (כיסא מול שולחן) רשאי לחפוף אזורי מעבר
    const ok = !collides(rect, null, new Set([targetId]), it.cat === 'chair');
    return ok ? { rect, wall: target.wall, clearRect: null } : null;
  }

  function tryUnder(it, w, d, targetId) {
    const target = byId[targetId];
    let cx, cy, wall;
    if (target) {
      // שטיח סלון: מכסה את האזור שבין הספה לשולחן
      const group = [target];
      if (targetId === 'coffee' && byId.sofa) group.push(byId.sofa);
      const xs = group.flatMap((g) => [g.rect.x, g.rect.x + g.rect.w]);
      const ys = group.flatMap((g) => [g.rect.y, g.rect.y + g.rect.h]);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      wall = target.wall;
      if (targetId === 'bed') {
        // שטיח מתחת לשני שלישים התחתונים של המיטה
        const r = target.rect;
        if (wall === 'top') cy = r.y + r.h * 0.7;
        if (wall === 'bottom') cy = r.y + r.h * 0.3;
        if (wall === 'left') cx = r.x + r.w * 0.7;
        if (wall === 'right') cx = r.x + r.w * 0.3;
      }
    } else {
      cx = W / 2; cy = H / 2; wall = W >= H ? 'top' : 'left';
    }
    const horiz = wall === 'top' || wall === 'bottom' || !wall;
    let rw = horiz ? w : d, rh = horiz ? d : w;
    const m = 15;
    rw = Math.min(rw, W - 2 * m); rh = Math.min(rh, H - 2 * m);
    if (rw < 80 || rh < 60) return null;
    const x = Math.min(Math.max(cx - rw / 2, m), W - m - rw);
    const y = Math.min(Math.max(cy - rh / 2, m), H - m - rh);
    return { rect: { x, y, w: rw, h: rh }, wall, clearRect: null };
  }

  function tryCenter(it, w, d) {
    const horiz = W >= H;
    const rw = horiz ? w : d, rh = horiz ? d : w;
    const pad = it.cat === 'table' ? 75 : 0; // מקום לכיסאות סביב השולחן
    const zone = (x, y) => ({ x: x - pad, y: y - pad, w: rw + 2 * pad, h: rh + 2 * pad });
    let best = null;
    for (let x = 0; x <= W - rw; x += STEP * 2) {
      for (let y = 0; y <= H - rh; y += STEP * 2) {
        const rect = { x, y, w: rw, h: rh };
        const z = zone(x, y);
        if (it.soft) { if (!inside(rect, W, H)) continue; }
        else if (!inside(z, W, H) || collides(rect, null) || collides(z, null)) continue;
        if (it.soft && placed.some((p) => !p.soft && overlap(rect, p.rect))) continue;
        const dist = Math.hypot(x + rw / 2 - W / 2, y + rh / 2 - H / 2);
        if (!best || dist < best.dist) best = { rect, wall: horiz ? 'top' : 'left', clearRect: null, dist };
      }
    }
    return best;
  }

  function placeAround(it, targetId) {
    const t = byId[targetId];
    if (!t) return null;
    const r = t.rect;
    const horiz = r.w >= r.h;
    const long = horiz ? r.w : r.h;
    const perSide = Math.max(1, Math.floor(long / 60));
    const chairs = [];
    const tuck = 12;
    const cw = it.w, cd = it.d;
    for (let i = 0; i < perSide; i++) {
      const off = (long / perSide) * (i + 0.5);
      if (horiz) {
        chairs.push({ x: r.x + off - cw / 2, y: r.y - cd + tuck, w: cw, h: cd });
        chairs.push({ x: r.x + off - cw / 2, y: r.y + r.h - tuck, w: cw, h: cd });
      } else {
        chairs.push({ x: r.x - cd + tuck, y: r.y + off - cw / 2, w: cd, h: cw });
        chairs.push({ x: r.x + r.w - tuck, y: r.y + off - cw / 2, w: cd, h: cw });
      }
    }
    const short = horiz ? r.h : r.w;
    if (short >= 85 && perSide < 3) {
      if (horiz) {
        chairs.push({ x: r.x - cd + tuck, y: r.y + r.h / 2 - cw / 2, w: cd, h: cw });
        chairs.push({ x: r.x + r.w - tuck, y: r.y + r.h / 2 - cw / 2, w: cd, h: cw });
      } else {
        chairs.push({ x: r.x + r.w / 2 - cw / 2, y: r.y - cd + tuck, w: cw, h: cd });
        chairs.push({ x: r.x + r.w / 2 - cw / 2, y: r.y + r.h - tuck, w: cw, h: cd });
      }
    }
    return chairs.filter((c) => {
      if (!inside(c, W, H)) return false;
      return !placed.some((p) => !p.soft && p.id !== targetId && overlap(c, p.rect)) &&
        !overlap(c, openings.door.zone);
    });
  }

  const roomArea = (W * H) / 10000;
  const ordered = [...items].sort((a, b) => a.prio - b.prio);

  for (const it of ordered) {
    if (it.minArea && roomArea < it.minArea) continue;
    const [kind, ref] = it.place.split(':');

    if (kind === 'around') {
      const rects = placeAround(it, ref);
      if (rects && rects.length) {
        rects.forEach((rect, i) => {
          const p = { ...it, id: `${it.id}_${i}`, rect, wall: 'top', group: it.id };
          placed.push(p);
        });
        byId[it.id] = { ...it, count: rects.length };
      } else skipped.push(it);
      continue;
    }

    const sizes = [{ w: it.w, d: it.d, name: it.name }];
    if (it.alt) sizes.push({ w: it.alt.w, d: it.alt.d, name: it.alt.name || `${it.name} (קומפקטי)` });

    let res = null, used = null;
    for (const s of sizes) {
      if (kind === 'wall') res = tryWall(it, s.w, s.d) || (it.reserve && tryWall({ ...it, reserve: 0 }, s.w, s.d));
      else if (kind === 'corner') res = tryCorner(it, s.w, s.d);
      else if (kind === 'beside') res = tryBeside(it, s.w, s.d, ref);
      else if (kind === 'front') res = tryFront(it, s.w, s.d, ref);
      else if (kind === 'under') res = tryUnder(it, s.w, s.d, ref);
      else if (kind === 'center') res = tryCenter(it, s.w, s.d);
      if (res) { used = s; break; }
    }
    if (!res) { skipped.push(it); continue; }

    const p = {
      ...it, name: used.name, w: used.w, d: used.d,
      rect: res.rect, wall: res.wall, clearRect: res.clearRect,
      compact: used !== sizes[0],
      related: new Set(ref ? [ref] : []),
    };
    if (ref && byId[ref]) byId[ref].related?.add(it.id);
    placed.push(p);
    byId[it.id] = p;
  }

  const solidArea = placed.filter((p) => !p.soft).reduce((s, p) => s + area(p.rect), 0);
  const freePct = Math.round(100 * (1 - solidArea / (W * H)));

  return { placed, skipped, freePct, byId };
}
