import {
  getCoachContext,
  executeCoachActions,
  saveState,
} from './storage.js';
import {
  buildCoachSystemMessage,
  sendCoachMessage,
  fileToBase64,
  compressImage,
} from './ai.js';

const QUICK_PROMPTS = [
  { label: 'Meal ideas', text: 'What should I eat for my next meal based on my remaining macros today?' },
  { label: 'Workout plan', text: 'Suggest a workout for today based on my goals and activity level.' },
  { label: 'Weekly check-in', text: 'How am I doing this week? Give me an honest assessment.' },
  { label: 'Log breakfast', text: 'I had eggs and toast for breakfast — please log it with estimated macros.' },
  { label: 'Over goal help', text: "I'm over my calorie goal today. What should I do for the rest of the day?" },
  { label: 'High protein', text: 'Suggest high-protein foods that fit my remaining calories today.' },
];

let state = null;
let currentDate = null;
let onUpdate = null;
let pendingImage = null;
let isSending = false;
let eventsBound = false;

export function initCoach(appState, dateKey, updateCallback) {
  state = appState;
  currentDate = dateKey;
  onUpdate = updateCallback;
  if (!state.chatHistory) state.chatHistory = [];
  bindCoachEvents();
  renderCoachView();
}

export function setCoachDate(dateKey) {
  currentDate = dateKey;
}

export function renderCoachView() {
  renderPrompts();
  renderMessages();
  updatePendingImagePreview();
  updateCoachApiWarning();
}

function bindCoachEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.getElementById('coachSendBtn')?.addEventListener('click', () => sendUserMessage());
  document.getElementById('coachClearBtn')?.addEventListener('click', clearChat);
  document.getElementById('coachAttachBtn')?.addEventListener('click', () => {
    document.getElementById('coachImageInput')?.click();
  });

  document.getElementById('coachImageInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let base64 = await fileToBase64(file);
    base64 = await compressImage(base64);
    pendingImage = base64;
    updatePendingImagePreview();
    e.target.value = '';
  });

  document.getElementById('coachInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });
}

function renderPrompts() {
  const el = document.getElementById('coachPrompts');
  if (!el) return;

  el.innerHTML = QUICK_PROMPTS.map(
    (p) => `<button class="coach-prompt-chip" data-prompt="${escapeAttr(p.text)}">${p.label}</button>`
  ).join('');

  el.querySelectorAll('[data-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('coachInput').value = btn.dataset.prompt;
      sendUserMessage();
    });
  });
}

function renderMessages() {
  const el = document.getElementById('coachMessages');
  if (!el) return;

  if (!state.chatHistory.length) {
    el.innerHTML = `
      <div class="coach-welcome">
        <div class="coach-welcome-icon">🤖</div>
        <h3>Your AI Coach</h3>
        <p>Ask for meal ideas, workout suggestions, or tell me to log food and workouts. Attach photos of meals or labels!</p>
      </div>`;
    return;
  }

  el.innerHTML = state.chatHistory
    .map((msg) => {
      const isUser = msg.role === 'user';
      const actionsHtml =
        msg.actionsApplied?.length > 0
          ? `<div class="coach-action-pills">${msg.actionsApplied
              .map((a) => `<span class="coach-action-pill">${escapeHtml(a.label)}</span>`)
              .join('')}</div>`
          : '';

      const imageHtml = msg.image
        ? `<img class="coach-msg-image" src="${msg.image}" alt="Attached photo">`
        : '';

      return `
        <div class="coach-msg ${isUser ? 'user' : 'assistant'}">
          <div class="coach-msg-bubble">
            ${imageHtml}
            <div class="coach-msg-text">${formatMessageText(msg.content)}</div>
            ${actionsHtml}
          </div>
          <span class="coach-msg-time">${formatMsgTime(msg.timestamp)}</span>
        </div>`;
    })
    .join('');

  el.scrollTop = el.scrollHeight;
}

async function sendUserMessage() {
  if (isSending) return;

  const input = document.getElementById('coachInput');
  const text = input?.value.trim();
  if (!text && !pendingImage) return;

  if (!state.settings.openrouterKey) {
    showCoachError('Add your OpenRouter API key in Profile → AI Settings');
    return;
  }

  const userMsg = {
    role: 'user',
    content: text || 'Please analyze this image and help me log or understand the nutrition.',
    image: pendingImage,
    timestamp: Date.now(),
  };

  state.chatHistory.push(userMsg);
  if (state.chatHistory.length > 100) state.chatHistory = state.chatHistory.slice(-100);
  saveState(state);

  input.value = '';
  pendingImage = null;
  updatePendingImagePreview();
  renderMessages();
  setSending(true);

  try {
    const context = getCoachContext(state, currentDate);
    const systemPrompt = buildCoachSystemMessage(context);
    const apiMessages = state.chatHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map(({ role, content, image }) => ({ role, content, image }));

    const { content, actions } = await sendCoachMessage(
      state.settings.openrouterKey,
      state.settings.aiModel,
      systemPrompt,
      apiMessages
    );

    let actionsApplied = [];
    if (actions.length) {
      actionsApplied = executeCoachActions(state, currentDate, actions);
    }

    state.chatHistory.push({
      role: 'assistant',
      content,
      actionsApplied,
      timestamp: Date.now(),
    });
    saveState(state);
    renderMessages();
    onUpdate?.();
  } catch (err) {
    showCoachError(err.message);
    state.chatHistory.pop();
    saveState(state);
    renderMessages();
  } finally {
    setSending(false);
  }
}

function clearChat() {
  if (!state.chatHistory.length) return;
  if (!confirm('Clear all chat history?')) return;
  state.chatHistory = [];
  saveState(state);
  renderMessages();
}

function setSending(sending) {
  isSending = sending;
  const btn = document.getElementById('coachSendBtn');
  const el = document.getElementById('coachMessages');
  if (btn) {
    btn.disabled = sending;
    btn.textContent = sending ? '...' : 'Send';
  }
  if (sending && el) {
    el.insertAdjacentHTML(
      'beforeend',
      `<div class="coach-msg assistant" id="coachTyping">
        <div class="coach-msg-bubble typing"><span></span><span></span><span></span></div>
      </div>`
    );
    el.scrollTop = el.scrollHeight;
  } else {
    document.getElementById('coachTyping')?.remove();
  }
}

function updatePendingImagePreview() {
  const preview = document.getElementById('coachImagePreview');
  if (!preview) return;

  if (pendingImage) {
    preview.classList.remove('hidden');
    preview.innerHTML = `
      <img src="${pendingImage}" alt="Preview">
      <button type="button" id="coachRemoveImage" class="coach-remove-image">×</button>`;
    document.getElementById('coachRemoveImage')?.addEventListener('click', () => {
      pendingImage = null;
      updatePendingImagePreview();
    });
  } else {
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }
}

function updateCoachApiWarning() {
  const el = document.getElementById('coachApiWarning');
  if (!el) return;
  el.classList.toggle('hidden', !!state.settings.openrouterKey);
}

function showCoachError(message) {
  const el = document.getElementById('coachMessages');
  if (!el) return;
  el.insertAdjacentHTML(
    'beforeend',
    `<div class="coach-error">${escapeHtml(message)}</div>`
  );
  el.scrollTop = el.scrollHeight;
}

function formatMessageText(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function formatMsgTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}
