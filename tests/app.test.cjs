// 実行: node --test tests/app.test.cjs
// ブラウザ表示・実音声ではなく、疑似DOMと時計でロジックを検証します。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() { this.listeners = {}; this.attributes = {}; this.children = []; this.value = ''; }
  set value(value) { this.inputValue = String(value); }
  get value() { return this.inputValue; }
  get validity() {
    const n = Number(this.value);
    return { valid: this.type !== 'number' || (this.value !== '' && Number.isFinite(n) &&
      Number.isInteger(n) && n >= Number(this.min || 1) && (!this.max || n <= Number(this.max))) };
  }
  append(...children) { this.children.push(...children); }
  remove() { this.removed = true; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  focus() {}
}

function setup() {
  const elements = {};
  let now = 0;
  let sounds = 0;
  let resumes = 0;
  const oscillators = [];
  class AudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; }
    resume() { resumes++; return Promise.resolve(); }
    createOscillator() {
      const oscillator = {
        frequency: {}, connected: true,
        connect: () => ({ connect() {} }),
        start() { sounds++; },
        stop(when) { if (when === undefined) this.stoppedImmediately = true; },
        disconnect() { this.connected = false; }
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, disconnect() {} }; }
  }
  const document = {
    hidden: false, listeners: {},
    getElementById: (id) => elements[id] ||= new Element(),
    createElement: () => new Element(), createTextNode: (text) => text,
    querySelector: () => new Element(),
    addEventListener(event, handler) { this.listeners[event] = handler; }
  };
  for (const [id, value] of [['warmup-seconds', 120], ['work-seconds', 20], ['rest-seconds', 40], ['cooldown-seconds', 60], ['rounds', 1]]) {
    const input = document.getElementById(id);
    input.type = 'number'; input.min = ['warmup-seconds', 'cooldown-seconds'].includes(id) ? '0' : '1'; input.step = '1'; input.value = value;
    if (id !== 'rounds') input.max = '86400';
  }
  const context = vm.createContext({ document, window: { AudioContext }, performance: { now: () => now }, setInterval() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  const run = (code) => vm.runInContext(code, context);
  const click = (id) => elements[id].listeners.click();
  return {
    run, click, elements, document, oscillators,
    start: () => elements['workout-form'].listeners.submit({ preventDefault() {} }),
    advance(ms, refresh = true) { now += ms; if (refresh) run('refresh()'); },
    sounds: () => sounds, resumes: () => resumes,
    set(id, value) { elements[id].value = value; elements['workout-form'].listeners.input(); }
  };
}

test('default: 6 sets, 14 intervals, 540 seconds, START and NEXT', () => {
  const h = setup();
  assert.equal(h.elements['workout-summary'].textContent, '6運動セット · 14区間');
  assert.equal(h.elements['total-time'].textContent, '合計 09:00');
  h.start();
  assert.equal(h.run('workout.length'), 14);
  assert.equal(h.run('workout.reduce((sum,x)=>sum+x.seconds,0)'), 540);
  assert.equal(h.elements['current-name'].textContent, '準備運動');
  assert.equal(h.elements['remaining-time'].textContent, '02:00');
  assert.equal(h.elements['next-name'].textContent, 'ゴブレットスクワット');
  assert.equal(h.elements['next-duration'].textContent, '20秒 · 00:20');
  assert.equal(h.elements['round-progress'].hidden, true);
  assert.equal(h.resumes(), 1);
  h.advance(120000);
  assert.equal(h.elements['round-progress'].textContent, 'ROUND 1 / 1\nEXERCISE 1 / 6');
  assert.equal(h.elements['next-name'].textContent, '休憩');
});

test('add/delete, minimum one, edits reflected', () => {
  const h = setup();
  h.click('add-exercise');
  assert.equal(h.run('rows.length'), 7);
  assert.equal(h.run("'workInput' in rows[6] || 'restInput' in rows[6]"), false);
  h.run('while(rows.length>1) rows[0].removeButton.listeners.click()');
  assert.equal(h.run('rows[0].removeButton.disabled'), true);
  h.run('rows[0].removeButton.listeners.click()');
  assert.equal(h.run('rows.length'), 1);
  h.run("rows[0].nameInput.value='編集'");
  h.set('work-seconds', 7); h.set('rest-seconds', 9);
  h.set('warmup-seconds', 2); h.set('cooldown-seconds', 3);
  assert.equal(h.elements['total-time'].textContent, '合計 00:21');
  h.start();
  assert.equal(h.run('JSON.stringify(workout.map(x=>[x.name,x.seconds]))'), JSON.stringify([['準備運動',2],['編集',7],['休憩',9],['整理運動',3]]));
});

test('4 exercises x 2 rounds: order, boundaries, NEXT, pause, manual navigation', () => {
  const h = setup();
  h.run('while(rows.length>4) rows[rows.length-1].removeButton.listeners.click()');
  h.set('rounds', 2); h.start();
  assert.equal(h.elements['total-time'].textContent, '合計 11:00');
  assert.equal(h.run('workout.reduce((sum,x)=>sum+x.seconds,0)'), 660);
  assert.equal(h.run('workout.filter(x=>x.type==="work").length'), 8);
  assert.equal(h.run('workout.length'), 18);
  assert.equal(h.run('workout.filter(x=>x.type==="warmup").length'), 1);
  assert.equal(h.run('workout.filter(x=>x.type==="cooldown").length'), 1);
  assert.equal(h.run('JSON.stringify(workout.filter(x=>x.type==="work").map(x=>[x.round,x.exercise]))'), JSON.stringify([[1,1],[1,2],[1,3],[1,4],[2,1],[2,2],[2,3],[2,4]]));
  h.advance(320000); // 1周目の4種目目の休憩
  assert.equal(h.run('currentIndex'), 8);
  assert.equal(h.elements['round-progress'].textContent, 'ROUND 1 / 2\nEXERCISE 4 / 4');
  assert.equal(h.elements['next-name'].textContent, 'ゴブレットスクワット');
  h.click('pause-button'); h.advance(600000);
  assert.equal(h.run('remainingMs'), 40000);
  h.click('next-button');
  assert.equal(h.run('state'), 'paused');
  assert.equal(h.run('remainingMs'), 20000);
  assert.equal(h.elements['round-progress'].textContent, 'ROUND 2 / 2\nEXERCISE 1 / 4');
  h.click('previous-button'); assert.equal(h.run('currentIndex'), 8);
  h.click('pause-button'); h.advance(40000);
  assert.equal(h.run('currentIndex'), 9);
  assert.equal(h.run('workout[currentIndex].round'), 2);
  h.advance(240000);
  assert.equal(h.run('workout[currentIndex].type'), 'cooldown');
  assert.equal(h.elements['round-progress'].hidden, true);
  h.advance(60000);
  assert.equal(h.run('state'), 'finished');
  assert.equal(h.elements['timer-status'].textContent, 'FINISHED');
  h.click('settings-button'); assert.equal(h.run('state'), 'settings');
});

test('fractional pause/resume preserves time, Previous first boundary, manual FINISHED', () => {
  const h = setup(); h.start(); h.advance(125250); h.click('pause-button');
  assert.equal(h.run('remainingMs'), 14750);
  h.advance(600000); h.click('pause-button'); h.advance(5500);
  assert.equal(h.run('remainingMs'), 9250);
  h.click('previous-button'); assert.equal(h.run('remainingMs'), 120000);
  h.click('previous-button'); assert.equal(h.run('currentIndex'), 0);
  for (let i=0; i<14; i++) h.click('next-button');
  assert.equal(h.run('state'), 'finished');
});

test('5..1 countdown fires once each, no transition beep, every interval type', () => {
  const h = setup(); h.set('warmup-seconds', 6); h.set('cooldown-seconds', 6);
  h.run('while(rows.length>1) rows[1].removeButton.listeners.click()');
  h.set('work-seconds', 6); h.set('rest-seconds', 6);
  h.start();
  for (let interval=0; interval<4; interval++) {
    for (let second=5; second>=1; second--) {
      h.advance(1000); const before = h.sounds();
      assert.equal(before, interval*5+6-second);
      for(let i=0;i<8;i++) h.run('refresh()');
      assert.equal(h.sounds(), before);
    }
    h.advance(1000);
    assert.equal(h.sounds(), (interval+1)*5);
  }
  assert.equal(h.run('state'), 'finished');
});

test('pause/resume, manual navigation and background never replay old audio', () => {
  const h = setup(); h.set('warmup-seconds', 6); h.start(); h.advance(1000);
  assert.equal(h.sounds(), 1); h.click('pause-button'); h.advance(90000);
  assert.equal(h.sounds(), 1); h.click('pause-button'); h.advance(100);
  assert.equal(h.sounds(), 1); h.advance(900); assert.equal(h.sounds(), 2);
  h.click('next-button'); h.click('previous-button'); h.run('refresh()');
  assert.equal(h.sounds(), 2);
  h.document.hidden = true; h.document.listeners.visibilitychange();
  h.advance(4000); assert.equal(h.sounds(), 2);
  h.document.hidden = false; h.document.listeners.visibilitychange(); h.run('refresh()');
  assert.equal(h.sounds(), 2); h.advance(1000); assert.equal(h.sounds(), 3);
});

test('long delay skips missed beeps and catches up multiple intervals', () => {
  const h = setup(); h.set('warmup-seconds', 6); h.start();
  h.advance(4000); assert.equal(h.sounds(), 0);
  h.advance(1000); assert.equal(h.sounds(), 1);
  h.advance(181000); assert.equal(h.run('currentIndex'), 7);
  assert.equal(h.run('remainingMs'), 20000);
  assert.equal(h.sounds(), 1);
});

test('invalid names, seconds, rounds and excessive interval count rejected', () => {
  const h = setup();
  for (const id of ['warmup-seconds','work-seconds','rest-seconds','cooldown-seconds','rounds']) {
    const invalidValues = ['', '-1', '1.5', 'abc', 'Infinity'];
    if (!['warmup-seconds', 'cooldown-seconds'].includes(id)) invalidValues.push('0');
    for (const value of invalidValues) {
      h.set(id,value); h.start(); assert.equal(h.run('state'), 'settings');
    }
    h.set(id,1);
  }
  for (const id of ['warmup-seconds','work-seconds','rest-seconds','cooldown-seconds']) {
    h.set(id,86401); h.start(); assert.equal(h.run('state'), 'settings');
    h.set(id,20);
  }
  h.run("rows[0].nameInput.value='   '"); h.start(); assert.equal(h.run('state'), 'settings');
  h.run("rows[0].nameInput.value='有効'"); h.set('rounds', 1000000); h.start();
  assert.equal(h.run('state'), 'settings');
  h.set('rounds',1); h.start(); assert.equal(h.run('state'), 'running');
});

test('common durations apply to all exercises in every round, including added exercises', () => {
  const h = setup();
  h.set('work-seconds', 7); h.set('rest-seconds', 9); h.set('rounds', 2);
  h.click('add-exercise');
  assert.equal(h.elements['total-time'].textContent, '合計 06:44');
  assert.equal(h.run('JSON.stringify(readSettings().exercises)'), JSON.stringify(['ゴブレットスクワット','ハイニーマーチ','ルーマニアンデッドリフト','サイドステップ','ダンベルロウ','ステップバック','新しい種目']));
  h.start();
  assert.equal(h.run('workout.filter(x=>x.type==="work").length'), 14);
  assert.equal(h.run('workout.filter(x=>x.type==="work").every(x=>x.seconds===7)'), true);
  assert.equal(h.run('workout.filter(x=>x.type==="rest").every(x=>x.seconds===9)'), true);
  assert.equal(h.run('workout[workout.length-2].type'), 'rest');
});

test('Pause shows Resume and Stop; Stop preserves settings, silences audio, and restart resets', () => {
  const h = setup();
  h.run('rows[0].nameInput.value="編集済み"; rows[5].removeButton.listeners.click()');
  h.set('rounds', 2); h.set('warmup-seconds', 8); h.set('work-seconds', 6);
  h.set('rest-seconds', 7); h.set('cooldown-seconds', 9);
  const settings = h.run('JSON.stringify(readSettings())');
  h.start();
  assert.equal(h.elements['pause-button'].textContent, 'Pause');
  assert.equal(h.elements['stop-button'].hidden, true);
  h.advance(8000); h.advance(1000); // 最初の種目の残り5秒で音が鳴る
  assert.equal(h.sounds(), 1);
  h.click('pause-button');
  assert.equal(h.elements['pause-button'].textContent, 'Resume');
  assert.equal(h.elements['stop-button'].hidden, false);
  assert.equal(h.oscillators[0].stoppedImmediately, true);
  assert.equal(h.oscillators[0].connected, false);
  // Stopそのものも再生中の音を停止できることを確認。
  h.run('beep()');
  const soundCount = h.sounds();
  h.click('stop-button');
  assert.equal(h.run('state'), 'settings');
  assert.equal(h.elements.timer.hidden, true);
  assert.equal(h.elements.settings.hidden, false);
  assert.notEqual(h.elements['timer-status'].textContent, 'FINISHED');
  assert.equal(h.oscillators.every(x=>x.stoppedImmediately && !x.connected), true);
  assert.equal(h.run('activeSounds.size'), 0);
  assert.equal(h.run('JSON.stringify(readSettings())'), settings);
  h.advance(1000000); h.document.listeners.visibilitychange();
  assert.equal(h.run('state'), 'settings');
  assert.equal(h.run('remainingMs'), 0);
  assert.equal(h.run('workout.length'), 0);
  assert.equal(h.sounds(), soundCount);
  h.start();
  assert.equal(h.run('currentIndex'), 0);
  assert.equal(h.run('remainingMs'), 8000);
  assert.equal(h.elements['current-name'].textContent, '準備運動');
  assert.equal(h.elements['next-name'].textContent, '編集済み');
  assert.equal(h.elements['stop-button'].hidden, true);
  assert.equal(h.elements['pause-button'].textContent, 'Pause');
  h.advance(1000); assert.equal(h.run('remainingMs'), 7000);
});

for (const [label, warmup, cooldown, count, total] of [
  ['warm-up omitted', 0, 60, 13, 420],
  ['cool-down omitted', 120, 0, 13, 480],
  ['both omitted', 0, 0, 12, 360]
]) {
  test(`${label}: totals, NEXT, interval count and automatic first/last transitions`, () => {
    const h = setup();
    h.set('warmup-seconds', warmup); h.set('cooldown-seconds', cooldown);
    assert.equal(h.elements['workout-summary'].textContent, `6運動セット · ${count}区間`);
    assert.equal(h.elements['total-time'].textContent, `合計 ${String(total / 60).padStart(2, '0')}:00`);
    h.start();
    assert.equal(h.run('state'), 'running');
    const intervals = JSON.parse(h.run('JSON.stringify(workout)'));
    assert.equal(intervals.length, count);
    assert.equal(intervals.reduce((sum, x) => sum + x.seconds, 0), total);
    assert.equal(intervals.every(x => x.seconds > 0), true);
    assert.equal(intervals.filter(x => x.type === 'warmup').length, warmup ? 1 : 0);
    assert.equal(intervals.filter(x => x.type === 'cooldown').length, cooldown ? 1 : 0);
    assert.equal(intervals[0].type, warmup ? 'warmup' : 'work');
    assert.equal(intervals.at(-1).type, cooldown ? 'cooldown' : 'rest');
    assert.equal(h.elements['previous-button'].disabled, true);
    assert.equal(h.sounds(), 0);
    // 全区間の直前・直後を検証。0秒区間による中間表示や余分な音がないことも確認。
    intervals.forEach((interval, index) => {
      assert.equal(h.run('currentIndex'), index);
      assert.equal(h.elements['interval-count'].textContent, `${index + 1} / ${count}`);
      assert.equal(h.elements['current-name'].textContent, interval.name);
      assert.equal(h.elements['next-name'].textContent, intervals[index + 1]?.name || 'FINISHED');
      if (intervals[index + 1]) {
        const next = intervals[index + 1];
        const formatted = `${String(Math.floor(next.seconds / 60)).padStart(2, '0')}:${String(next.seconds % 60).padStart(2, '0')}`;
        assert.equal(h.elements['next-duration'].textContent, `${next.seconds}秒 · ${formatted}`);
      }
      h.advance(interval.seconds * 1000 - 1);
      assert.equal(h.run('currentIndex'), index);
      assert.equal(h.run('remainingMs'), 1);
      h.advance(1);
      assert.equal(h.run('currentIndex'), index + 1);
    });
    assert.equal(h.run('state'), 'finished');
    assert.equal(h.elements['timer-status'].textContent, 'FINISHED');
    assert.equal(h.elements['remaining-time'].textContent, '00:00');
    assert.equal(h.sounds(), 0); // 大きな時刻ジャンプで取り逃した音も再生しない
  });
}

test('both omitted: countdown audio only for work/rest and no extra transition at finish', () => {
  const h = setup();
  h.run('while(rows.length>1) rows[1].removeButton.listeners.click()');
  h.set('warmup-seconds', 0); h.set('cooldown-seconds', 0);
  h.set('work-seconds', 6); h.set('rest-seconds', 6);
  h.start();
  assert.equal(h.elements['current-name'].textContent, 'ゴブレットスクワット');
  assert.equal(h.elements['round-progress'].textContent, 'ROUND 1 / 1\nEXERCISE 1 / 1');
  for (let interval = 0; interval < 2; interval++) {
    for (let second = 5; second >= 1; second--) {
      h.advance(1000);
      assert.equal(h.sounds(), interval * 5 + 6 - second);
      h.run('refresh()');
      assert.equal(h.sounds(), interval * 5 + 6 - second);
    }
    h.advance(1000);
    assert.equal(h.sounds(), (interval + 1) * 5);
  }
  assert.equal(h.run('state'), 'finished');
  h.advance(1000); assert.equal(h.sounds(), 10);
});

test('both omitted: pause/resume, Previous/Next, Stop and restart remain usable', () => {
  const h = setup(); h.set('warmup-seconds', 0); h.set('cooldown-seconds', 0);
  h.start(); h.advance(1250); h.click('pause-button'); h.advance(60000);
  assert.equal(h.run('remainingMs'), 18750);
  h.click('next-button'); assert.equal(h.run('remainingMs'), 40000);
  h.click('previous-button'); assert.equal(h.run('remainingMs'), 20000);
  assert.equal(h.run('state'), 'paused');
  h.click('previous-button'); assert.equal(h.run('currentIndex'), 0);
  h.click('pause-button'); h.advance(1000); assert.equal(h.run('remainingMs'), 19000);
  h.click('pause-button'); h.click('stop-button'); h.advance(60000);
  assert.equal(h.run('state'), 'settings');
  assert.equal(h.elements['warmup-seconds'].value, '0');
  assert.equal(h.elements['cooldown-seconds'].value, '0');
  h.start(); assert.equal(h.run('currentIndex'), 0);
  assert.equal(h.elements['current-name'].textContent, 'ゴブレットスクワット');
  assert.equal(h.run('remainingMs'), 20000);
});
