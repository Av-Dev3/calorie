const STORAGE_KEY = 'calorietrack_data';

const DEFAULT_STATE = {
  profile: {
    name: '',
    age: null,
    gender: 'other',
    height: null,
    heightUnit: 'imperial',
    activityLevel: 'moderate',
  },
  settings: {
    openrouterKey: '',
    aiModel: 'google/gemini-2.0-flash-001',
    weightUnit: 'lbs',
    lastKnownDay: null,
  },
  goals: {
    calories: 2000,
    protein: 150,
    carbs: 200,
    fat: 65,
    fiber: 25,
    sugar: 50,
    sodium: 2300,
    targetWeight: null,
    startWeight: null,
    weightGoalType: 'lose',
    weeklyWeightChange: 1,
  },
  measurements: {
    chest: null,
    waist: null,
    hips: null,
    arms: null,
    thighs: null,
  },
  foodEntries: {},
  workoutEntries: {},
  weightLog: [],
  recentFoods: [],
  favoriteFoods: [],
  chatHistory: [],
};

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return deepMerge(structuredClone(DEFAULT_STATE), parsed);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getYesterdayKey(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() - 1);
  return getDateKey(d);
}

export function getMsUntilMidnight(from = new Date()) {
  const midnight = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 0, 0);
  return Math.max(midnight.getTime() - from.getTime(), 1000);
}

export function isToday(dateKey) {
  return dateKey === getDateKey();
}

export function getEntriesForDate(state, dateKey) {
  return {
    food: state.foodEntries[dateKey] || [],
    workouts: state.workoutEntries[dateKey] || [],
  };
}

export function addFoodEntry(state, dateKey, entry) {
  if (!state.foodEntries[dateKey]) state.foodEntries[dateKey] = [];
  const id = crypto.randomUUID();
  const fullEntry = { id, ...entry, timestamp: Date.now() };
  state.foodEntries[dateKey].push(fullEntry);
  addToRecentFoods(state, entry);
  saveState(state);
  return fullEntry;
}

export function removeFoodEntry(state, dateKey, id) {
  if (!state.foodEntries[dateKey]) return;
  state.foodEntries[dateKey] = state.foodEntries[dateKey].filter(e => e.id !== id);
  saveState(state);
}

export function addWorkoutEntry(state, dateKey, entry) {
  if (!state.workoutEntries[dateKey]) state.workoutEntries[dateKey] = [];
  const id = crypto.randomUUID();
  const fullEntry = { id, ...entry, timestamp: Date.now() };
  state.workoutEntries[dateKey].push(fullEntry);
  saveState(state);
  return fullEntry;
}

export function removeWorkoutEntry(state, dateKey, id) {
  if (!state.workoutEntries[dateKey]) return;
  state.workoutEntries[dateKey] = state.workoutEntries[dateKey].filter(e => e.id !== id);
  saveState(state);
}

export function addWeightEntry(state, weight, unit) {
  const entry = {
    id: crypto.randomUUID(),
    weight,
    unit,
    date: getDateKey(),
    timestamp: Date.now(),
  };
  state.weightLog.unshift(entry);
  if (state.weightLog.length > 365) state.weightLog.length = 365;
  saveState(state);
  return entry;
}

export function addToRecentFoods(state, food) {
  const existing = state.recentFoods.findIndex(
    f => f.name.toLowerCase() === food.name.toLowerCase()
  );
  const item = {
    name: food.name,
    calories: food.calories,
    protein: food.protein || 0,
    carbs: food.carbs || 0,
    fat: food.fat || 0,
    fiber: food.fiber || 0,
    sugar: food.sugar || 0,
    sodium: food.sodium || 0,
    servingSize: food.servingSize || '',
    lastUsed: Date.now(),
  };
  if (existing >= 0) {
    state.recentFoods[existing] = item;
  } else {
    state.recentFoods.unshift(item);
  }
  if (state.recentFoods.length > 20) state.recentFoods.length = 20;
}

export function isFavoriteFood(state, name) {
  if (!state.favoriteFoods?.length || !name) return false;
  const key = name.toLowerCase();
  return state.favoriteFoods.some((f) => f.name.toLowerCase() === key);
}

function normalizeFavoriteFood(food, existingId) {
  return {
    id: existingId || food.id || crypto.randomUUID(),
    name: food.name || 'Food',
    calories: Number(food.calories) || 0,
    protein: Number(food.protein) || 0,
    carbs: Number(food.carbs) || 0,
    fat: Number(food.fat) || 0,
    fiber: Number(food.fiber) || 0,
    sugar: Number(food.sugar) || 0,
    sodium: Number(food.sodium) || 0,
    servingSize: food.servingSize || '',
    servings: Number(food.servings) || 1,
    mealType: food.mealType || 'snack',
  };
}

export function addFavoriteFood(state, food) {
  if (!state.favoriteFoods) state.favoriteFoods = [];
  const item = normalizeFavoriteFood(food);
  const existing = state.favoriteFoods.findIndex(
    (f) => f.name.toLowerCase() === item.name.toLowerCase()
  );
  if (existing >= 0) {
    item.id = state.favoriteFoods[existing].id;
    state.favoriteFoods[existing] = item;
  } else {
    state.favoriteFoods.unshift(item);
  }
  if (state.favoriteFoods.length > 50) state.favoriteFoods.length = 50;
  saveState(state);
  return item;
}

export function updateFavoriteFood(state, id, food) {
  if (!state.favoriteFoods) return null;
  const idx = state.favoriteFoods.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  const item = normalizeFavoriteFood({ ...state.favoriteFoods[idx], ...food }, id);
  state.favoriteFoods[idx] = item;
  saveState(state);
  return item;
}

export function removeFavoriteFood(state, id) {
  if (!state.favoriteFoods) return;
  state.favoriteFoods = state.favoriteFoods.filter((f) => f.id !== id);
  saveState(state);
}

export function getFavoriteFood(state, id) {
  return state.favoriteFoods?.find((f) => f.id === id) || null;
}

export function calculateDailyTotals(foodEntries, workoutEntries) {
  const food = foodEntries.reduce(
    (acc, e) => ({
      calories: acc.calories + (e.calories || 0),
      protein: acc.protein + (e.protein || 0),
      carbs: acc.carbs + (e.carbs || 0),
      fat: acc.fat + (e.fat || 0),
      fiber: acc.fiber + (e.fiber || 0),
      sugar: acc.sugar + (e.sugar || 0),
      sodium: acc.sodium + (e.sodium || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 }
  );

  const burned = workoutEntries.reduce((sum, e) => sum + (e.caloriesBurned || 0), 0);
  const workoutMinutes = workoutEntries.reduce((sum, e) => sum + (e.duration || 0), 0);

  return { ...food, burned, workoutMinutes, workoutCount: workoutEntries.length };
}

export function calculateTDEE(profile, state) {
  const { age, gender, height, heightUnit, activityLevel } = profile;
  if (!age || !height) return 2000;

  let weightKg = 70;
  const latestWeight = getLatestWeight(state || loadState());
  if (latestWeight) {
    weightKg = latestWeight.unit === 'kg' ? latestWeight.weight : latestWeight.weight * 0.453592;
  }

  const heightCm = heightToCm(height, heightUnit) ?? 0;

  let bmr;
  if (gender === 'male') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  } else if (gender === 'female') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  } else {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 78;
  }

  const multipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    veryActive: 1.9,
  };

  return Math.round(bmr * (multipliers[activityLevel] || 1.55));
}

export function heightToCm(height, heightUnit) {
  if (!height) return null;
  const unit = heightUnit === 'cm' ? 'cm' : 'imperial';
  return unit === 'cm' ? height : height * 2.54;
}

export function inchesToFtIn(totalInches) {
  if (!totalInches && totalInches !== 0) return { ft: '', in: '' };
  const ft = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return { ft, in: inches === 12 ? 0 : inches };
}

export function ftInToInches(ft, inches) {
  const f = parseInt(ft) || 0;
  const i = parseInt(inches) || 0;
  if (f === 0 && i === 0) return null;
  return f * 12 + i;
}

export function normalizeHeightUnit(unit) {
  return unit === 'cm' ? 'cm' : 'imperial';
}

export function getLatestWeight(state) {
  return state.weightLog.length > 0 ? state.weightLog[0] : null;
}

export function exportData(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calorietrack-export-${getDateKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function clearAllData() {
  localStorage.removeItem(STORAGE_KEY);
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

export function getWeekDates(endDate = new Date()) {
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    dates.push(getDateKey(d));
  }
  return dates;
}

export function getWeeklyReport(state, endDateKey = getDateKey()) {
  const dates = getWeekDates(new Date(endDateKey + 'T12:00:00'));
  const calorieGoal = state.goals.calories;

  const days = dates.map((dateKey) => {
    const { food, workouts } = getEntriesForDate(state, dateKey);
    const totals = calculateDailyTotals(food, workouts);
    const net = totals.calories - totals.burned;
    const overBy = Math.max(0, net - calorieGoal);
    return {
      dateKey,
      ...totals,
      net,
      overBy,
      overGoal: net > calorieGoal,
      hasData: totals.calories > 0 || totals.burned > 0,
    };
  });

  const loggedDays = days.filter((d) => d.hasData);
  const overGoalDays = days.filter((d) => d.overGoal);

  const sum = (arr, key) => arr.reduce((s, d) => s + (d[key] || 0), 0);
  const avg = (arr, key) => (arr.length ? Math.round(sum(arr, key) / arr.length) : 0);

  return {
    dates,
    days,
    startDate: dates[0],
    endDate: dates[6],
    calorieGoal,
    macroGoals: {
      protein: state.goals.protein,
      carbs: state.goals.carbs,
      fat: state.goals.fat,
    },
    avgCalories: avg(loggedDays, 'calories'),
    avgNet: avg(loggedDays, 'net'),
    avgProtein: avg(loggedDays, 'protein'),
    avgCarbs: avg(loggedDays, 'carbs'),
    avgFat: avg(loggedDays, 'fat'),
    avgBurned: avg(loggedDays, 'burned'),
    totalCalories: sum(days, 'calories'),
    totalBurned: sum(days, 'burned'),
    daysLogged: loggedDays.length,
    daysOverGoal: overGoalDays.length,
    totalOverGoal: sum(overGoalDays, 'overBy'),
    onTargetDays: days.filter((d) => d.hasData && !d.overGoal).length,
    overGoalDays,
  };
}

export function formatWeekRange(startDate, endDate) {
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  const opts = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', { ...opts, year: start.getFullYear() !== end.getFullYear() ? 'numeric' : undefined });
  return `${startStr} – ${endStr}`;
}

export function formatShortDay(dateKey) {
  return new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}

export function formatDateDisplay(dateKey) {
  const d = new Date(dateKey + 'T12:00:00');
  const today = getDateKey();
  const yesterday = getYesterdayKey();

  if (dateKey === today) return 'Today';
  if (dateKey === yesterday) return 'Yesterday';

  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_EMOJI = {
  breakfast: '🌅',
  lunch: '☀️',
  dinner: '🌙',
  snack: '🍎',
};

export const WORKOUT_PRESETS = [
  { name: 'Running', icon: '🏃', met: 9.8, defaultDuration: 30 },
  { name: 'Walking', icon: '🚶', met: 3.5, defaultDuration: 30 },
  { name: 'Cycling', icon: '🚴', met: 7.5, defaultDuration: 45 },
  { name: 'Swimming', icon: '🏊', met: 8.0, defaultDuration: 30 },
  { name: 'Weight Training', icon: '🏋️', met: 6.0, defaultDuration: 45 },
  { name: 'Yoga', icon: '🧘', met: 3.0, defaultDuration: 60 },
  { name: 'HIIT', icon: '⚡', met: 10.0, defaultDuration: 20 },
  { name: 'Elliptical', icon: '🔄', met: 5.0, defaultDuration: 30 },
];

export function estimateCaloriesBurned(met, durationMinutes, weightLbs = 160) {
  const weightKg = weightLbs * 0.453592;
  return Math.round(met * weightKg * (durationMinutes / 60));
}

export function getCoachContext(state, dateKey) {
  const { food, workouts } = getEntriesForDate(state, dateKey);
  const totals = calculateDailyTotals(food, workouts);
  const report = getWeeklyReport(state, dateKey);
  const latestWeight = getLatestWeight(state);
  const net = totals.calories - totals.burned;
  const goals = state.goals;

  const today = {
    eaten: totals.calories,
    burned: totals.burned,
    net,
    remainingCalories: goals.calories - net,
    overGoal: net > goals.calories,
    protein: totals.protein,
    carbs: totals.carbs,
    fat: totals.fat,
    proteinRemaining: goals.protein - totals.protein,
    carbsRemaining: goals.carbs - totals.carbs,
    fatRemaining: goals.fat - totals.fat,
  };

  const mealsToday = food.map((f) => ({
    name: f.name,
    calories: f.calories,
    protein: f.protein || 0,
    carbs: f.carbs || 0,
    fat: f.fat || 0,
    mealType: f.mealType,
    servings: f.servings || 1,
  }));

  const workoutsToday = workouts.map((w) => ({
    name: w.name,
    duration: w.duration,
    caloriesBurned: w.caloriesBurned,
  }));

  const context = {
    date: dateKey,
    profile: state.profile,
    goals,
    today,
    weekly: {
      avgCalories: report.avgCalories,
      daysOverGoal: report.daysOverGoal,
      onTargetDays: report.onTargetDays,
    },
    latestWeight: latestWeight ? { weight: latestWeight.weight, unit: latestWeight.unit } : null,
    mealsToday,
    workoutsToday,
  };

  context.summary = formatCoachContextSummary(context);
  return context;
}

export function formatCoachContextSummary(context) {
  const { date, goals, today, mealsToday, workoutsToday, latestWeight, weekly } = context;
  const mealLines =
    mealsToday.length > 0
      ? mealsToday
          .map(
            (m) =>
              `  - ${m.mealType}: ${m.name} — ${m.calories} cal (P${Math.round(m.protein)} C${Math.round(m.carbs)} F${Math.round(m.fat)})`
          )
          .join('\n')
      : '  - (none logged yet)';
  const workoutLines =
    workoutsToday.length > 0
      ? workoutsToday
          .map((w) => `  - ${w.name}: ${w.duration} min, ${w.caloriesBurned} cal burned`)
          .join('\n')
      : '  - (none logged yet)';

  return [
    `Date: ${date}`,
    `Calorie goal: ${goals.calories} | Eaten: ${today.eaten} | Burned: ${today.burned} | Net: ${today.net} | Remaining: ${today.remainingCalories}${today.overGoal ? ' (OVER GOAL)' : ''}`,
    `Protein: ${Math.round(today.protein)}/${goals.protein}g (${Math.round(today.proteinRemaining)}g left)`,
    `Carbs: ${Math.round(today.carbs)}/${goals.carbs}g (${Math.round(today.carbsRemaining)}g left)`,
    `Fat: ${Math.round(today.fat)}/${goals.fat}g (${Math.round(today.fatRemaining)}g left)`,
    `Meals logged:\n${mealLines}`,
    `Workouts logged:\n${workoutLines}`,
    latestWeight ? `Latest weight: ${latestWeight.weight} ${latestWeight.unit}` : 'Latest weight: not logged',
    `This week: avg ${weekly.avgCalories} cal/day, ${weekly.daysOverGoal} days over goal`,
  ].join('\n');
}

export function executeCoachActions(state, dateKey, actions) {
  const results = [];

  for (const action of actions) {
    try {
      const data = action.data || {};
      switch (action.type) {
        case 'add_food': {
          const entry = addFoodEntry(state, dateKey, {
            name: data.name || 'Food',
            calories: Number(data.calories) || 0,
            protein: Number(data.protein) || 0,
            carbs: Number(data.carbs) || 0,
            fat: Number(data.fat) || 0,
            fiber: Number(data.fiber) || 0,
            sugar: Number(data.sugar) || 0,
            sodium: Number(data.sodium) || 0,
            mealType: data.mealType || inferMealType(),
            servingSize: data.servingSize || '',
            servings: Number(data.servings) || 1,
          });
          results.push({ type: 'add_food', label: `Logged ${entry.name} (${entry.calories} cal)` });
          break;
        }
        case 'add_workout': {
          const entry = addWorkoutEntry(state, dateKey, {
            name: data.name || 'Workout',
            duration: Number(data.duration) || 30,
            caloriesBurned: Number(data.caloriesBurned) || 0,
            icon: data.icon || '💪',
            notes: data.notes || '',
          });
          results.push({
            type: 'add_workout',
            label: `Logged ${entry.name} (${entry.duration} min, -${entry.caloriesBurned} cal)`,
          });
          break;
        }
        case 'log_weight': {
          const entry = addWeightEntry(state, Number(data.weight), data.unit || state.settings.weightUnit);
          state.settings.weightUnit = entry.unit;
          results.push({ type: 'log_weight', label: `Logged weight: ${entry.weight} ${entry.unit}` });
          break;
        }
        case 'update_goals': {
          Object.assign(state.goals, data);
          saveState(state);
          results.push({ type: 'update_goals', label: 'Updated your nutrition goals' });
          break;
        }
        default:
          break;
      }
    } catch {
      results.push({ type: 'error', label: `Failed: ${action.type}` });
    }
  }

  return results;
}

function inferMealType() {
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 20) return 'dinner';
  return 'snack';
}
