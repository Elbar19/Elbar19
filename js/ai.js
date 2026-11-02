// ניתוח תמונת החדר עם Claude (אופציונלי). רץ ישירות מהדפדפן עם מפתח API של המשתמש.
// הערה: מפתח בדפדפן מתאים לשימוש אישי בלבד. לפריסה ציבורית יש להעביר את הקריאה לשרת.
import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';

const SCHEMA = {
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

export async function analyzeWithClaude({ apiKey, imageB64, room, styleName, roomTypeName, budgetName }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system:
      'You are an experienced interior designer. Look carefully at the room photo and give concrete, ' +
      'practical advice tailored to what is actually visible (existing furniture, flooring, windows, light, ' +
      'architectural features). Write every string in Hebrew. Keep each bullet to one or two sentences.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
          {
            type: 'text',
            text:
              `סוג החדר: ${roomTypeName}\n` +
              `מידות: ${room.length} × ${room.width} מ', גובה תקרה ${room.height} מ'\n` +
              `סגנון מבוקש: ${styleName}\n` +
              `תקציב: ${budgetName}\n\n` +
              'נתח את התמונה ותן תוכנית עיצוב שמביאה את החדר הזה לסגנון המבוקש.',
          },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('הבקשה נדחתה על ידי המודל. נסו תמונה אחרת.');
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}
