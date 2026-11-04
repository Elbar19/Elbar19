// נציג AI: שיחה עם Claude שמברר את כל הפרטים הרלוונטיים ואז מפיק את עיצוב החדר בעצמו
// דרך הכלי create_room_design, שממלא את הטופס ומריץ את מחולל העיצוב.
import { STYLES, ROOMS } from './data.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const WINDOW_POS = ['opposite_door', 'right_of_door', 'left_of_door', 'same_wall_as_door', 'none'];

const DESIGN_TOOL = {
  name: 'create_room_design',
  description:
    'Generate the room design in the app: furniture layout, color palette, shopping list priced to the budget, ' +
    '3D preview and tips. Call it once you know the room type, its dimensions, where the window is, the style ' +
    'and the budget range. Call it again with changed values whenever the client asks for a change. ' +
    'Returns what was placed, what did not fit, the estimated total and whether it fits the budget.',
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['room_type', 'length_m', 'width_m', 'height_m', 'window_position', 'style', 'budget_min', 'budget_max', 'client_summary'],
    properties: {
      room_type: { type: 'string', enum: Object.keys(ROOMS), description: Object.entries(ROOMS).map(([k, r]) => `${k} = ${r.name}`).join(', ') },
      length_m: { type: 'number', description: 'Room length in meters, 1.5–20. The door is on one of the two walls of this length.' },
      width_m: { type: 'number', description: 'Room width in meters, 1.5–20' },
      height_m: { type: 'number', description: 'Ceiling height in meters, 2–6. Use 2.6 if the client does not know.' },
      window_position: { type: 'string', enum: WINDOW_POS, description: 'Main window position as seen by someone standing in the doorway looking into the room' },
      style: { type: 'string', enum: Object.keys(STYLES), description: Object.entries(STYLES).map(([k, s]) => `${k} = ${s.name}`).join(', ') },
      budget_min: { type: 'integer', description: 'Lowest total budget in ILS (₪)' },
      budget_max: { type: 'integer', description: 'Highest total budget in ILS (₪)' },
      client_summary: { type: 'string', description: 'Two or three Hebrew sentences: who uses the room, how, and what matters to them. Shown on the results page.' },
    },
  },
};

const SYSTEM = `You are "נועה", a friendly interior designer inside a Hebrew room-design app. Your job is to interview the client and then produce their room design by calling the create_room_design tool.

Always write in Hebrew, warmly and briefly. Ask one or two questions per message, never a long questionnaire.

Find out, in a natural order:
1. Which room it is (living room, bedroom, kids room, home office, dining area).
2. Length, width and ceiling height in meters. If they are unsure about the height, assume 2.6 m and say so.
3. Where the main window is, as seen from the doorway: opposite the door, to the right, to the left, on the door's wall, or no window.
4. Who uses the room and how (kids, working from home, hosting, pets, storage needs).
5. The style they like. Offer the app's styles briefly: ${Object.values(STYLES).map((s) => `${s.name} (${s.blurb})`).join('; ')}. If they are unsure, suggest one based on what they told you and explain why in one sentence.
6. Budget as a range in shekels (minimum and maximum) for furniture, lighting, paint and decor together.
7. Anything they want to keep. Mention they can attach a photo of the room with the 📎 button, which helps.

If a photo is attached, look at it: use what you see (light, floor, existing furniture) in your questions and recommendations, and do not ask for things the photo already answers.

When you have enough to start, say in one sentence that you are preparing the design, then call create_room_design. After it returns, summarize in 3–4 short bullets: the main layout decision, the style and colors, the estimated total versus their budget, and anything that did not fit with a suggestion. Then ask if they want to change something. For changes, call the tool again with updated values.

Use only prices that the tool returns. Never invent product names, stores or prices.`;

let state = null; // { messages, busy, pendingPhoto }

function mdLite(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let html = '', inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[-•*]\s+(.*)/);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

function addBubble(role, html = '') {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = html;
  $('chatLog').appendChild(el);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  return el;
}

function validateDesignInput(inp) {
  const errs = [];
  const num = (k, lo, hi) => {
    if (typeof inp[k] !== 'number' || !Number.isFinite(inp[k]) || inp[k] < lo || inp[k] > hi) errs.push(`${k} must be a number between ${lo} and ${hi}`);
  };
  if (!inp || typeof inp !== 'object') return ['input must be an object'];
  if (!Object.keys(ROOMS).includes(inp.room_type)) errs.push('room_type is not one of the allowed values');
  if (!Object.keys(STYLES).includes(inp.style)) errs.push('style is not one of the allowed values');
  if (!WINDOW_POS.includes(inp.window_position)) errs.push('window_position is not one of the allowed values');
  num('length_m', 1.5, 20); num('width_m', 1.5, 20); num('height_m', 2, 6);
  num('budget_min', 0, 5_000_000); num('budget_max', 1, 5_000_000);
  if (typeof inp.client_summary !== 'string') errs.push('client_summary must be a string');
  if (!errs.length && inp.budget_min > inp.budget_max) errs.push('budget_min is larger than budget_max');
  return errs;
}

export function initChat(app) {
  const open = (on) => {
    $('chatPanel').hidden = !on;
    $('chatFab').setAttribute('aria-expanded', String(on));
    if (on) {
      $('chatKeyRow').hidden = !!app.getApiKey();
      if (!state) start();
      $('chatInput').focus();
    }
  };
  $('chatFab').addEventListener('click', () => open($('chatPanel').hidden));
  $('chatClose').addEventListener('click', () => open(false));
  $('chatReset').addEventListener('click', () => { state = null; $('chatLog').innerHTML = ''; start(); });

  $('chatKey').addEventListener('change', () => {
    app.setApiKey($('chatKey').value.trim());
    $('chatKeyRow').hidden = !!app.getApiKey();
  });

  $('chatAttach').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await app.setPhoto(file);
    state.pendingPhoto = true;
    $('chatPhotoNote').hidden = false;
    e.target.value = '';
  });

  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text || state.busy) return;
    $('chatInput').value = '';
    send(text);
  });
  $('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chatForm').requestSubmit(); }
  });

  function start() {
    state = { messages: [], busy: false, pendingPhoto: app.hasPhoto() };
    $('chatPhotoNote').hidden = !state.pendingPhoto;
    addBubble('assistant', mdLite(
      'היי, אני נועה, מעצבת הפנים של האפליקציה 👋\n' +
      'אשאל אתכם כמה שאלות קצרות על החדר, ובסוף אכין לכם עיצוב מלא: העמדה, צבעים, הדמיה ורשימת קניות לפי התקציב.\n' +
      'נתחיל: איזה חדר אנחנו מעצבים?'));
  }

  async function send(text) {
    const key = app.getApiKey();
    if (!key) {
      $('chatKeyRow').hidden = false;
      addBubble('error', 'כדי לדבר עם הנציגה צריך מפתח API של Anthropic. הדביקו אותו בשדה למעלה.');
      return;
    }

    addBubble('user', esc(text).replace(/\n/g, '<br>'));
    const content = [];
    if (state.pendingPhoto && app.getPhotoB64()) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: app.getPhotoB64() } });
      content.push({ type: 'text', text: '(צירפתי תמונה של החדר)' });
      state.pendingPhoto = false;
      $('chatPhotoNote').hidden = true;
    }
    content.push({ type: 'text', text });
    const userMsg = { role: 'user', content };
    state.messages.push(userMsg);

    state.busy = true;
    $('chatSend').disabled = true;
    try {
      await runAgent(key);
    } catch (err) {
      addBubble('error', esc(err?.message || String(err)));
      // מחזירים את ההיסטוריה למצב שלפני ההודעה שנכשלה, כדי שאפשר יהיה לנסות שוב
      const i = state.messages.lastIndexOf(userMsg);
      if (i >= 0) state.messages.length = i;
    } finally {
      state.busy = false;
      $('chatSend').disabled = false;
      $('chatInput').focus();
    }
  }

  async function runAgent(key) {
    const { getClient, Anthropic, MODEL, FALLBACK } = await import('./ai.js');
    const client = getClient(key);
    let jsonRetries = 0;

    for (let turn = 0; turn < 8; turn++) {
      const bubble = addBubble('assistant typing', '<span class="dots"><i></i><i></i><i></i></span>');
      let text = '';
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: 'medium' },
        system: SYSTEM,
        tools: [DESIGN_TOOL],
        messages: state.messages,
      });
      stream.on('text', (delta) => {
        text += delta;
        bubble.classList.remove('typing');
        bubble.innerHTML = mdLite(text);
        $('chatLog').scrollTop = $('chatLog').scrollHeight;
      });

      let message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        bubble.remove();
        // רק קלט כלי שלא ניתן לפענוח מנוסה שוב; שגיאות API עולות למעלה
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw friendlyError(err, Anthropic);
        continue;
      }
      if (!text) bubble.remove();

      if (message.stop_reason === 'refusal') throw new Error('Claude סירב להמשיך את השיחה הזו. נסו לנסח את ההודעה אחרת.');
      if (message.stop_reason === 'pause_turn') { state.messages.push({ role: 'assistant', content: message.content }); continue; }

      const toolUses = message.content.filter((b) => b.type === 'tool_use');
      if (message.stop_reason === 'max_tokens' && toolUses.length) throw new Error('התשובה נקטעה באמצע. נסו שוב.');
      state.messages.push({ role: 'assistant', content: message.content });
      if (!toolUses.length) return;

      const results = [];
      for (const tu of toolUses) {
        if (tu.name !== DESIGN_TOOL.name) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` });
          continue;
        }
        const errs = validateDesignInput(tu.input);
        if (errs.length) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'Invalid input: ' + errs.join('; ') });
          continue;
        }
        const working = addBubble('system', '🛠️ מכינה את העיצוב…');
        try {
          const summary = app.runDesign(tu.input);
          working.innerHTML = '✅ העיצוב מוכן. <button type="button" class="link">לצפייה בעיצוב</button>';
          working.querySelector('button').addEventListener('click', () => app.showResults());
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(summary) });
        } catch (err) {
          working.textContent = 'לא הצלחתי להפיק את העיצוב.';
          results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: String(err?.message || err) });
        }
      }
      state.messages.push({ role: 'user', content: results });
    }
  }
}

function friendlyError(err, Anthropic) {
  if (err instanceof Anthropic.AuthenticationError) return new Error('מפתח ה-API לא תקין. בדקו אותו ונסו שוב.');
  if (err instanceof Anthropic.RateLimitError) return new Error('יותר מדי בקשות כרגע. חכו דקה ונסו שוב.');
  if (err instanceof Anthropic.APIConnectionError) return new Error('אין חיבור לשרת של Claude. בדקו את החיבור לאינטרנט.');
  if (err instanceof Anthropic.APIError) return new Error(`שגיאה מ-Claude (${err.status ?? ''}). נסו שוב.`);
  return err;
}
