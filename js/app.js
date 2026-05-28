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
  showFavoriteFoodModal,
  showQuickAddModal,
  showWorkoutModal,
  showScanLabelModal,
  handleLabelImage,
  navigateTo,
  showToast,
  handleWeightLog,
  handleAISettings,
  shiftReportWeek,
  bindEntryDeleteHandlers,
  updateTodayButton,
} from './ui.js';

let state = loadState();
let currentDate = getDateKey();
let followToday = true;
let midnightTimer = null;
let dayCheckTimer = null;

function refresh() {
  renderAll();
  updateTodayButton(currentDate);
}

function syncDatePicker() {
  const hiddenDate = document.getElementById('hiddenDateInput');
  if (!hiddenDate) return;
  hiddenDate.value = currentDate;
  hiddenDate.max = getDateKey();
}

function markKnownDay(dateKey) {
  state.settings.lastKnownDay = dateKey;
  saveState(state);
}

function applyCurrentDate(dateKey, { notify = false, userSelected = false } = {}) {
  currentDate = dateKey;
  followToday = userSelected ? isToday(dateKey) : true;
  if (isToday(dateKey)) {
    markKnownDay(dateKey);
  }
  syncDatePicker();
  setCurrentDate(dateKey);
  updateTodayButton(dateKey);
  if (notify) {
    showToast('New day — your log starts fresh', 'success');
  }
}

function goToToday() {
  applyCurrentDate(getDateKey(), { userSelected: false });
}

function checkDayChange({ notify = false } = {}) {
  const today = getDateKey();
  const dayChanged = state.settings.lastKnownDay != null && state.settings.lastKnownDay !== today;

  if (dayChanged) {
    applyCurrentDate(today, { notify: true });
    scheduleMidnightRollover();
    return true;
  }

  if (followToday && currentDate !== today) {
    applyCurrentDate(today, { notify });
  }

  scheduleMidnightRollover();
  return false;
}

function rollToToday({ notify = false } = {}) {
  checkDayChange({ notify });
}

function scheduleMidnightRollover() {
  clearTimeout(midnightTimer);
  midnightTimer = setTimeout(() => rollToToday({ notify: true }), getMsUntilMidnight());
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    checkDayChange({ notify: true });
  }
}

function initDayTracking() {
  const today = getDateKey();
  const isNewDay = state.settings.lastKnownDay != null && state.settings.lastKnownDay !== today;

  currentDate = today;
  followToday = true;
  markKnownDay(today);
  syncDatePicker();

  if (isNewDay) {
    setTimeout(() => showToast('New day — your log starts fresh', 'success'), 400);
  }

  return isNewDay;
}

function init() {
  initUI(state, getDateKey(), refresh);
  initDayTracking();
  bindNavigation();
  bindHeader();
  bindActions();
  bindModals();
  bindFileInputs();
  bindEntryDeleteHandlers(() => state, () => currentDate, refresh);
  scheduleMidnightRollover();
  dayCheckTimer = setInterval(() => checkDayChange({ notify: true }), 30000);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', () => checkDayChange({ notify: true }));
  setCurrentDate(currentDate);
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
  const todayBtn = document.getElementById('goToTodayBtn');

  syncDatePicker();

  dateBtn.addEventListener('click', () => hiddenDate.showPicker?.() || hiddenDate.click());
  todayBtn?.addEventListener('click', goToToday);

  hiddenDate.addEventListener('change', () => {
    applyCurrentDate(hiddenDate.value, { userSelected: true });
  });
}

function bindActions() {
  document.getElementById('addFoodBtn')?.addEventListener('click', () => showFoodModal());
  document.getElementById('addWorkoutBtn')?.addEventListener('click', () => showWorkoutModal());
  document.getElementById('manualFoodBtn')?.addEventListener('click', () => showFoodModal());
  document.getElementById('addFavoriteFoodBtn')?.addEventListener('click', () => showFavoriteFoodModal());
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
      initUI(state, getDateKey(), refresh);
      initDayTracking();
      syncDatePicker();
      scheduleMidnightRollover();
      setCurrentDate(currentDate);
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
