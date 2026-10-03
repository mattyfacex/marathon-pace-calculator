/**
 * PaceCraft Marathon Engine
 * High-precision split calculator, pacing strategist & race planner
 */

// Standard Distances (km & miles)
const DISTANCES = {
  marathon: { name: 'Full Marathon', km: 42.195, miles: 26.21875, defaultTime: 12600 }, // 3h 30m
  half: { name: 'Half Marathon', km: 21.0975, miles: 13.109375, defaultTime: 6300 },   // 1h 45m
  '10k': { name: '10K', km: 10.0, miles: 6.21371, defaultTime: 3000 },                 // 50m
  '5k': { name: '5K', km: 5.0, miles: 3.10686, defaultTime: 1500 }                     // 25m
};

// Application State
const state = {
  currentDistanceKey: 'marathon',
  totalSeconds: 12600, // 3:30:00 default
  activeUnit: 'km',    // 'km' or 'mi'
  strategy: 'even',    // 'even', 'negative', 'positive'
  variancePercent: 3.0, // % difference between 1st half and 2nd half
  showOnlyMilestones: false,
  fuelReminders: true,
  bandInterval: '5k',
  bandWidth: 'standard'
};

// DOM Elements
const hoursInput = document.getElementById('hoursInput');
const minutesInput = document.getElementById('minutesInput');
const secondsInput = document.getElementById('secondsInput');
const timeSlider = document.getElementById('timeSlider');
const distPills = document.querySelectorAll('.dist-pill');
const presetChips = document.querySelectorAll('.preset-chip');
const strategyBtns = document.querySelectorAll('.strategy-btn');
const strategySliderContainer = document.getElementById('strategySliderContainer');
const varianceSlider = document.getElementById('varianceSlider');
const varianceValueText = document.getElementById('varianceValueText');
const strategyDescriptionBadge = document.getElementById('strategyDescriptionBadge');
const strategySubtext = document.getElementById('strategySubtext');
const fuelReminderToggle = document.getElementById('fuelReminderToggle');
const unitKmBtn = document.getElementById('unitKmBtn');
const unitMiBtn = document.getElementById('unitMiBtn');
const filterMilestonesBtn = document.getElementById('filterMilestonesBtn');
const filterLabel = document.getElementById('filterLabel');

// Outputs
const avgPaceKmEl = document.getElementById('avgPaceKm');
const avgPaceMiEl = document.getElementById('avgPaceMi');
const speedKmhEl = document.getElementById('speedKmh');
const speedMphEl = document.getElementById('speedMph');
const halfSplitTimeEl = document.getElementById('halfSplitTime');
const halfSplitSubtextEl = document.getElementById('halfSplitSubtext');
const thirtyKmSplitTimeEl = document.getElementById('thirtyKmSplitTime');
const remainingFrom30kEl = document.getElementById('remainingFrom30k');
const splitsTableBody = document.getElementById('splitsTableBody');
const splitsCountLabel = document.getElementById('splitsCountLabel');
const milestonesGrid = document.getElementById('milestonesGrid');
const paceChartSvg = document.getElementById('paceChartSvg');

// Modal Elements
const paceBandBtn = document.getElementById('paceBandBtn');
const paceBandModal = document.getElementById('paceBandModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const bandIntervalSelect = document.getElementById('bandIntervalSelect');
const bandWidthSelect = document.getElementById('bandWidthSelect');
const wristbandStrip = document.getElementById('wristbandStrip');
const wbSplitsContainer = document.getElementById('wbSplitsContainer');
const wbGoalTime = document.getElementById('wbGoalTime');
const wbAvgPace = document.getElementById('wbAvgPace');
const printPaceBandBtn = document.getElementById('printPaceBandBtn');
const copyBandTextBtn = document.getElementById('copyBandTextBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const toastMessage = document.getElementById('toastMessage');

/**
 * Format Helpers
 */
function pad(num) {
  return num < 10 ? '0' + num : '' + num;
}

function secondsToHms(sec, showHoursAlways = true) {
  const rounded = Math.round(sec);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (!showHoursAlways && h === 0) {
    return `${pad(m)}:${pad(s)}`;
  }
  return `${h}:${pad(m)}:${pad(s)}`;
}

function secondsToPace(sec) {
  const rounded = Math.round(sec);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}:${pad(s)}`;
}

function showToast(msg) {
  toastMessage.textContent = msg;
  toastMessage.classList.add('show');
  setTimeout(() => {
    toastMessage.classList.remove('show');
  }, 3000);
}

/**
 * Pacing Model Calculation
 * Computes split segments with continuous variance curve if negative/positive split
 */
function calculateSplits() {
  const distanceInfo = DISTANCES[state.currentDistanceKey];
  const isKm = state.activeUnit === 'km';
  const totalDistance = isKm ? distanceInfo.km : distanceInfo.miles;
  const numFullSplits = Math.floor(totalDistance);
  const finalFraction = totalDistance - numFullSplits;

  // Build segments array
  const segments = [];
  for (let i = 1; i <= numFullSplits; i++) {
    segments.push({
      index: i,
      distance: 1.0,
      cumulativeDistance: i,
      isFinal: false
    });
  }
  if (finalFraction > 0.001) {
    segments.push({
      index: numFullSplits + 1,
      distance: finalFraction,
      cumulativeDistance: totalDistance,
      isFinal: true
    });
  }

  // Baseline pace per unit distance (seconds per km or mile)
  const basePacePerUnit = state.totalSeconds / totalDistance;

  // Apply strategy curve
  // variance: e.g. 0.03 for 3%
  let factor = 0;
  if (state.strategy === 'negative') {
    factor = -(state.variancePercent / 100); // 2nd half faster -> lower seconds
  } else if (state.strategy === 'positive') {
    factor = (state.variancePercent / 100);  // 2nd half slower -> higher seconds
  }

  // Weight for each segment based on progression from start (dist 0) to finish (dist totalDistance)
  // Progression x in [-1, +1] across the race:
  // pace(d) = basePace * (1 + factor * ((d / totalDistance) - 0.5) * 2)
  let rawSegmentDurations = segments.map(seg => {
    const midPoint = seg.cumulativeDistance - (seg.distance / 2);
    const normalizedPos = (midPoint / totalDistance) - 0.5; // -0.5 at start, +0.5 at end
    const paceMultiplier = 1 + (factor * normalizedPos * 2);
    const splitPace = basePacePerUnit * paceMultiplier;
    return splitPace * seg.distance;
  });

  // Normalize so sum(rawSegmentDurations) === state.totalSeconds exactly
  const rawTotal = rawSegmentDurations.reduce((a, b) => a + b, 0);
  const scale = state.totalSeconds / rawTotal;
  const normalizedDurations = rawSegmentDurations.map(d => d * scale);

  // Build final structured splits with cumulative time
  let runningElapsed = 0;
  const splits = segments.map((seg, idx) => {
    const duration = normalizedDurations[idx];
    runningElapsed += duration;
    const splitPaceSec = duration / seg.distance;
    const evenSplitDuration = basePacePerUnit * seg.distance;
    const diffFromEvenSec = duration - evenSplitDuration;

    return {
      splitIndex: seg.index,
      distance: seg.distance,
      cumulativeDistance: seg.cumulativeDistance,
      duration: duration,
      paceSeconds: splitPaceSec,
      elapsedSeconds: runningElapsed,
      diffFromEvenSec: diffFromEvenSec,
      isFinal: seg.isFinal,
      unit: state.activeUnit
    };
  });

  return splits;
}

/**
 * Check if a split is a significant milestone
 */
function getMilestoneInfo(split, isKm, totalDistance) {
  const dist = split.cumulativeDistance;
  let label = null;
  let isMajor = false;
  let isFinish = split.isFinal || Math.abs(dist - totalDistance) < 0.05;

  if (isFinish) {
    label = 'Finish';
    isMajor = true;
  } else if (isKm) {
    if (dist === 5) { label = '5K Gate'; isMajor = true; }
    else if (dist === 10) { label = '10K Gate'; isMajor = true; }
    else if (dist === 15) { label = '15K Gate'; isMajor = true; }
    else if (dist === 20) { label = '20K Gate'; isMajor = true; }
    else if (Math.abs(dist - 21.0975) < 0.1 || dist === 21) { label = 'Half Marathon'; isMajor = true; }
    else if (dist === 25) { label = '25K Gate'; isMajor = true; }
    else if (dist === 30) { label = '30K The Wall'; isMajor = true; }
    else if (dist === 35) { label = '35K Push'; isMajor = true; }
    else if (dist === 40) { label = '40K Final Push'; isMajor = true; }
  } else {
    // Miles
    if (dist === 5) { label = '5 Miles'; isMajor = true; }
    else if (dist === 10) { label = '10 Miles'; isMajor = true; }
    else if (Math.abs(dist - 13.1) < 0.2 || dist === 13) { label = 'Half Marathon'; isMajor = true; }
    else if (dist === 15) { label = '15 Miles'; isMajor = true; }
    else if (dist === 20) { label = '20 Miles (The Wall)'; isMajor = true; }
    else if (dist === 25) { label = '25 Miles'; isMajor = true; }
  }

  // Energy Gel Fuel Checkpoint: roughly every 7km or every 4 miles
  let isFuel = false;
  let fuelLabel = null;
  if (state.fuelReminders && !isFinish) {
    const fuelInterval = isKm ? 7 : 4.5;
    const gelNumber = Math.floor(dist / fuelInterval);
    if (gelNumber > 0 && Math.abs(dist - (gelNumber * fuelInterval)) < 0.9) {
      isFuel = true;
      fuelLabel = `Gel #${gelNumber} + Water`;
    }
  }

  return { label, isMajor, isFinish, isFuel, fuelLabel };
}

/**
 * Render Core Metrics Dashboard
 */
function renderMetrics() {
  const distanceInfo = DISTANCES[state.currentDistanceKey];
  const km = distanceInfo.km;
  const miles = distanceInfo.miles;

  // Pace calculations
  const paceSecPerKm = state.totalSeconds / km;
  const paceSecPerMi = state.totalSeconds / miles;

  const speedKmh = (km / (state.totalSeconds / 3600)).toFixed(2);
  const speedMph = (miles / (state.totalSeconds / 3600)).toFixed(2);

  avgPaceKmEl.textContent = secondsToPace(paceSecPerKm);
  avgPaceMiEl.textContent = secondsToPace(paceSecPerMi);
  speedKmhEl.textContent = `${speedKmh} km/h`;
  speedMphEl.textContent = `${speedMph} mph`;

  // Half marathon checkpoint
  if (km >= 21.0975) {
    const halfRatio = 21.0975 / km;
    // Account for strategy factor
    let halfTime = state.totalSeconds * halfRatio;
    if (state.strategy === 'negative') {
      halfTime *= (1 + (state.variancePercent / 200));
    } else if (state.strategy === 'positive') {
      halfTime *= (1 - (state.variancePercent / 200));
    }
    halfSplitTimeEl.textContent = secondsToHms(halfTime);
    halfSplitSubtextEl.textContent = state.strategy === 'negative' ? 'Slightly conservative 1st half' : 'Target 50% split mark';
  } else {
    halfSplitTimeEl.textContent = '—';
    halfSplitSubtextEl.textContent = 'Distance under 21.1 km';
  }

  // 30K checkpoint
  if (km >= 30) {
    const thirtyRatio = 30.0 / km;
    let thirtyTime = state.totalSeconds * thirtyRatio;
    if (state.strategy === 'negative') {
      thirtyTime *= (1 + (state.variancePercent / 350));
    } else if (state.strategy === 'positive') {
      thirtyTime *= (1 - (state.variancePercent / 350));
    }
    thirtyKmSplitTimeEl.textContent = secondsToHms(thirtyTime);
    remainingFrom30kEl.textContent = `${(km - 30).toFixed(1)} km`;
  } else {
    thirtyKmSplitTimeEl.textContent = '—';
    remainingFrom30kEl.textContent = 'Distance under 30 km';
  }
}

/**
 * Render Splits Table
 */
function renderSplitsTable(splits) {
  const isKm = state.activeUnit === 'km';
  const totalDistance = isKm ? DISTANCES[state.currentDistanceKey].km : DISTANCES[state.currentDistanceKey].miles;
  splitsCountLabel.textContent = `${splits.length} splits total (${totalDistance.toFixed(isKm ? 2 : 1)} ${isKm ? 'km' : 'miles'})`;

  splitsTableBody.innerHTML = '';

  splits.forEach((split) => {
    const milestone = getMilestoneInfo(split, isKm, totalDistance);

    if (state.showOnlyMilestones && !milestone.isMajor && !milestone.isFinish && !milestone.isFuel) {
      return;
    }

    const tr = document.createElement('tr');
    if (milestone.isFinish) {
      tr.className = 'finish-row';
    } else if (milestone.isMajor) {
      tr.className = 'milestone-row';
    }

    // Split Label
    const splitLabel = split.isFinal 
      ? `Final Kick` 
      : `${isKm ? 'KM' : 'Mile'} ${split.splitIndex}`;

    // Distance column
    const distText = `${split.cumulativeDistance.toFixed(isKm ? 2 : 2)} ${isKm ? 'km' : 'mi'}`;
    const distanceBadge = milestone.label 
      ? `<span class="milestone-tag ${milestone.isFinish ? 'finish' : 'primary'}">${milestone.label}</span>`
      : '';

    // Diff tag
    let diffHtml = '';
    const diffSec = Math.round(split.diffFromEvenSec);
    if (diffSec < 0) {
      diffHtml = `<span class="diff-tag diff-faster">-${Math.abs(diffSec)}s (faster)</span>`;
    } else if (diffSec > 0) {
      diffHtml = `<span class="diff-tag diff-slower">+${diffSec}s (slower)</span>`;
    } else {
      diffHtml = `<span class="diff-tag diff-even">even (0s)</span>`;
    }

    // Fuel badge
    let fuelHtml = '';
    if (milestone.isFuel) {
      fuelHtml = `<span class="fuel-badge">⚡ ${milestone.fuelLabel}</span>`;
    }

    tr.innerHTML = `
      <td><span class="split-pill">${splitLabel}</span></td>
      <td><strong>${distText}</strong> ${distanceBadge}</td>
      <td>${secondsToPace(split.paceSeconds)} <small>/${isKm ? 'km' : 'mi'}</small></td>
      <td>${secondsToHms(split.duration, false)}</td>
      <td><strong>${secondsToHms(split.elapsedSeconds)}</strong></td>
      <td>${diffHtml}</td>
      <td>${fuelHtml}</td>
    `;

    splitsTableBody.appendChild(tr);
  });
}

/**
 * Render Major Gates Summary Grid
 */
function renderMilestonesGrid(splits) {
  const isKm = state.activeUnit === 'km';
  const totalDistance = isKm ? DISTANCES[state.currentDistanceKey].km : DISTANCES[state.currentDistanceKey].miles;
  milestonesGrid.innerHTML = '';

  const gates = [
    { targetDist: 5, label: '5K' },
    { targetDist: 10, label: '10K' },
    { targetDist: 15, label: '15K' },
    { targetDist: 20, label: '20K' },
    { targetDist: 21.0975, label: 'Half Marathon' },
    { targetDist: 25, label: '25K' },
    { targetDist: 30, label: '30K (Wall)' },
    { targetDist: 35, label: '35K' },
    { targetDist: 40, label: '40K' },
    { targetDist: totalDistance, label: 'Finish' }
  ];

  gates.forEach(gate => {
    if (gate.targetDist > totalDistance && Math.abs(gate.targetDist - totalDistance) > 0.1) return;

    // Find closest split or interpolate
    const splitMatch = splits.find(s => Math.abs(s.cumulativeDistance - gate.targetDist) < 0.6);
    let displayTime = '';
    let avgPaceAtGate = '';

    if (splitMatch) {
      displayTime = secondsToHms(splitMatch.elapsedSeconds);
      avgPaceAtGate = `${secondsToPace(splitMatch.elapsedSeconds / splitMatch.cumulativeDistance)}/${isKm ? 'km' : 'mi'}`;
    } else {
      // Interpolate
      const ratio = gate.targetDist / totalDistance;
      displayTime = secondsToHms(state.totalSeconds * ratio);
      avgPaceAtGate = `${secondsToPace(state.totalSeconds / totalDistance)}/${isKm ? 'km' : 'mi'}`;
    }

    const card = document.createElement('div');
    card.className = 'gate-card';
    card.innerHTML = `
      <div class="gate-distance">${gate.label}</div>
      <div class="gate-time">${displayTime}</div>
      <div class="gate-pace">Avg ${avgPaceAtGate}</div>
    `;
    milestonesGrid.appendChild(card);
  });
}

/**
 * Render Interactive SVG Pace Profile Chart
 */
function renderPaceChart(splits) {
  if (!splits || splits.length < 2) return;

  const width = 900;
  const height = 180;
  const padTop = 25;
  const padBottom = 35;
  const padLeft = 45;
  const padRight = 30;

  const totalDist = splits[splits.length - 1].cumulativeDistance;
  const paces = splits.map(s => s.paceSeconds);
  const minPace = Math.min(...paces) - 15;
  const maxPace = Math.max(...paces) + 15;
  const paceRange = maxPace - minPace || 1;

  const xScale = (d) => padLeft + (d / totalDist) * (width - padLeft - padRight);
  const yScale = (p) => padTop + ((p - minPace) / paceRange) * (height - padTop - padBottom);

  // Average line Y
  const avgPace = state.totalSeconds / totalDist;
  const avgY = yScale(avgPace);

  // Build path points
  const points = splits.map(s => {
    const x = xScale(s.cumulativeDistance - (s.distance / 2));
    const y = yScale(s.paceSeconds);
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(' L ')}`;

  // Area under curve
  const firstX = xScale(0);
  const lastX = xScale(totalDist);
  const baseY = height - padBottom;
  const areaD = `M ${firstX},${baseY} L ${points[0]} L ${points.join(' L ')} L ${points[points.length - 1]} L ${lastX},${baseY} Z`;

  // Gel markers
  let gelCircles = '';
  if (state.fuelReminders) {
    const isKm = state.activeUnit === 'km';
    splits.forEach(s => {
      const milestone = getMilestoneInfo(s, isKm, totalDist);
      if (milestone.isFuel) {
        const gx = xScale(s.cumulativeDistance);
        const gy = yScale(s.paceSeconds);
        gelCircles += `
          <circle cx="${gx}" cy="${gy}" r="6" fill="#ffaa00" stroke="#080c14" stroke-width="2" />
          <text x="${gx}" y="${gy - 12}" fill="#ffaa00" font-size="11" font-weight="700" text-anchor="middle" font-family="'JetBrains Mono', monospace">⚡ GEL</text>
        `;
      }
    });
  }

  paceChartSvg.innerHTML = `
    <defs>
      <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#00f59b" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#00f59b" stop-opacity="0.0"/>
      </linearGradient>
    </defs>

    <!-- Grid / Axis lines -->
    <line x1="${padLeft}" y1="${baseY}" x2="${width - padRight}" y2="${baseY}" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
    <line x1="${padLeft}" y1="${avgY}" x2="${width - padRight}" y2="${avgY}" stroke="#00d2ff" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.75" />
    <text x="${width - padRight - 5}" y="${avgY - 6}" fill="#00d2ff" font-size="11" font-weight="600" text-anchor="end" font-family="'JetBrains Mono', monospace">Avg ${secondsToPace(avgPace)}</text>

    <!-- Shaded Area -->
    <path d="${areaD}" fill="url(#areaGradient)" />

    <!-- Pace Line -->
    <path d="${pathD}" fill="none" stroke="#00f59b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Gel Circles -->
    ${gelCircles}

    <!-- Labels -->
    <text x="${padLeft}" y="${height - 10}" fill="#94a3b8" font-size="11" font-weight="600" font-family="'JetBrains Mono', monospace">Start 0 ${state.activeUnit}</text>
    <text x="${width - padRight}" y="${height - 10}" fill="#94a3b8" font-size="11" font-weight="600" text-anchor="end" font-family="'JetBrains Mono', monospace">Finish ${totalDist.toFixed(1)} ${state.activeUnit}</text>
  `;
}

/**
 * Render Printable Pace Wristband
 */
function renderPaceWristband(splits) {
  wbGoalTime.textContent = secondsToHms(state.totalSeconds);
  const distanceInfo = DISTANCES[state.currentDistanceKey];
  const avgKmPace = secondsToPace(state.totalSeconds / distanceInfo.km);
  const avgMiPace = secondsToPace(state.totalSeconds / distanceInfo.miles);
  wbAvgPace.textContent = `${avgKmPace}/km • ${avgMiPace}/mi`;

  wristbandStrip.className = `wristband-strip ${state.bandWidth}`;
  wbSplitsContainer.innerHTML = '';

  const interval = state.bandInterval;
  let filteredSplits = [];

  if (interval === '5k') {
    const isKm = state.activeUnit === 'km';
    filteredSplits = splits.filter(s => {
      const is5kGate = Math.abs(s.cumulativeDistance % 5) < 0.1 || (s.cumulativeDistance % 5) === 0;
      const isHalf = Math.abs(s.cumulativeDistance - 21.0975) < 0.2;
      return is5kGate || isHalf || s.isFinal;
    });
  } else {
    // Show all generated splits
    filteredSplits = splits;
  }

  filteredSplits.forEach(s => {
    const item = document.createElement('div');
    item.className = `wb-item ${s.isFinal ? 'wb-highlight' : ''}`;
    const distLabel = s.isFinal ? 'FIN' : `${s.cumulativeDistance.toFixed(interval === '5k' ? 0 : 0)}`;
    item.innerHTML = `
      <div class="wb-dist">${distLabel}</div>
      <div class="wb-time">${secondsToHms(s.elapsedSeconds, false)}</div>
    `;
    wbSplitsContainer.appendChild(item);
  });
}

/**
 * Recompute everything and update entire UI
 */
function updateAll() {
  renderMetrics();
  const splits = calculateSplits();
  renderSplitsTable(splits);
  renderMilestonesGrid(splits);
  renderPaceChart(splits);
  renderPaceWristband(splits);
}

/**
 * Sync Time Inputs and Slider
 */
function setTimeFromSeconds(totalSec) {
  state.totalSeconds = Math.max(1800, Math.min(36000, totalSec)); // 30m to 10h
  const h = Math.floor(state.totalSeconds / 3600);
  const m = Math.floor((state.totalSeconds % 3600) / 60);
  const s = state.totalSeconds % 60;

  hoursInput.value = h;
  minutesInput.value = pad(m);
  secondsInput.value = pad(s);
  timeSlider.value = state.totalSeconds;

  // Update preset chip active states
  const formattedTime = `${pad(h)}:${pad(m)}:${pad(s)}`;
  presetChips.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.time === formattedTime);
  });

  updateAll();
}

function handleTimeInputsChange() {
  const h = parseInt(hoursInput.value, 10) || 0;
  const m = parseInt(minutesInput.value, 10) || 0;
  const s = parseInt(secondsInput.value, 10) || 0;
  const total = (h * 3600) + (m * 60) + s;
  setTimeFromSeconds(total);
}

// Event Listeners for Time
hoursInput.addEventListener('input', handleTimeInputsChange);
minutesInput.addEventListener('input', handleTimeInputsChange);
secondsInput.addEventListener('input', handleTimeInputsChange);

timeSlider.addEventListener('input', (e) => {
  setTimeFromSeconds(parseInt(e.target.value, 10));
});

// Distance Selector
distPills.forEach(pill => {
  pill.addEventListener('click', () => {
    distPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.currentDistanceKey = pill.dataset.distance;
    
    // Adjust slider range based on distance
    const defaultTime = DISTANCES[state.currentDistanceKey].defaultTime;
    if (state.currentDistanceKey === 'marathon') {
      timeSlider.min = 7200; // 2h
      timeSlider.max = 25200; // 7h
    } else if (state.currentDistanceKey === 'half') {
      timeSlider.min = 3600; // 1h
      timeSlider.max = 14400; // 4h
    } else {
      timeSlider.min = 900; // 15m
      timeSlider.max = 5400; // 1h 30m
    }
    setTimeFromSeconds(defaultTime);
  });
});

// Preset Badges
presetChips.forEach(chip => {
  chip.addEventListener('click', () => {
    presetChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const [h, m, s] = chip.dataset.time.split(':').map(Number);
    setTimeFromSeconds((h * 3600) + (m * 60) + s);
  });
});

// Strategy Buttons
strategyBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    strategyBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.strategy = btn.dataset.strategy;

    if (state.strategy === 'even') {
      strategySliderContainer.style.display = 'none';
      strategyDescriptionBadge.textContent = 'Even Pace (0%)';
    } else if (state.strategy === 'negative') {
      strategySliderContainer.style.display = 'block';
      strategyDescriptionBadge.textContent = `Negative Split (-${state.variancePercent}%)`;
      strategySubtext.textContent = `Second half is ~${state.variancePercent}% faster than first half.`;
    } else {
      strategySliderContainer.style.display = 'block';
      strategyDescriptionBadge.textContent = `Positive Split (+${state.variancePercent}%)`;
      strategySubtext.textContent = `Conservative finish: first half is ~${state.variancePercent}% faster.`;
    }

    updateAll();
  });
});

// Variance Slider
varianceSlider.addEventListener('input', (e) => {
  state.variancePercent = parseFloat(e.target.value);
  varianceValueText.textContent = `${state.variancePercent.toFixed(1)}%`;
  if (state.strategy === 'negative') {
    strategyDescriptionBadge.textContent = `Negative Split (-${state.variancePercent}%)`;
    strategySubtext.textContent = `Second half is ~${state.variancePercent}% faster than first half.`;
  } else {
    strategyDescriptionBadge.textContent = `Positive Split (+${state.variancePercent}%)`;
    strategySubtext.textContent = `Conservative finish: first half is ~${state.variancePercent}% faster.`;
  }
  updateAll();
});

// Fuel Toggle
fuelReminderToggle.addEventListener('change', (e) => {
  state.fuelReminders = e.target.checked;
  updateAll();
});

// Unit Toggle Buttons (KM / MI)
unitKmBtn.addEventListener('click', () => {
  unitKmBtn.classList.add('active');
  unitMiBtn.classList.remove('active');
  state.activeUnit = 'km';
  updateAll();
});

unitMiBtn.addEventListener('click', () => {
  unitMiBtn.classList.add('active');
  unitKmBtn.classList.remove('active');
  state.activeUnit = 'mi';
  updateAll();
});

// Milestone Filter Button
filterMilestonesBtn.addEventListener('click', () => {
  state.showOnlyMilestones = !state.showOnlyMilestones;
  filterMilestonesBtn.classList.toggle('active', state.showOnlyMilestones);
  filterLabel.textContent = state.showOnlyMilestones ? 'Showing Key Milestones Only' : 'Show Key Milestones Only';
  const splits = calculateSplits();
  renderSplitsTable(splits);
});

// Wristband Modal Controls
paceBandBtn.addEventListener('click', () => {
  paceBandModal.classList.add('open');
});

closeModalBtn.addEventListener('click', () => {
  paceBandModal.classList.remove('open');
});

paceBandModal.addEventListener('click', (e) => {
  if (e.target === paceBandModal) {
    paceBandModal.classList.remove('open');
  }
});

bandIntervalSelect.addEventListener('change', (e) => {
  state.bandInterval = e.target.value;
  const splits = calculateSplits();
  renderPaceWristband(splits);
});

bandWidthSelect.addEventListener('change', (e) => {
  state.bandWidth = e.target.value;
  const splits = calculateSplits();
  renderPaceWristband(splits);
});

printPaceBandBtn.addEventListener('click', () => {
  window.print();
});

copyBandTextBtn.addEventListener('click', () => {
  const splits = calculateSplits();
  const summary = splits
    .filter(s => s.cumulativeDistance % 5 === 0 || s.isFinal || Math.abs(s.cumulativeDistance - 21.1) < 0.2)
    .map(s => `${s.isFinal ? 'FINISH' : s.cumulativeDistance + ' ' + state.activeUnit}: ${secondsToHms(s.elapsedSeconds)} (${secondsToPace(s.paceSeconds)}/${state.activeUnit})`)
    .join('\n');
  
  navigator.clipboard.writeText(`PaceCraft Marathon Plan (${secondsToHms(state.totalSeconds)})\n\n${summary}`)
    .then(() => showToast('Pace plan copied to clipboard!'))
    .catch(() => showToast('Failed to copy to clipboard'));
});

// CSV Export
exportCsvBtn.addEventListener('click', () => {
  const splits = calculateSplits();
  const isKm = state.activeUnit === 'km';
  const unitStr = isKm ? 'km' : 'miles';
  
  let csvContent = 'data:text/csv;charset=utf-8,';
  csvContent += `Split,Distance (${unitStr}),Pace (per ${unitStr}),Split Duration,Cumulative Time,Vs Even (sec)\n`;

  splits.forEach(s => {
    const splitName = s.isFinal ? 'Finish Kick' : `Split ${s.splitIndex}`;
    const dist = s.cumulativeDistance.toFixed(2);
    const pace = secondsToPace(s.paceSeconds);
    const duration = secondsToHms(s.duration, false);
    const elapsed = secondsToHms(s.elapsedSeconds);
    const diff = Math.round(s.diffFromEvenSec);

    csvContent += `"${splitName}",${dist},"${pace}","${duration}","${elapsed}",${diff}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `marathon_splits_${secondsToHms(state.totalSeconds).replace(/:/g, '-')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Splits CSV file downloaded!');
});

// Initialize on Load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeFromSeconds(12600); // 3h 30m default
  });
} else {
  setTimeFromSeconds(12600);
}

