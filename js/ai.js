const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

const COACH_SYSTEM_PROMPT = `You are CalorieTrack Pro AI Coach — a friendly, knowledgeable fitness and nutrition assistant built into a calorie tracking app.

## Your capabilities
1. **Advice**: Recommend foods, meals, and workouts based on the user's goals, profile, and today's progress.
2. **Logging**: When the user asks you to log, add, or record food, workouts, or weight — include action blocks so the app saves it automatically.
3. **Vision**: Analyze food photos, nutrition labels, meals, and estimate macros when images are provided.
4. **Context-aware**: Use the user's current stats, goals, and history provided in USER_CONTEXT.

## Rules
- Be concise, encouraging, and practical. Use bullet points for lists.
- When logging data the user requested, ALWAYS include an actions block (see format below).
- When recommending (not logging), do NOT include actions unless the user says to log it.
- Estimate reasonable macros for common foods when exact values aren't known.
- For workouts, estimate calories burned based on duration and intensity.
- mealType must be one of: breakfast, lunch, dinner, snack
- Never provide medical diagnoses. Add a brief disclaimer for serious health questions.
- If info is missing to log something, ask one clarifying question OR make a reasonable estimate and note it.

## Action block format
When logging data, append this block at the END of your response (user won't see it rendered as text):

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

## USER_CONTEXT
${JSON.stringify(context, null, 2)}`;
}

export async function scanFoodLabel(imageBase64, apiKey, model) {
  if (!apiKey) {
    throw new Error('OpenRouter API key is required. Add it in Profile settings.');
  }

  const response = await fetch(OPENROUTER_URL, {
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
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from AI');

  return parseNutritionResponse(content);
}

export async function sendCoachMessage(apiKey, model, systemPrompt, chatMessages) {
  if (!apiKey) {
    throw new Error('OpenRouter API key is required. Add it in Profile settings.');
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatMessages.map(formatMessageForApi),
  ];

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from AI');

  return parseCoachResponse(content);
}

function formatMessageForApi(msg) {
  if (msg.role === 'user' && msg.image) {
    const parts = [{ type: 'text', text: msg.content || 'Please analyze this image.' }];
    parts.push({ type: 'image_url', image_url: { url: msg.image } });
    return { role: 'user', content: parts };
  }
  return { role: msg.role, content: msg.content };
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

export function compressImage(base64, maxWidth = 1024) {
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
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = base64;
  });
}
