import {
  getWeeklyReport,
  formatWeekRange,
  formatShortDay,
  formatDateDisplay,
  getDateKey,
} from './storage.js';

let reportWeekEnd = null;
let onWeekChange = null;

export function initReports(weekEnd, updateCallback) {
  reportWeekEnd = weekEnd;
  onWeekChange = updateCallback;
}

export function setReportWeekEnd(dateKey) {
  reportWeekEnd = dateKey;
}

export function shiftReportWeek(delta) {
  const d = new Date(reportWeekEnd + 'T12:00:00');
  d.setDate(d.getDate() + delta * 7);
  const today = getDateKey();
  if (getDateKey(d) > today) return;
  reportWeekEnd = getDateKey(d);
  onWeekChange?.();
}

export function renderReportsView(state) {
  if (!reportWeekEnd) reportWeekEnd = getDateKey();
  const report = getWeeklyReport(state, reportWeekEnd);
  const today = getDateKey();

  const weekLabel = document.getElementById('reportWeekLabel');
  if (weekLabel) {
    weekLabel.textContent = formatWeekRange(report.startDate, report.endDate);
  }

  const nextBtn = document.getElementById('reportWeekNext');
  if (nextBtn) {
    nextBtn.disabled = report.endDate >= today;
  }

  renderReportSummary(report);
  renderCalorieChart(report, today);
  renderMacroChart(report);
  renderNetCalorieChart(report, today);
  renderOverGoalSection(report);
  renderDailyBreakdown(report, today);
}

function renderReportSummary(report) {
  const el = document.getElementById('reportSummary');
  if (!el) return;

  el.innerHTML = `
    <div class="summary-card">
      <div class="summary-value">${report.avgCalories || '—'}</div>
      <div class="summary-label">Avg Cal/Day</div>
    </div>
    <div class="summary-card ${report.daysOverGoal > 0 ? 'over-goal' : ''}">
      <div class="summary-value">${report.daysOverGoal}</div>
      <div class="summary-label">Days Over</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${report.onTargetDays}</div>
      <div class="summary-label">On Target</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${report.totalBurned}</div>
      <div class="summary-label">Burned</div>
    </div>`;
}

function renderCalorieChart(report, today) {
  const el = document.getElementById('reportCalorieChart');
  if (!el) return;

  const maxVal = Math.max(
    report.calorieGoal,
    ...report.days.map((d) => d.calories),
    1
  );

  const goalPct = (report.calorieGoal / maxVal) * 100;

  el.innerHTML = `
    <div class="chart-with-goal">
      <div class="goal-line" style="bottom: ${goalPct}%">
        <span class="goal-line-label">${report.calorieGoal} goal</span>
      </div>
      <div class="weekly-chart report-chart">
        ${report.days
          .map((d) => {
            const height = (d.calories / maxVal) * 100;
            const isOver = d.overGoal;
            const isToday = d.dateKey === today;
            return `
              <div class="chart-bar-group">
                <span class="chart-value">${d.calories || ''}</span>
                <div class="chart-bar-wrap">
                  <div class="chart-bar ${isToday ? 'today' : ''} ${isOver ? 'over' : ''}"
                    style="height: ${Math.max(height, d.calories ? 4 : 0)}%"></div>
                </div>
                <span class="chart-label">${formatShortDay(d.dateKey)}</span>
              </div>`;
          })
          .join('')}
      </div>
    </div>
    <div class="chart-legend">
      <span class="legend-item"><i class="dot primary"></i> Eaten</span>
      <span class="legend-item"><i class="dot danger"></i> Over goal</span>
      <span class="legend-item"><i class="dot line"></i> Daily goal</span>
    </div>`;
}

function renderMacroChart(report) {
  const el = document.getElementById('reportMacroChart');
  if (!el) return;

  const macros = [
    { key: 'protein', label: 'Protein', color: 'var(--protein)', goal: report.macroGoals.protein },
    { key: 'carbs', label: 'Carbs', color: 'var(--carbs)', goal: report.macroGoals.carbs },
    { key: 'fat', label: 'Fat', color: 'var(--fat)', goal: report.macroGoals.fat },
  ];

  const maxVal = Math.max(
    ...macros.flatMap((m) => [report[`avg${capitalize(m.key)}`] || 0, m.goal]),
    1
  );

  el.innerHTML = `
    <div class="macro-avg-chart">
      ${macros
        .map((m) => {
          const avg = report[`avg${capitalize(m.key)}`] || 0;
          const avgPct = (avg / maxVal) * 100;
          const goalPct = (m.goal / maxVal) * 100;
          const over = avg > m.goal;
          return `
            <div class="macro-avg-row">
              <span class="macro-avg-label">${m.label}</span>
              <div class="macro-avg-bars">
                <div class="macro-avg-track">
                  <div class="macro-avg-fill" style="width: ${avgPct}%; background: ${m.color}"></div>
                  <div class="macro-avg-goal-mark" style="left: ${goalPct}%"></div>
                </div>
              </div>
              <span class="macro-avg-value ${over ? 'over' : ''}">${avg}g <small>/ ${m.goal}g</small></span>
            </div>`;
        })
        .join('')}
    </div>
    <p class="hint chart-hint">Weekly averages vs daily targets</p>`;
}

function renderNetCalorieChart(report, today) {
  const el = document.getElementById('reportNetChart');
  if (!el) return;

  const maxVal = Math.max(
    report.calorieGoal,
    ...report.days.map((d) => Math.abs(d.net)),
    1
  );

  el.innerHTML = `
    <div class="weekly-chart report-chart net-chart">
      ${report.days
        .map((d) => {
          const height = (Math.abs(d.net) / maxVal) * 100;
          const isToday = d.dateKey === today;
          const isOver = d.overGoal;
          return `
            <div class="chart-bar-group">
              <span class="chart-value ${d.net < 0 ? 'negative' : ''}">${d.net || ''}</span>
              <div class="chart-bar-wrap">
                <div class="chart-bar net ${isToday ? 'today' : ''} ${isOver ? 'over' : ''}"
                  style="height: ${Math.max(height, d.net ? 4 : 0)}%"></div>
              </div>
              <span class="chart-label">${formatShortDay(d.dateKey)}</span>
            </div>`;
        })
        .join('')}
    </div>
    <p class="hint chart-hint">Net calories (eaten − burned) per day</p>`;
}

function renderOverGoalSection(report) {
  const el = document.getElementById('reportOverGoalList');
  if (!el) return;

  if (!report.overGoalDays.length) {
    el.innerHTML = '<div class="empty-state">No days over your calorie goal this week 🎯</div>';
    return;
  }

  el.innerHTML = report.overGoalDays
    .map(
      (d) => `
      <div class="over-goal-day-item">
        <div class="over-goal-day-info">
          <strong>${formatDateDisplay(d.dateKey)}</strong>
          <span>${d.net} cal net · goal ${report.calorieGoal}</span>
        </div>
        <div class="over-goal-day-badge">+${d.overBy} cal</div>
      </div>`
    )
    .join('');
}

function renderDailyBreakdown(report, today) {
  const el = document.getElementById('reportDailyBreakdown');
  if (!el) return;

  el.innerHTML = report.days
    .map((d) => {
      const status = !d.hasData
        ? { class: 'none', text: 'No data' }
        : d.overGoal
          ? { class: 'over', text: `+${d.overBy} over` }
          : { class: 'ok', text: `${report.calorieGoal - d.net} under` };

      return `
        <div class="report-day-row ${d.dateKey === today ? 'today' : ''}">
          <span class="report-day-name">${formatShortDay(d.dateKey)}</span>
          <span class="report-day-cals">${d.calories} eaten</span>
          <span class="report-day-burned">${d.burned} burned</span>
          <span class="report-day-status ${status.class}">${status.text}</span>
        </div>`;
    })
    .join('');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
