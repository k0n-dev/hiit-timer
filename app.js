"use strict";

// 設定データ。編集中の値と、開始時に確定したメニューを分けます。
const defaultExercises = ["ゴブレットスクワット", "ハイニーマーチ", "ルーマニアンデッドリフト", "サイドステップ", "ダンベルロウ", "ステップバック"];
const $ = (id) => document.getElementById(id);
const rows = [];
// 大量の区間生成によるブラウザの停止を避けるための上限。
const MAX_INTERVALS = 10000;
let workout = [];
let currentIndex = 0;
let remainingMs = 0;
let deadline = 0;
let state = "settings"; // settings / running / paused / finished
let audioContext;
const activeSounds = new Set();
let lastCountdownSecond = null;
let lastAudioSampleAt = 0;

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function labeledInput(text, input) {
  const label = document.createElement("label");
  label.append(document.createTextNode(text), input);
  return label;
}

function addExercise(name = "新しい種目") {
  const row = document.createElement("div");
  row.className = "exercise-card";
  const heading = document.createElement("div");
  heading.className = "exercise-heading";
  const number = document.createElement("strong");
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "削除";
  heading.append(number, removeButton);
  const nameInput = document.createElement("input");
  nameInput.value = name;
  row.append(heading, labeledInput("種目名", nameInput));
  $("exercise-inputs").append(row);
  const entry = { row, number, removeButton, nameInput };
  rows.push(entry);
  removeButton.addEventListener("click", () => {
    if (rows.length <= 1) return;
    rows.splice(rows.indexOf(entry), 1);
    row.remove();
    updateExerciseNumbers();
    updateTotal();
    $("add-exercise").focus();
  });
  updateExerciseNumbers();
  return entry;
}

function updateExerciseNumbers() {
  rows.forEach(({ number, removeButton }, index) => {
    number.textContent = `種目 ${index + 1}`;
    removeButton.disabled = rows.length === 1;
    removeButton.setAttribute("aria-label", `種目${index + 1}を削除`);
  });
}
defaultExercises.forEach((name) => addExercise(name));
$("add-exercise").addEventListener("click", () => {
  addExercise().nameInput.focus();
  updateTotal();
});

function validSeconds(input) {
  return input.value.trim() !== "" && input.validity.valid &&
    Number.isInteger(Number(input.value)) && Number(input.value) >= Number(input.min || 1) && Number(input.value) <= 86400;
}

function validRounds() {
  const input = $("rounds");
  return input.value.trim() !== "" && input.validity.valid &&
    Number.isSafeInteger(Number(input.value)) && Number(input.value) >= 1;
}

function readSettings() {
  return {
    warmup: Number($("warmup-seconds").value),
    work: Number($("work-seconds").value),
    rest: Number($("rest-seconds").value),
    cooldown: Number($("cooldown-seconds").value),
    rounds: Number($("rounds").value),
    exercises: rows.map(({ nameInput }) => nameInput.value.trim())
  };
}

// START時に一度だけ実行用区間を生成。休憩も種目・周回情報を持ちます。
function buildWorkout(settings) {
  const intervals = [];
  if (settings.warmup > 0) intervals.push({ name: "準備運動", seconds: settings.warmup, type: "warmup" });
  for (let round = 1; round <= settings.rounds; round++) {
    settings.exercises.forEach((exercise, index) => {
      const progress = { round, rounds: settings.rounds, exercise: index + 1, exercises: settings.exercises.length };
      intervals.push({ ...progress, name: exercise, seconds: settings.work, type: "work" });
      intervals.push({ ...progress, name: "休憩", seconds: settings.rest, type: "rest" });
    });
  }
  if (settings.cooldown > 0) intervals.push({ name: "整理運動", seconds: settings.cooldown, type: "cooldown" });
  return intervals;
}

function countIntervals(settings) {
  return settings.exercises.length * settings.rounds * 2 + Number(settings.warmup > 0) + Number(settings.cooldown > 0);
}

function updateTotal() {
  const valid = validRounds() && ["warmup-seconds", "work-seconds", "rest-seconds", "cooldown-seconds"].every((id) => validSeconds($(id)));
  const settings = readSettings();
  const sets = rows.length * settings.rounds;
  const total = settings.warmup + settings.cooldown + sets * (settings.work + settings.rest);
  $("workout-summary").textContent = valid ? `${sets}運動セット · ${countIntervals(settings)}区間` : "設定を確認してください";
  $("total-time").textContent = valid ? `合計 ${formatTime(total)}` : "合計 —";
}
$("workout-form").addEventListener("input", updateTotal);
updateTotal();

// STARTのユーザー操作で音声を有効化。利用できなくてもタイマーは動作します。
function enableAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!audioContext && Audio) audioContext = new Audio();
    if (audioContext) audioContext.resume().catch(() => {});
  } catch { /* 音声非対応環境では無音 */ }
}
function beep() {
  if (!audioContext || audioContext.state !== "running") return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    oscillator.connect(gain).connect(audioContext.destination);
    activeSounds.add(oscillator);
    oscillator.onended = () => {
      activeSounds.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + 0.17);
  } catch { /* 通知音の失敗で計時を止めない */ }
}

// すでに鳴っている短いビープ音も、その場で止めます。
function stopSounds() {
  activeSounds.forEach((oscillator) => {
    try { oscillator.stop(); oscillator.disconnect(); } catch { /* 終了済みの音は無視 */ }
  });
  activeSounds.clear();
}

$("workout-form").addEventListener("submit", (event) => {
  event.preventDefault();
  let firstInvalid;
  function check(input, valid) {
    input.setAttribute("aria-invalid", String(!valid));
    if (!valid && !firstInvalid) firstInvalid = input;
  }
  ["warmup-seconds", "work-seconds", "rest-seconds", "cooldown-seconds"].forEach((id) => check($(id), validSeconds($(id))));
  check($("rounds"), validRounds());
  rows.forEach(({ nameInput }) => {
    check(nameInput, nameInput.value.trim().length > 0);
  });
  if (firstInvalid) {
    $("validation-error").textContent = "種目名、整数の秒数（準備・整理は0〜86400秒、運動・休憩は1〜86400秒）、1以上の整数の周回数を入力してください。";
    firstInvalid.focus();
    return;
  }
  const settings = readSettings();
  if (rows.length < 1 || countIntervals(settings) > MAX_INTERVALS) {
    $("validation-error").textContent = "種目は1つ以上、合計区間数は10000以下にしてください。";
    return;
  }
  $("validation-error").textContent = "";
  workout = buildWorkout(settings);
  enableAudio();
  currentIndex = 0;
  remainingMs = workout[0].seconds * 1000;
  deadline = performance.now() + remainingMs;
  state = "running";
  lastCountdownSecond = null;
  lastAudioSampleAt = performance.now();
  updateCountdownAudio(true);
  $("settings").hidden = true;
  $("timer").hidden = false;
  renderTimer();
  $("pause-button").focus();
});

function finish() {
  state = "finished";
  remainingMs = 0;
}

// 呼び出し回数ではなく終了予定時刻との差で計算します。
// 遅延で複数区間をまたいだ場合も、元の終了時刻から順に追いつきます。
function synchronize(now = performance.now()) {
  if (state !== "running") return;
  while (now >= deadline && state === "running") {
    lastCountdownSecond = null;
    currentIndex += 1;
    if (currentIndex >= workout.length) finish();
    else deadline += workout[currentIndex].seconds * 1000;
  }
  if (state === "running") remainingMs = Math.max(0, deadline - now);
}

// 表示と同じ切り上げ秒数を記録。取り逃した秒の音は再生しません。
// 区間切替音は廃止し、カウントダウン音との重なりを避けます。
function updateCountdownAudio(allowAudio) {
  const seconds = Math.ceil(remainingMs / 1000);
  if (allowAudio && !document.hidden && state === "running" &&
      seconds >= 1 && seconds <= 5 && seconds !== lastCountdownSecond) beep();
  lastCountdownSecond = seconds;
}

function renderTimer() {
  const finished = state === "finished";
  const current = workout[currentIndex];
  const next = workout[currentIndex + 1];
  $("interval-count").textContent = `${finished ? workout.length : currentIndex + 1} / ${workout.length}`;
  const hasRound = !finished && Boolean(current.round);
  $("round-progress").hidden = !hasRound;
  $("round-progress").textContent = hasRound ? `ROUND ${current.round} / ${current.rounds}\nEXERCISE ${current.exercise} / ${current.exercises}` : "";
  $("timer-status").textContent = finished ? "FINISHED" : state === "paused" ? "PAUSED" : "IN PROGRESS";
  $("current-name").textContent = finished ? "おつかれさまでした！" : current.name;
  $("remaining-time").textContent = formatTime(Math.ceil(remainingMs / 1000));
  $("next-name").textContent = next ? next.name : finished ? "完了" : "FINISHED";
  $("next-duration").textContent = next ? `${next.seconds}秒 · ${formatTime(next.seconds)}` : "すべての区間が終了";
  $("interval-progress").value = finished ? 1 : 1 - remainingMs / (current.seconds * 1000);
  $("pause-button").hidden = finished;
  $("pause-button").textContent = state === "paused" ? "Resume" : "Pause";
  $("stop-button").hidden = state !== "paused";
  $("previous-button").disabled = finished || currentIndex === 0;
  $("next-button").disabled = finished;
  $("settings-button").hidden = !finished;
}

$("pause-button").addEventListener("click", () => {
  if (state !== "running" && state !== "paused") return;
  enableAudio();
  synchronize();
  updateCountdownAudio(false);
  if (state === "running") {
    state = "paused";
    stopSounds();
  }
  else if (state === "paused") {
    deadline = performance.now() + remainingMs;
    state = "running";
  }
  lastAudioSampleAt = performance.now();
  renderTimer();
});

function moveInterval(direction) {
  if (state === "settings") return;
  synchronize();
  if (state === "finished" || state === "settings") return renderTimer();
  const target = currentIndex + direction;
  if (target < 0) return;
  if (target >= workout.length) finish();
  else {
    currentIndex = target;
    remainingMs = workout[currentIndex].seconds * 1000;
    deadline = performance.now() + remainingMs;
  }
  updateCountdownAudio(false);
  lastAudioSampleAt = performance.now();
  renderTimer();
}
$("previous-button").addEventListener("click", () => moveInterval(-1));
$("next-button").addEventListener("click", () => moveInterval(1));
function returnToSettings() {
  state = "settings";
  stopSounds();
  workout = [];
  currentIndex = 0;
  remainingMs = 0;
  deadline = 0;
  lastCountdownSecond = null;
  $("timer").hidden = true;
  $("settings").hidden = false;
  document.querySelector(".start").focus();
}
$("settings-button").addEventListener("click", returnToSettings);
$("stop-button").addEventListener("click", () => {
  if (state === "paused") returnToSettings();
});

function refresh(allowAudio = true) {
  if (state === "running") {
    const now = performance.now();
    synchronize(now);
    // 長い停止・バックグラウンド復帰では、現在秒の音も抑制します。
    updateCountdownAudio(allowAudio && now - lastAudioSampleAt < 1500);
    lastAudioSampleAt = now;
    renderTimer();
  }
}
setInterval(refresh, 100);
document.addEventListener("visibilitychange", () => refresh(false));
