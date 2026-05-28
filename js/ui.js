import {
  getEntriesForDate,
  calculateDailyTotals,
  getLatestWeight,
  getWeekDates,
  formatDateDisplay,
  formatTime,
  MEAL_TYPES,
  MEAL_EMOJI,
  WORKOUT_PRESETS,
  estimateCaloriesBurned,
  calculateTDEE,
  addFoodEntry,
  addWorkoutEntry,
  removeFoodEntry,
  removeWorkoutEntry,
  addWeightEntry,
  saveState,
  inchesToFtIn,
  ftInToInches,
  normalizeHeightUnit,
  isToday,
} from './storage.js';
import { scanFoodLabel, fileToBase64, compressImage, AI_MODEL_PRESETS } from './ai.js';
import { initReports, setReportWeekEnd, shiftReportWeek, renderReportsView } from './reports.js';
import { initCoach, setCoachDate, renderCoachView } from './coach.js';

let state = null;
let currentDate = null;
let onUpdate = null;

export function initUI(appState, dateKey, updateCallback) {
  state = appState;
  currentDate = dateKey;
  onUpdate = updateCallback;
  initReports(dateKey, () => onUpdate?.());
  initCoach(appState, dateKey, updateCallback);
}

export function setCurrentDate(dateKey) {
  currentDate = dateKey;
  setReportWeekEnd(dateKey);
  setCoachDate(dateKey);
  renderAll();
}

export function renderAll() {
  renderDashboard();
  renderFoodView();
  renderWorkoutView();
  renderGoalsView();
  renderProfileView();
  renderReportsView(state);
  renderCoachView();
  updateDateDisplay();
}

export { shiftReportWeek };

function updateDateDisplay() {
  const el = document.getElementById('dateDisplay');
  if (!el) return;
  const label = formatDateDisplay(currentDate);
  el.textContent = isToday(currentDate) ? label : `${label} · entries save to this day`;
}

function renderDashboard() {
  const { food, workouts } = getEntriesForDate(state, currentDate);
  const totals = calculateDailyTotals(food, workouts);
  const goal = state.goals.calories;
  const netCalories = totals.calories - totals.burned;
  const remaining = goal - netCalories;
  const isOver = remaining < 0;
  const overAmount = Math.abs(remaining);

  const ringCard = document.getElementById('calorieRingCard');
  const ringLabel = document.getElementById('calorieRingLabel');
  const banner = document.getElementById('overGoalBanner');

  document.getElementById('caloriesRemaining').textContent = isOver ? overAmount : remaining;
  if (ringLabel) ringLabel.textContent = isOver ? 'over goal' : 'remaining';
  if (ringCard) ringCard.classList.toggle('over-goal', isOver);

  document.getElementById('caloriesConsumed').textContent = totals.calories;
  document.getElementById('caloriesBurned').textContent = totals.burned;
  document.getElementById('caloriesGoal').textContent = goal;

  if (banner) {
    if (isOver) {
      banner.classList.remove('hidden');
      banner.innerHTML = `
        <span class="over-goal-icon">⚠️</span>
        <div class="over-goal-text">
          <strong>${overAmount} cal over your daily goal</strong>
          <span>You've eaten ${netCalories} net cal (goal: ${goal})</span>
        </div>`;
    } else {
      banner.classList.add('hidden');
      banner.innerHTML = '';
    }
  }

  const ring = document.getElementById('calorieRingProgress');
  const circumference = 2 * Math.PI * 52;
  const pct = isOver ? 1 : Math.min(netCalories / goal, 1);
  ring.style.strokeDashoffset = circumference * (1 - pct);
  ring.style.stroke = isOver ? 'var(--danger)' : 'var(--primary)';

  renderMacroGrid(totals);
  renderMealList(food);
  renderWorkoutList(workouts);
  renderWeightProgress();
}

function renderMacroGrid(totals) {
  const macros = [
    { key: 'protein', label: 'Protein', unit: 'g' },
    { key: 'carbs', label: 'Carbs', unit: 'g' },
    { key: 'fat', label: 'Fat', unit: 'g' },
    { key: 'fiber', label: 'Fiber', unit: 'g' },
    { key: 'sugar', label: 'Sugar', unit: 'g' },
    { key: 'sodium', label: 'Sodium', unit: 'mg' },
  ];

  const grid = document.getElementById('macroGrid');
  grid.innerHTML = macros
    .map(({ key, label, unit }) => {
      const current = totals[key] || 0;
      const target = state.goals[key] || 0;
      const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
      const isOver = target > 0 && current > target;
      return `
        <div class="macro-item ${isOver ? 'over-goal' : ''}" data-macro="${key}">
          <div class="macro-header">
            <span class="macro-name">${label}</span>
            <span class="macro-values">${Math.round(current)}/${target}${unit}${isOver ? ' ⚠' : ''}</span>
          </div>
          <div class="macro-bar">
            <div class="macro-bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>`;
    })
    .join('');
}

function renderMealList(food) {
  const el = document.getElementById('mealList');
  if (!food.length) {
    el.innerHTML = '<div class="empty-state">No meals logged yet today</div>';
    return;
  }

  el.innerHTML = food
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(
      (e) => `
      <div class="entry-item">
        <div class="entry-icon ${e.mealType}">${MEAL_EMOJI[e.mealType] || '🍽️'}</div>
        <div class="entry-info">
          <div class="entry-name">${escapeHtml(e.name)}</div>
          <div class="entry-meta">${e.mealType} · P:${e.protein || 0}g C:${e.carbs || 0}g F:${e.fat || 0}g</div>
        </div>
        <div class="entry-calories">${e.calories} cal</div>
        <div class="entry-actions">
          <button class="icon-btn danger btn-sm" data-delete-food="${e.id}" aria-label="Delete">×</button>
        </div>
      </div>`
    )
    .join('');

  el.querySelectorAll('[data-delete-food]').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeFoodEntry(state, currentDate, btn.dataset.deleteFood);
      onUpdate?.();
    });
  });
}

function renderWorkoutList(workouts) {
  const el = document.getElementById('workoutList');
  if (!workouts.length) {
    el.innerHTML = '<div class="empty-state">No workouts logged yet today</div>';
    return;
  }

  el.innerHTML = workouts
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(
      (e) => `
      <div class="entry-item">
        <div class="entry-icon workout">${e.icon || '💪'}</div>
        <div class="entry-info">
          <div class="entry-name">${escapeHtml(e.name)}</div>
          <div class="entry-meta">${e.duration} min · ${formatTime(e.timestamp)}</div>
        </div>
        <div class="entry-calories burned">-${e.caloriesBurned} cal</div>
        <div class="entry-actions">
          <button class="icon-btn danger btn-sm" data-delete-workout="${e.id}" aria-label="Delete">×</button>
        </div>
      </div>`
    )
    .join('');

  el.querySelectorAll('[data-delete-workout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeWorkoutEntry(state, currentDate, btn.dataset.deleteWorkout);
      onUpdate?.();
    });
  });
}

function renderWeightProgress() {
  const el = document.getElementById('weightProgress');
  const latest = getLatestWeight(state);
  const { targetWeight, startWeight, weightGoalType } = state.goals;

  if (!latest || !targetWeight) {
    el.innerHTML = '<div class="empty-state">Set a weight goal to track progress</div>';
    return;
  }

  const current = latest.weight;
  const start = startWeight || current;
  let progress = 0;

  if (weightGoalType === 'lose') {
    const total = start - targetWeight;
    progress = total > 0 ? ((start - current) / total) * 100 : 0;
  } else if (weightGoalType === 'gain') {
    const total = targetWeight - start;
    progress = total > 0 ? ((current - start) / total) * 100 : 0;
  } else {
    const diff = Math.abs(current - targetWeight);
    progress = Math.max(0, 100 - diff * 10);
  }

  progress = Math.min(Math.max(progress, 0), 100);

  el.innerHTML = `
    <div class="weight-stats">
      <div><span>Current</span><br><strong>${current} ${latest.unit}</strong></div>
      <div style="text-align:center"><span>Progress</span><br><strong>${Math.round(progress)}%</strong></div>
      <div style="text-align:right"><span>Goal</span><br><strong>${targetWeight} ${latest.unit}</strong></div>
    </div>
    <div class="weight-goal-bar">
      <div class="weight-goal-fill" style="width: ${progress}%"></div>
    </div>`;
}

function renderFoodView() {
  const { food } = getEntriesForDate(state, currentDate);

  const recentEl = document.getElementById('recentFoods');
  if (!state.recentFoods.length) {
    recentEl.innerHTML = '<div class="empty-state">Your recent foods will appear here</div>';
  } else {
    recentEl.innerHTML = state.recentFoods
      .slice(0, 10)
      .map(
        (f, i) => `
        <div class="recent-food-item" data-recent-index="${i}">
          <span class="name">${escapeHtml(f.name)}</span>
          <span class="cals">${f.calories} cal</span>
        </div>`
      )
      .join('');

    recentEl.querySelectorAll('[data-recent-index]').forEach((item) => {
      item.addEventListener('click', () => {
        const foodData = state.recentFoods[parseInt(item.dataset.recentIndex)];
        showFoodModal(foodData);
      });
    });
  }

  const allEl = document.getElementById('allFoodEntries');
  if (!food.length) {
    allEl.innerHTML = '<div class="empty-state">No food entries for this day</div>';
  } else {
    allEl.innerHTML = renderEntryList(food, 'food');
  }
}

function renderWorkoutView() {
  const { workouts } = getEntriesForDate(state, currentDate);
  const totals = calculateDailyTotals([], workouts);

  document.getElementById('workoutSummary').innerHTML = `
    <div class="summary-card">
      <div class="summary-value">${totals.burned}</div>
      <div class="summary-label">Calories</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${totals.workoutMinutes}</div>
      <div class="summary-label">Minutes</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${totals.workoutCount}</div>
      <div class="summary-label">Sessions</div>
    </div>`;

  const allEl = document.getElementById('allWorkoutEntries');
  if (!workouts.length) {
    allEl.innerHTML = '<div class="empty-state">No workouts for this day</div>';
  } else {
    allEl.innerHTML = renderEntryList(workouts, 'workout');
  }

  document.getElementById('quickWorkouts').innerHTML = WORKOUT_PRESETS.map(
    (w) => `
    <button class="quick-workout-btn" data-preset='${JSON.stringify(w)}'>
      <strong>${w.icon} ${w.name}</strong>
      <span>${w.defaultDuration} min · ~${estimateCaloriesBurned(w.met, w.defaultDuration)} cal</span>
    </button>`
  ).join('');

  document.getElementById('quickWorkouts').querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = JSON.parse(btn.dataset.preset);
      quickAddWorkout(preset);
    });
  });

  renderWeeklyChart();
}

function renderWeeklyChart() {
  const dates = getWeekDates(new Date(currentDate + 'T12:00:00'));
  const maxBurn = Math.max(
    ...dates.map((d) => {
      const { workouts } = getEntriesForDate(state, d);
      return calculateDailyTotals([], workouts).burned;
    }),
    1
  );

  const today = currentDate;
  const el = document.getElementById('weeklyChart');
  el.innerHTML = dates
    .map((d) => {
      const { workouts } = getEntriesForDate(state, d);
      const burned = calculateDailyTotals([], workouts).burned;
      const height = (burned / maxBurn) * 100;
      const day = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      return `
        <div class="chart-bar-group">
          <span class="chart-value">${burned || ''}</span>
          <div class="chart-bar-wrap">
            <div class="chart-bar ${d === today ? 'today' : ''}" style="height: ${Math.max(height, 4)}%"></div>
          </div>
          <span class="chart-label">${day}</span>
        </div>`;
    })
    .join('');
}

function renderGoalsView() {
  renderWeightGoalSection();
  renderNutritionGoalsForm();
  renderWeightHistory();
  renderMeasurementsForm();
}

function renderWeightGoalSection() {
  const el = document.getElementById('weightGoalSection');
  const latest = getLatestWeight(state);
  const unit = state.settings.weightUnit;

  el.innerHTML = `
    <form id="weightGoalForm" class="form-grid">
      <div class="form-row">
        <label class="field">
          <span>Goal Type</span>
          <select id="weightGoalType">
            <option value="lose" ${state.goals.weightGoalType === 'lose' ? 'selected' : ''}>Lose Weight</option>
            <option value="maintain" ${state.goals.weightGoalType === 'maintain' ? 'selected' : ''}>Maintain</option>
            <option value="gain" ${state.goals.weightGoalType === 'gain' ? 'selected' : ''}>Gain Weight</option>
          </select>
        </label>
        <label class="field">
          <span>Target Weight (${unit})</span>
          <input type="number" id="targetWeight" step="0.1" value="${state.goals.targetWeight || ''}" placeholder="Target">
        </label>
      </div>
      <div class="form-row">
        <label class="field">
          <span>Starting Weight (${unit})</span>
          <input type="number" id="startWeight" step="0.1" value="${state.goals.startWeight || latest?.weight || ''}" placeholder="Start">
        </label>
        <label class="field">
          <span>Weekly Change (${unit})</span>
          <input type="number" id="weeklyChange" step="0.1" value="${state.goals.weeklyWeightChange || 1}" min="0">
        </label>
      </div>
      <button type="submit" class="btn btn-primary">Save Weight Goal</button>
    </form>`;

  document.getElementById('weightGoalForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.goals.weightGoalType = document.getElementById('weightGoalType').value;
    state.goals.targetWeight = parseFloat(document.getElementById('targetWeight').value) || null;
    state.goals.startWeight = parseFloat(document.getElementById('startWeight').value) || null;
    state.goals.weeklyWeightChange = parseFloat(document.getElementById('weeklyChange').value) || 1;
    saveState(state);
    showToast('Weight goal saved');
    onUpdate?.();
  });
}

function renderNutritionGoalsForm() {
  const form = document.getElementById('nutritionGoalsForm');
  const fields = [
    { id: 'goalCalories', key: 'calories', label: 'Daily Calories', unit: 'cal' },
    { id: 'goalProtein', key: 'protein', label: 'Protein', unit: 'g' },
    { id: 'goalCarbs', key: 'carbs', label: 'Carbs', unit: 'g' },
    { id: 'goalFat', key: 'fat', label: 'Fat', unit: 'g' },
    { id: 'goalFiber', key: 'fiber', label: 'Fiber', unit: 'g' },
    { id: 'goalSugar', key: 'sugar', label: 'Sugar', unit: 'g' },
    { id: 'goalSodium', key: 'sodium', label: 'Sodium', unit: 'mg' },
  ];

  const tdee = calculateTDEE(state.profile, state);

  form.innerHTML = `
    <p class="hint">Estimated TDEE: ${tdee} cal/day based on your profile</p>
    <div class="form-row">
      ${fields
        .slice(0, 2)
        .map(
          (f) => `
        <label class="field">
          <span>${f.label} (${f.unit})</span>
          <input type="number" id="${f.id}" value="${state.goals[f.key]}" min="0">
        </label>`
        )
        .join('')}
    </div>
    <div class="form-row">
      ${fields
        .slice(2, 4)
        .map(
          (f) => `
        <label class="field">
          <span>${f.label} (${f.unit})</span>
          <input type="number" id="${f.id}" value="${state.goals[f.key]}" min="0">
        </label>`
        )
        .join('')}
    </div>
    <div class="form-row">
      ${fields
        .slice(4)
        .map(
          (f) => `
        <label class="field">
          <span>${f.label} (${f.unit})</span>
          <input type="number" id="${f.id}" value="${state.goals[f.key]}" min="0">
        </label>`
        )
        .join('')}
    </div>
    <button type="button" class="btn btn-secondary" id="autoCalcMacros">Auto-calculate from TDEE</button>
    <button type="submit" class="btn btn-primary">Save Nutrition Goals</button>`;

  form.onsubmit = (e) => {
    e.preventDefault();
    fields.forEach((f) => {
      state.goals[f.key] = parseInt(document.getElementById(f.id).value) || 0;
    });
    saveState(state);
    showToast('Nutrition goals saved');
    onUpdate?.();
  };

  document.getElementById('autoCalcMacros').addEventListener('click', () => {
    const cals = tdee;
    document.getElementById('goalCalories').value = cals;
    document.getElementById('goalProtein').value = Math.round((cals * 0.3) / 4);
    document.getElementById('goalCarbs').value = Math.round((cals * 0.4) / 4);
    document.getElementById('goalFat').value = Math.round((cals * 0.3) / 9);
    showToast('Macros calculated from TDEE');
  });
}

function renderWeightHistory() {
  const el = document.getElementById('weightHistory');
  if (!state.weightLog.length) {
    el.innerHTML = '<div class="empty-state">No weight entries yet</div>';
    return;
  }

  el.innerHTML = state.weightLog
    .slice(0, 14)
    .map(
      (w) => `
      <div class="weight-entry">
        <span>${formatDateDisplay(w.date)}</span>
        <strong>${w.weight} ${w.unit}</strong>
      </div>`
    )
    .join('');
}

function renderMeasurementsForm() {
  const form = document.getElementById('measurementsForm');
  const fields = ['chest', 'waist', 'hips', 'arms', 'thighs'];

  form.innerHTML = fields
    .map(
      (f) => `
    <label class="field">
      <span>${f.charAt(0).toUpperCase() + f.slice(1)} (in)</span>
      <input type="number" id="measure_${f}" step="0.1" value="${state.measurements[f] || ''}" placeholder="Optional">
    </label>`
    )
    .join('') + `<button type="submit" class="btn btn-primary">Save Measurements</button>`;

  form.onsubmit = (e) => {
    e.preventDefault();
    fields.forEach((f) => {
      const val = parseFloat(document.getElementById(`measure_${f}`).value);
      state.measurements[f] = val || null;
    });
    saveState(state);
    showToast('Measurements saved');
  };
}

function renderProfileView() {
  const form = document.getElementById('profileForm');
  const p = state.profile;
  const heightUnit = normalizeHeightUnit(p.heightUnit);
  const { ft, in: inches } =
    heightUnit === 'cm' ? { ft: '', in: '' } : inchesToFtIn(p.height);

  form.innerHTML = `
    <label class="field">
      <span>Name</span>
      <input type="text" id="profileName" value="${escapeHtml(p.name)}" placeholder="Your name">
    </label>
    <div class="form-row">
      <label class="field">
        <span>Age</span>
        <input type="number" id="profileAge" value="${p.age || ''}" min="1" max="120" placeholder="Age">
      </label>
      <label class="field">
        <span>Gender</span>
        <select id="profileGender">
          <option value="male" ${p.gender === 'male' ? 'selected' : ''}>Male</option>
          <option value="female" ${p.gender === 'female' ? 'selected' : ''}>Female</option>
          <option value="other" ${p.gender === 'other' ? 'selected' : ''}>Other</option>
        </select>
      </label>
    </div>
    <label class="field">
      <span>Height format</span>
      <select id="profileHeightUnit">
        <option value="imperial" ${heightUnit === 'imperial' ? 'selected' : ''}>Feet & inches</option>
        <option value="cm" ${heightUnit === 'cm' ? 'selected' : ''}>Centimeters</option>
      </select>
    </label>
    <div id="heightImperialFields" class="form-row ${heightUnit === 'cm' ? 'hidden' : ''}">
      <label class="field">
        <span>Feet</span>
        <input type="number" id="profileHeightFt" value="${ft !== '' ? ft : ''}" min="0" max="8" placeholder="5">
      </label>
      <label class="field">
        <span>Inches</span>
        <input type="number" id="profileHeightIn" value="${inches !== '' ? inches : ''}" min="0" max="11" placeholder="10">
      </label>
    </div>
    <label class="field ${heightUnit === 'cm' ? '' : 'hidden'}" id="heightCmField">
      <span>Height (cm)</span>
      <input type="number" id="profileHeightCm" value="${heightUnit === 'cm' ? p.height || '' : ''}" min="1" max="300" step="0.1" placeholder="175">
    </label>
    <label class="field">
      <span>Activity Level</span>
      <select id="profileActivity">
        <option value="sedentary" ${p.activityLevel === 'sedentary' ? 'selected' : ''}>Sedentary</option>
        <option value="light" ${p.activityLevel === 'light' ? 'selected' : ''}>Lightly Active</option>
        <option value="moderate" ${p.activityLevel === 'moderate' ? 'selected' : ''}>Moderately Active</option>
        <option value="active" ${p.activityLevel === 'active' ? 'selected' : ''}>Very Active</option>
        <option value="veryActive" ${p.activityLevel === 'veryActive' ? 'selected' : ''}>Extra Active</option>
      </select>
    </label>
    <button type="submit" class="btn btn-primary">Save Profile</button>`;

  const unitSelect = document.getElementById('profileHeightUnit');
  unitSelect.addEventListener('change', toggleHeightFields);

  form.onsubmit = (e) => {
    e.preventDefault();
    state.profile.name = document.getElementById('profileName').value;
    state.profile.age = parseInt(document.getElementById('profileAge').value) || null;
    state.profile.gender = document.getElementById('profileGender').value;
    state.profile.heightUnit = unitSelect.value;

    if (state.profile.heightUnit === 'cm') {
      state.profile.height = parseFloat(document.getElementById('profileHeightCm').value) || null;
    } else {
      state.profile.height = ftInToInches(
        document.getElementById('profileHeightFt').value,
        document.getElementById('profileHeightIn').value
      );
    }

    state.profile.activityLevel = document.getElementById('profileActivity').value;
    saveState(state);
    showToast('Profile saved');
    onUpdate?.();
  };

  renderAISettingsForm();
}

function toggleHeightFields() {
  const unit = document.getElementById('profileHeightUnit').value;
  document.getElementById('heightImperialFields')?.classList.toggle('hidden', unit === 'cm');
  document.getElementById('heightCmField')?.classList.toggle('hidden', unit !== 'cm');
}

function renderAISettingsForm() {
  const presetSelect = document.getElementById('aiModelPreset');
  const customField = document.getElementById('aiModelCustomField');
  const customInput = document.getElementById('aiModelCustom');
  if (!presetSelect) return;

  const savedModel = state.settings.aiModel || AI_MODEL_PRESETS[0].id;
  const isPreset = AI_MODEL_PRESETS.some((m) => m.id === savedModel);

  presetSelect.innerHTML =
    AI_MODEL_PRESETS.map(
      (m) => `<option value="${m.id}" ${savedModel === m.id ? 'selected' : ''}>${m.label}</option>`
    ).join('') + `<option value="custom" ${!isPreset ? 'selected' : ''}>Custom model…</option>`;

  if (customInput) {
    customInput.value = isPreset ? '' : savedModel;
  }

  customField?.classList.toggle('hidden', isPreset);

  presetSelect.onchange = () => {
    const isCustom = presetSelect.value === 'custom';
    customField?.classList.toggle('hidden', !isCustom);
    if (isCustom) customInput?.focus();
  };

  document.getElementById('openrouterKey').value = state.settings.openrouterKey;
}

function renderEntryList(entries, type) {
  if (type === 'food') {
    return `<div class="entry-list">${entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(
        (e) => `
        <div class="entry-item">
          <div class="entry-icon ${e.mealType}">${MEAL_EMOJI[e.mealType] || '🍽️'}</div>
          <div class="entry-info">
            <div class="entry-name">${escapeHtml(e.name)}</div>
            <div class="entry-meta">${e.mealType} · ${formatTime(e.timestamp)}</div>
          </div>
          <div class="entry-calories">${e.calories} cal</div>
        </div>`
      )
      .join('')}</div>`;
  }

  return `<div class="entry-list">${entries
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(
      (e) => `
      <div class="entry-item">
        <div class="entry-icon workout">${e.icon || '💪'}</div>
        <div class="entry-info">
          <div class="entry-name">${escapeHtml(e.name)}</div>
          <div class="entry-meta">${e.duration} min · ${formatTime(e.timestamp)}</div>
        </div>
        <div class="entry-calories burned">-${e.caloriesBurned} cal</div>
      </div>`
    )
    .join('')}</div>`;
}

/* Modals */
export function showModal(title, bodyHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

export function showFoodModal(prefill = {}) {
  let servings = 1;
  let selectedMeal = getDefaultMealType();
  const data = { ...prefill };

  function renderForm() {
    const mult = servings;
    return `
      <div class="meal-type-selector">
        ${MEAL_TYPES.map(
          (m) => `
          <button type="button" class="meal-type-btn ${selectedMeal === m ? 'active' : ''}" data-meal="${m}">
            ${MEAL_EMOJI[m]} ${m}
          </button>`
        ).join('')}
      </div>
      <form id="foodForm" class="form-grid">
        <label class="field">
          <span>Food Name</span>
          <input type="text" id="foodName" value="${escapeHtml(data.name || '')}" required placeholder="e.g. Greek Yogurt">
        </label>
        <label class="field">
          <span>Serving Size</span>
          <input type="text" id="foodServing" value="${escapeHtml(data.servingSize || '')}" placeholder="e.g. 1 cup">
        </label>
        <div class="serving-controls">
          <button type="button" id="servingMinus">−</button>
          <span>${servings} serving${servings !== 1 ? 's' : ''}</span>
          <button type="button" id="servingPlus">+</button>
        </div>
        <div class="form-row">
          <label class="field">
            <span>Calories</span>
            <input type="number" id="foodCalories" value="${Math.round((data.calories || 0) * mult)}" min="0" required>
          </label>
          <label class="field">
            <span>Protein (g)</span>
            <input type="number" id="foodProtein" value="${Math.round((data.protein || 0) * mult)}" min="0" step="0.1">
          </label>
        </div>
        <div class="form-row">
          <label class="field">
            <span>Carbs (g)</span>
            <input type="number" id="foodCarbs" value="${Math.round((data.carbs || 0) * mult)}" min="0" step="0.1">
          </label>
          <label class="field">
            <span>Fat (g)</span>
            <input type="number" id="foodFat" value="${Math.round((data.fat || 0) * mult)}" min="0" step="0.1">
          </label>
        </div>
        <div class="form-row">
          <label class="field">
            <span>Fiber (g)</span>
            <input type="number" id="foodFiber" value="${Math.round((data.fiber || 0) * mult)}" min="0" step="0.1">
          </label>
          <label class="field">
            <span>Sugar (g)</span>
            <input type="number" id="foodSugar" value="${Math.round((data.sugar || 0) * mult)}" min="0" step="0.1">
          </label>
        </div>
        <label class="field">
          <span>Sodium (mg)</span>
          <input type="number" id="foodSodium" value="${Math.round((data.sodium || 0) * mult)}" min="0">
        </label>
        <button type="submit" class="btn btn-primary btn-block">Add Food</button>
      </form>`;
  }

  showModal('Add Food', renderForm());
  bindFoodFormEvents();

  function bindFoodFormEvents() {
    document.querySelectorAll('.meal-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedMeal = btn.dataset.meal;
        showModal('Add Food', renderForm());
        bindFoodFormEvents();
      });
    });

    document.getElementById('servingMinus')?.addEventListener('click', () => {
      if (servings > 0.5) servings -= 0.5;
      showModal('Add Food', renderForm());
      bindFoodFormEvents();
    });

    document.getElementById('servingPlus')?.addEventListener('click', () => {
      servings += 0.5;
      showModal('Add Food', renderForm());
      bindFoodFormEvents();
    });

    document.getElementById('foodForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      addFoodEntry(state, currentDate, {
        name: document.getElementById('foodName').value,
        servingSize: document.getElementById('foodServing').value,
        servings,
        mealType: selectedMeal,
        calories: parseInt(document.getElementById('foodCalories').value) || 0,
        protein: parseFloat(document.getElementById('foodProtein').value) || 0,
        carbs: parseFloat(document.getElementById('foodCarbs').value) || 0,
        fat: parseFloat(document.getElementById('foodFat').value) || 0,
        fiber: parseFloat(document.getElementById('foodFiber').value) || 0,
        sugar: parseFloat(document.getElementById('foodSugar').value) || 0,
        sodium: parseInt(document.getElementById('foodSodium').value) || 0,
      });
      closeModal();
      showToast('Food added!', 'success');
      onUpdate?.();
    });
  }
}

export function showQuickAddModal() {
  showModal(
    'Quick Add Calories',
    `
    <form id="quickAddForm" class="form-grid">
      <label class="field">
        <span>Description (optional)</span>
        <input type="text" id="quickName" placeholder="e.g. Coffee with cream">
      </label>
      <label class="field">
        <span>Calories</span>
        <input type="number" id="quickCalories" min="1" required placeholder="Calories">
      </label>
      <div class="meal-type-selector">
        ${MEAL_TYPES.map(
          (m) => `
          <button type="button" class="meal-type-btn ${m === getDefaultMealType() ? 'active' : ''}" data-meal="${m}">
            ${MEAL_EMOJI[m]} ${m}
          </button>`
        ).join('')}
      </div>
      <button type="submit" class="btn btn-primary btn-block">Add</button>
    </form>`
  );

  let meal = getDefaultMealType();
  document.querySelectorAll('.meal-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      meal = btn.dataset.meal;
      document.querySelectorAll('.meal-type-btn').forEach((b) => b.classList.toggle('active', b.dataset.meal === meal));
    });
  });

  document.getElementById('quickAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    addFoodEntry(state, currentDate, {
      name: document.getElementById('quickName').value || 'Quick Add',
      mealType: meal,
      calories: parseInt(document.getElementById('quickCalories').value) || 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    closeModal();
    showToast('Calories added!', 'success');
    onUpdate?.();
  });
}

export function showWorkoutModal(preset = null) {
  const latest = getLatestWeight(state);
  const weightLbs = latest ? (latest.unit === 'kg' ? latest.weight * 2.205 : latest.weight) : 160;

  showModal(
    'Log Workout',
    `
    <form id="workoutForm" class="form-grid">
      <label class="field">
        <span>Workout Name</span>
        <input type="text" id="workoutName" value="${preset ? escapeHtml(preset.name) : ''}" required placeholder="e.g. Morning Run">
      </label>
      <div class="form-row">
        <label class="field">
          <span>Duration (minutes)</span>
          <input type="number" id="workoutDuration" value="${preset?.defaultDuration || 30}" min="1" required>
        </label>
        <label class="field">
          <span>Calories Burned</span>
          <input type="number" id="workoutCalories" value="${preset ? estimateCaloriesBurned(preset.met, preset.defaultDuration, weightLbs) : ''}" min="0" required>
        </label>
      </div>
      <label class="field">
        <span>Notes (optional)</span>
        <textarea id="workoutNotes" placeholder="How did it go?"></textarea>
      </label>
      <button type="submit" class="btn btn-primary btn-block">Log Workout</button>
    </form>`
  );

  const durationInput = document.getElementById('workoutDuration');
  const caloriesInput = document.getElementById('workoutCalories');

  if (preset) {
    durationInput.addEventListener('input', () => {
      caloriesInput.value = estimateCaloriesBurned(preset.met, parseInt(durationInput.value) || 0, weightLbs);
    });
  }

  document.getElementById('workoutForm').addEventListener('submit', (e) => {
    e.preventDefault();
    addWorkoutEntry(state, currentDate, {
      name: document.getElementById('workoutName').value,
      duration: parseInt(document.getElementById('workoutDuration').value) || 0,
      caloriesBurned: parseInt(document.getElementById('workoutCalories').value) || 0,
      notes: document.getElementById('workoutNotes').value,
      icon: preset?.icon || '💪',
    });
    closeModal();
    showToast('Workout logged!', 'success');
    onUpdate?.();
  });
}

export function showScanLabelModal() {
  if (!state.settings.openrouterKey) {
    showModal(
      'API Key Required',
      `<p class="hint">Add your OpenRouter API key in Profile settings to use AI label scanning.</p>
       <button class="btn btn-primary btn-block" id="goToProfile">Go to Profile</button>`
    );
    document.getElementById('goToProfile').addEventListener('click', () => {
      closeModal();
      navigateTo('profile');
    });
    return;
  }

  showModal(
    'Scan Food Label',
    `
    <p class="hint">Take a photo or upload an image of a nutrition label. AI will read and fill in the details.</p>
    <div class="scan-actions">
      <button class="btn btn-primary" id="takePhotoBtn">📷 Take Photo</button>
      <button class="btn btn-secondary" id="uploadPhotoBtn">🖼️ Upload</button>
    </div>
    <div id="scanPreview"></div>`
  );
}

export async function handleLabelImage(file) {
  const preview = document.getElementById('scanPreview');
  preview.innerHTML = `
    <div class="scan-preview"><img src="${URL.createObjectURL(file)}" alt="Label preview"></div>
    <div class="ai-loading">
      <div class="spinner"></div>
      <span>AI is reading the label...</span>
    </div>`;

  try {
    let base64 = await fileToBase64(file);
    base64 = await compressImage(base64);

    const nutrition = await scanFoodLabel(
      base64,
      state.settings.openrouterKey,
      state.settings.aiModel
    );

    closeModal();
    showFoodModal(nutrition);
    showToast(`Label scanned (${nutrition.confidence} confidence)`, 'success');
  } catch (err) {
    preview.innerHTML = `
      <div class="empty-state" style="color: var(--danger)">${escapeHtml(err.message)}</div>
      <button class="btn btn-secondary btn-block" id="retryScan">Try Again</button>`;
    document.getElementById('retryScan')?.addEventListener('click', () => showScanLabelModal());
  }
}

function quickAddWorkout(preset) {
  const latest = getLatestWeight(state);
  const weightLbs = latest ? (latest.unit === 'kg' ? latest.weight * 2.205 : latest.weight) : 160;

  addWorkoutEntry(state, currentDate, {
    name: preset.name,
    duration: preset.defaultDuration,
    caloriesBurned: estimateCaloriesBurned(preset.met, preset.defaultDuration, weightLbs),
    icon: preset.icon,
  });
  showToast(`${preset.name} logged!`, 'success');
  onUpdate?.();
}

function getDefaultMealType() {
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 20) return 'dinner';
  return 'snack';
}

export function navigateTo(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.nav === view);
  });
}

export function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

export function handleWeightLog(e) {
  e.preventDefault();
  const weight = parseFloat(document.getElementById('weightInput').value);
  const unit = document.getElementById('weightUnit').value;
  if (!weight) return;

  addWeightEntry(state, weight, unit);
  state.settings.weightUnit = unit;
  document.getElementById('weightInput').value = '';
  showToast('Weight logged!', 'success');
  onUpdate?.();
}

export function handleAISettings(e) {
  e.preventDefault();
  const preset = document.getElementById('aiModelPreset').value;
  const custom = document.getElementById('aiModelCustom').value.trim();

  state.settings.openrouterKey = document.getElementById('openrouterKey').value.trim();
  state.settings.aiModel = preset === 'custom' ? custom : preset;

  if (!state.settings.aiModel) {
    showToast('Enter a model ID or pick a preset', 'error');
    return;
  }

  saveState(state);
  renderAISettingsForm();
  renderCoachView();
  showToast('AI settings saved', 'success');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
