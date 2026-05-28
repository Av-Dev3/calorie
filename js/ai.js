export const AI_MODEL_PRESETS = [
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash (fastest)' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
];

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const COACH_TIMEOUT_MS = 45000;
const COACH_MAX_HISTORY = 10;

const NUTRITION_PROMPT = `You are a nutrition label reader. Analyze this food label image and extract nutrition information.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "name": "product name",
  "servingSize": "serving size description",
  "servingsPerContainer": number or null,
  "calories": number,
  "protein": number in grams,
  "carbs": number in grams,
  "fat": number in grams,
  "fiber": number in grams or 0,
  "sugar": number in grams or 0,
  "sodium": number in mg or 0,
  "saturatedFat": number in grams or 0,
  "transFat": number in grams or 0,
  "cholesterol": number in mg or 0,
  "confidence": "high" | "medium" | "low"
}

Use per-serving values. If only per-container values are shown, divide by servings per container.
If a value is not visible, use 0. Be precise with numbers.`;

const COACH_SYSTEM_PROMPT = `You are CalorieTrack Pro AI Coach — a friendly fitness and nutrition assistant built into a calorie tracking app.

## CRITICAL: Use saved app data
The user has already logged food, workouts, and goals in the app. LIVE APP DATA is provided below.
- When discussing the user's intake, progress, or remaining macros, use ONLY the exact numbers from LIVE APP DATA.
- NEVER guess or invent what the user has eaten today — read mealsToday and the summary totals.
- When stating calories eaten, remaining, net, or macros, quote the exact values from LIVE APP DATA.
- If mealsToday is empty, say nothing is logged yet — do not assume they ate anything.
- Only estimate macros when the user asks you to LOG new food that is not already in the app.

## Your capabilities
1. **Advice**: Recommend foods, meals, and workouts based on goals and LIVE APP DATA.
2. **Logging**: When the user asks to log/add/record food, workouts, or weight — include action blocks.
3. **Vision**: Analyze food photos and estimate macros for NEW items to log.
4. **Context-aware**: Always reference the user's actual logged data.

## Rules
- Be concise and practical. Use bullet points for lists.
- When logging data the user requested, ALWAYS include an actions block.
- When recommending (not logging), do NOT include actions unless the user says to log it.
- mealType must be one of: breakfast, lunch, dinner, snack
- Never provide medical diagnoses.

## Action block format
When logging data, append this block at the END of your response:

\`\`\`actions
[
  {"type": "add_food", "data": {"name": "Greek yogurt", "calories": 150, "protein": 15, "carbs": 8, "fat": 4, "mealType": "breakfast"}},
  {"type": "add_workout", "data": {"name": "Running", "duration": 30, "caloriesBurned": 300, "icon": "🏃"}},
  {"type": "log_weight", "data": {"weight": 175, "unit": "lbs"}},
  {"type": "update_goals", "data": {"calories": 1800, "protein": 140}}
]
\`\`\`

Action types: add_food, add_workout, log_weight, update_goals
Only include actions the user explicitly asked to log or clearly confirmed.`;

export function buildCoachSystemMessage(context) {
  return `${COACH_SYSTEM_PROMPT}

## LIVE APP DATA (authoritative — use these exact numbers)
${context.summary}

## Full data (JSON)
${JSON.stringify(context, null, 2)}`;
}

export function buildCoachUserPrefix(context) {
  return `[My saved app data for ${context.date} — use these exact numbers when answering]\n${context.summary}\n\n`;
}

export async function scanFoodLabel(imageBase64, apiKey, model) {
  if (!apiKey) {
    throw new Error('OpenRouter API key is required. Add it in Profile settings.');
  }

  const response = await fetchWithTimeout(
    OPENROUTER_URL,
    {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: NUTRITION_PROMPT },
              { type: 'image_url', image_url: { url: imageBase64 } },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
    },
    60000
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from AI');

  return parseNutritionResponse(content);
}

export async function sendCoachMessage(apiKey, model, systemPrompt, chatMessages, contextPrefix = '') {
  if (!apiKey) {
    throw new Error('OpenRouter API key is required. Add it in Profile settings.');
  }

  const trimmed = chatMessages.slice(-COACH_MAX_HISTORY);
  const formatted = trimmed.map((msg, index) =>
    formatMessageForApi(msg, index === trimmed.length - 1)
  );

  if (contextPrefix && formatted.length > 0) {
    const last = formatted[formatted.length - 1];
    if (last.role === 'user') {
      last.content = prependToUserContent(last.content, contextPrefix);
    }
  }

  const messages = [{ role: 'system', content: systemPrompt }, ...formatted];

  const response = await fetchWithTimeout(
    OPENROUTER_URL,
    {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 900,
        temperature: 0.4,
      }),
    },
    COACH_TIMEOUT_MS
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from AI');

  return parseCoachResponse(content);
}

function prependToUserContent(content, prefix) {
  if (Array.isArray(content)) {
    const textPart = content.find((p) => p.type === 'text');
    if (textPart) {
      textPart.text = prefix + textPart.text;
      return content;
    }
    return [{ type: 'text', text: prefix }, ...content];
  }
  return prefix + content;
}

function formatMessageForApi(msg, isLatest) {
  if (msg.role === 'user' && msg.image && isLatest) {
    const parts = [{ type: 'text', text: msg.content || 'Please analyze this image.' }];
    parts.push({ type: 'image_url', image_url: { url: msg.image } });
    return { role: 'user', content: parts };
  }

  let text = msg.content || '';
  if (msg.role === 'user' && msg.image && !isLatest) {
    text = `${text}\n[User previously attached a photo]`.trim();
  }
  return { role: msg.role, content: text };
}

export function parseCoachResponse(content) {
  const actions = extractActions(content);
  const displayContent = stripActionsBlock(content).trim();
  return { content: displayContent, actions };
}

function extractActions(content) {
  const match = content.match(/```actions\s*([\s\S]*?)```/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1].trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stripActionsBlock(content) {
  return content.replace(/```actions[\s\S]*?```/g, '').trim();
}

function parseNutritionResponse(content) {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      name: parsed.name || 'Unknown Food',
      servingSize: parsed.servingSize || '1 serving',
      calories: Number(parsed.calories) || 0,
      protein: Number(parsed.protein) || 0,
      carbs: Number(parsed.carbs) || 0,
      fat: Number(parsed.fat) || 0,
      fiber: Number(parsed.fiber) || 0,
      sugar: Number(parsed.sugar) || 0,
      sodium: Number(parsed.sodium) || 0,
      confidence: parsed.confidence || 'medium',
    };
  } catch {
    throw new Error('Could not parse nutrition data from AI response');
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. Try again or use a faster model (Gemini Flash).`);
    }
    throw new Error('Network error — check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}

function getHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': window.location.origin,
    'X-Title': 'CalorieTrack Pro',
  };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function compressImage(base64, maxWidth = 768) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}
