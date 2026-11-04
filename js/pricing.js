// תמחור לפי טווח מחיר שהמשתמש בוחר (מינימום–מקסימום בש"ח).
// לכל פריט יש 3 נקודות מחיר [חסכוני, בינוני, פרימיום]; מוסיפים נקודה רביעית "יוקרה".
// מוצאים רמת גימור רציפה t (0..3) כך שהסכום הכולל ייפול בתוך הטווח.

export const TIER_NAMES = ['חסכוני', 'בינוני', 'פרימיום', 'יוקרה'];
const T_MAX = 3;

export function priceAt(points, t) {
  const p = [points[0], points[1], points[2], points[2] * 1.8];
  const c = Math.max(0, Math.min(T_MAX, t));
  const i = Math.min(2, Math.floor(c));
  return p[i] + (p[i + 1] - p[i]) * (c - i);
}

export function tierName(t) {
  return TIER_NAMES[Math.max(0, Math.min(3, Math.round(t)))];
}

const totalAt = (lines, t) => lines.reduce((s, l) => s + priceAt(l.price, t) * (l.qty || 1), 0);

// lines: [{ price: [low, mid, high], qty }]
// מחזיר את רמת הגימור, הסכום, ומצב התקציב: 'ok' | 'over' (גם הזול ביותר יקר מדי) | 'under'
export function fitBudget(lines, min, max) {
  const lo = totalAt(lines, 0), hi = totalAt(lines, T_MAX);
  if (lo > max) return { t: 0, total: lo, status: 'over' };
  if (hi < min) return { t: T_MAX, total: hi, status: 'under' };
  // מכוונים לאמצע הטווח, כדי להשאיר מרווח לבלתי צפוי
  const target = Math.min(Math.max((min + max) / 2, lo), hi);
  let a = 0, b = T_MAX;
  for (let k = 0; k < 40; k++) {
    const m = (a + b) / 2;
    if (totalAt(lines, m) < target) a = m; else b = m;
  }
  const t = (a + b) / 2;
  return { t, total: totalAt(lines, t), status: 'ok' };
}

export const BUDGET_PRESETS = [
  { label: 'עד 5 אלף', min: 1000, max: 5000 },
  { label: '5–15 אלף', min: 5000, max: 15000 },
  { label: '15–30 אלף', min: 15000, max: 30000 },
  { label: '30–60 אלף', min: 30000, max: 60000 },
  { label: '60 אלף+', min: 60000, max: 120000 },
];
