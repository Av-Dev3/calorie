import {
  loadState,
  saveState,
  getDateKey,
  getMsUntilMidnight,
  isToday,
  exportData,
  clearAllData,
} from './storage.js';
import {
  initUI,
  renderAll,
  setCurrentDate,
  closeModal,
  showFoodModal,
  showQuickAddModal,
  showWorkoutModal,
  showScanLabelModal,
  handleLabelImage,
  navigateTo,
  showToast,
  handleWeightLog,
  handleAISettings,
  shiftReportWeek,
} from './ui.js';

let state = loadState();
let currentDate = getDateKey();
let followToday = true;
let midnightTimer = null;

function refresh() {
  renderAll();
}

function syncDatePicker() {
  const hiddenDate = document.getElementById('hiddenDateInput');
  if (!hiddenDate) return;
  hiddenDate.value = currentDate;
  hiddenDate.max = getDateKey();
}

function applyCurrentDate(dateKey, { notify = false } = {}) {
  currentDate = dateKey;
  followToday = isToday(dateKey);
  syncDatePicker();
  setCurrentDate(dateKey);
  if (notify) {
    showToast('New day — your log starts fresh', 'success');
  }
}

function rollToToday({ notify = false } = {}) {
  const today = getDateKey();
  if (currentDate === today && followToday) {
    scheduleMidnightRollover();
    return;
  }
  if (followToday) {
    applyCurrentDate(today, { notify });
  }
  scheduleMidnightRollover();
}

function scheduleMidnightRollover() {
  clearTimeout(midnightTimer);
  midnightTimer = setTimeout(() => rollToToday({ notify: true }), getMsUntilMidnight());
}

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  const today = getDateKey();
  if (followToday && currentDate !== today) {
    applyCurrentDate(today, { notify: true });
  }
  scheduleMidnightRollover();
}

function init() {
  currentDate = getDateKey();
  followToday = true;
  initUI(state, currentDate, refresh);
  bindNavigation();
  bindHeader();
  bindActions();
  bindModals();
  bindFileInputs();
  syncDatePicker();
  scheduleMidnightRollover();
  document.addEventListener('visibilitychange', onVisibilityChange);
  renderAll();
}

function bindNavigation() {
  document.getElementById('bottomNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    navigateTo(btn.dataset.nav);
  });
}

function bindHeader() {
  const dateBtn = document.getElementById('datePickerBtn');
  const hiddenDate = document.getElementById('hiddenDateInput');

  syncDatePicker();

  dateBtn.addEventListener('click', () => hiddenDate.showPicker?.() || hiddenDate.click());

  hiddenDate.addEventListener('change', () => {
    applyCurrentDate(hiddenDate.value);
  });
}

function bindActions() {
  document.getElementById('addFoodBtn')?.addEventListener('click', () => showFoodModal());
  document.getElementById('addWorkoutBtn')?.addEventListener('click', () => showWorkoutModal());
  document.getElementById('manualFoodBtn')?.addEventListener('click', () => showFoodModal());
  document.getElementById('quickAddBtn')?.addEventListener('click', () => showQuickAddModal());
  document.getElementById('scanLabelBtn')?.addEventListener('click', () => showScanLabelModal());
  document.getElementById('newWorkoutBtn')?.addEventListener('click', () => showWorkoutModal());

  document.getElementById('weightLogForm')?.addEventListener('submit', handleWeightLog);

  document.getElementById('aiSettingsForm')?.addEventListener('submit', handleAISettings);

  document.getElementById('exportDataBtn')?.addEventListener('click', () => {
    exportData(state);
    showToast('Data exported!', 'success');
  });

  document.getElementById('clearDataBtn')?.addEventListener('click', () => {
    if (confirm('This will permanently delete all your data. Are you sure?')) {
      clearAllData();
      state = loadState();
      currentDate = getDateKey();
      followToday = true;
      initUI(state, currentDate, refresh);
      syncDatePicker();
      scheduleMidnightRollover();
      refresh();
      showToast('All data cleared', 'success');
    }
  });

  document.getElementById('weightUnit').value = state.settings.weightUnit;

  document.getElementById('reportWeekPrev')?.addEventListener('click', () => shiftReportWeek(-1));
  document.getElementById('reportWeekNext')?.addEventListener('click', () => shiftReportWeek(1));
}

function bindModals() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

function bindFileInputs() {
  const cameraInput = document.getElementById('labelCameraInput');
  const fileInput = document.getElementById('labelFileInput');

  document.addEventListener('click', (e) => {
    if (e.target.id === 'takePhotoBtn') cameraInput.click();
    if (e.target.id === 'uploadPhotoBtn') fileInput.click();
  });

  cameraInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleLabelImage(e.target.files[0]);
    cameraInput.value = '';
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleLabelImage(e.target.files[0]);
    fileInput.value = '';
  });
}

document.addEventListener('DOMContentLoaded', init);
