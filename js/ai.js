// כל הקריאות ל-Claude. רצות ישירות מהדפדפן עם מפתח ה-API של המשתמש.
// הערה: מפתח בדפדפן מתאים לשימוש אישי בלבד. לפריסה ציבורית יש להעביר את הקריאות לשרת.
import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';

export { Anthropic };
export const MODEL = 'claude-opus-5-5';
// אם המודל הראשי מסרב לבקשה, השרת מריץ אותה אוטומטית על מודל חלופי
export const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

let cached = null;
export function getClient(apiKey) {
  if (!cached || cached.key !== apiKey) {
    cached = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
  }
  return cached.client;
}

function textOf(message) {
  if (message.stop_reason === 'refusal') throw new Error('Claude סירב לבקשה. נסו לנסח אחרת או להחליף תמונה.');
  if (message.stop_reason === 'max_tokens') throw new Error('התשובה נקטעה באמצע. נסו שוב.');
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// ---------- ניתוח תמונת החדר ----------
const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['observations', 'keep', 'change', 'layout_tips', 'color_plan', 'first_steps'],
  properties: {
    observations: { type: 'array', items: { type: 'string' }, description: 'מה רואים בחדר כיום' },
    keep: { type: 'array', items: { type: 'string' }, description: 'מה כדאי להשאיר ולמה' },
    change: { type: 'array', items: { type: 'string' }, description: 'מה להחליף או להוסיף כדי להגיע לסגנון' },
    layout_tips: { type: 'array', items: { type: 'string' } },
    color_plan: { type: 'string' },
    first_steps: { type: 'array', items: { type: 'string' }, description: '3 צעדים ראשונים לפי סדר עדיפות' },
  },
};

export async function analyzeWithClaude({ apiKey, imageB64, room, styleName, roomTypeName, budgetText }) {
  const client = getClient(apiKey);
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
    system:
      'You are an experienced interior designer. Look carefully at the room photo and give concrete, ' +
      'practical advice tailored to what is actually visible (existing furniture, flooring, windows, light, ' +
      'architectural features). Write every string in Hebrew. Keep each bullet to one or two sentences.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
        {
          type: 'text',
          text:
            `סוג החדר: ${roomTypeName}\n` +
            `מידות: ${room.length} × ${room.width} מ', גובה תקרה ${room.height} מ'\n` +
            `סגנון מבוקש: ${styleName}\n` +
            `תקציב: ${budgetText}\n\n` +
            'נתח את התמונה ותן תוכנית עיצוב שמביאה את החדר הזה לסגנון המבוקש.',
        },
      ],
    }],
  });
  return JSON.parse(textOf(response));
}

// ---------- ציור הדמיה של החדר המעוצב ----------
const DRAW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['svg', 'caption'],
  properties: {
    svg: { type: 'string', description: 'A complete standalone SVG document' },
    caption: { type: 'string', description: 'One Hebrew sentence describing the scene' },
  },
};

export async function drawRoomWithClaude({ apiKey, imageB64, design }) {
  const client = getClient(apiKey);
  const content = [];
  if (imageB64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } });
  }
  content.push({
    type: 'text',
    text:
      'Here is the finished design for the room, as JSON. Plan coordinates are in cm; x runs along the ' +
      '"top" wall from the left wall, y runs from the top wall toward the bottom wall.\n\n' +
      JSON.stringify(design, null, 1) +
      (imageB64
        ? '\n\nThe attached photo is the room today. Match its camera angle, proportions and architecture ' +
          '(windows, doors, ceiling) as closely as you can, but show it after the redesign.'
        : '\n\nDraw the room from a standing eye level in the doorway, looking into the room.'),
  });

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    ...FALLBACK,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: DRAW_SCHEMA } },
    system:
      'You are an interior visualization artist who draws in SVG. Produce one polished interior rendering ' +
      'of the redesigned room in perspective, as an SVG with viewBox="0 0 1200 800". Requirements:\n' +
      '- Use the exact hex colors from the palette for walls, floor, furniture and accents.\n' +
      '- Include every listed furniture item, at its planned position relative to the walls, window and door, ' +
      'with believable proportions for its real size in cm.\n' +
      '- Make it look like a designer\'s rendering: perspective-correct walls, floor and ceiling, linear and ' +
      'radial gradients for daylight from the window and lamp glow, soft contact shadows, simple textures ' +
      '(wood grain, fabric folds, rug pattern), plants and decor that fit the style.\n' +
      '- Self-contained: no <script>, no <image>, no <foreignObject>, no external references, no text labels.\n' +
      '- Write the caption in Hebrew.',
    messages: [{ role: 'user', content }],
  });
  const message = await stream.finalMessage();
  const result = JSON.parse(textOf(message));
  return { svg: sanitizeSvg(result.svg), caption: result.caption };
}

// מסיר כל דבר שאינו ציור טהור (סקריפטים, אירועים, קישורים חיצוניים)
export function sanitizeSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('Claude החזיר ציור לא תקין. נסו שוב.');
  }
  doc.querySelectorAll('script, foreignObject, image, iframe, use[href^="http"], a').forEach((n) => n.remove());
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href') && !val.startsWith('#')) el.removeAttribute(attr.name);
      else if (val.includes('javascript:') || /url\(\s*['"]?(https?:|\/\/)/.test(val)) el.removeAttribute(attr.name);
    }
  }
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(root);
}
