// clip-process.js 单元测试（clip 变速保音高 TSM + 变调半音 · 纯函数与 LRU 缓存）
// 浏览器管线 processClipAudio 依赖 OfflineAudioContext/AudioWorklet，node 下不可跑——
// 只测纯函数（processedLenOf/clipProcessKey/needsProcess）与模块级 LRU 缓存语义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processedLenOf, clipProcessKey, needsProcess,
  processedCacheKey, getProcessedCached, putProcessedCached, clearClipProcessCache,
} from '../js/clip-process.js';

// ---------- processedLenOf：处理后样本长度 = round(源/speed) ----------
test('processedLenOf：speed 1/2/0.5 取整、四舍五入、非法按 1 速原样返回', () => {
  assert.equal(processedLenOf(100, 1), 100, '1 速原长');
  assert.equal(processedLenOf(100, 2), 50, '2 倍速减半');
  assert.equal(processedLenOf(100, 0.5), 200, '半速加倍');
  assert.equal(processedLenOf(999, 2), 500, '四舍五入（499.5 → 500）');
  assert.equal(processedLenOf(1000, 3), 333, '三位速取整');
  // 非法 speed（非有限/≤0）→ 按 1 速兜底，返回源样本数
  assert.equal(processedLenOf(100, 0), 100, '0 速兜底');
  assert.equal(processedLenOf(100, -2), 100, '负速兜底');
  assert.equal(processedLenOf(100, NaN), 100, 'NaN 兜底');
  assert.equal(processedLenOf(100, 'abc'), 100, '非数值兜底');
  assert.equal(processedLenOf(100, Infinity), 100, 'Infinity 兜底');
});

// ---------- clipProcessKey：处理参数指纹形态 ----------
test('clipProcessKey：s{speed×100}|p{semitones} 形态，缺省 = s100|p0', () => {
  assert.equal(clipProcessKey({ speed: 1.5, pitchSemi: -3 }), 's150|p-3', 'speed×100 + 负半音');
  assert.equal(clipProcessKey({}), 's100|p0', '空 clip → 缺省指纹');
  assert.equal(clipProcessKey({ speed: 2 }), 's200|p0', '只 speed');
  assert.equal(clipProcessKey({ pitchSemi: 12 }), 's100|p12', '只 pitchSemi');
  assert.equal(clipProcessKey({ speed: 0.25, pitchSemi: 12 }), 's25|p12', '下界 speed');
  assert.equal(clipProcessKey(null), 's100|p0', 'null 防御');
  // 同参数同指纹（缓存键稳定性）：字段次序无关
  assert.equal(clipProcessKey({ pitchSemi: 5, speed: 2 }), clipProcessKey({ speed: 2, pitchSemi: 5 }));
});

// ---------- needsProcess：三态（不处理 / 变速 / 变调） ----------
test('needsProcess：speed≠1 或 pitchSemi≠0 才处理，缺省字段直通', () => {
  assert.equal(needsProcess({}), false, '无字段 → 直通');
  assert.equal(needsProcess({ speed: 1, pitchSemi: 0 }), false, '中性值 → 直通');
  assert.equal(needsProcess({ speed: 2 }), true, '仅变速');
  assert.equal(needsProcess({ pitchSemi: -3 }), true, '仅变调');
  assert.equal(needsProcess({ speed: 0.25, pitchSemi: 6 }), true, '变速+变调');
  assert.equal(needsProcess(null), false, 'null 防御 → 直通');
});

// ---------- LRU 缓存：触碰晋升 + 上限 8 淘汰 + 清空 ----------
test('clip-process LRU：上限 8、get 触碰晋升、clear 清空', () => {
  clearClipProcessCache();
  const mk = i => ({ channels: [new Float32Array(i), new Float32Array(i)], sampleRate: 44100, duration: i / 44100 });
  // 填满 8 条
  for (let i = 1; i <= 8; i++) putProcessedCached(`k${i}`, mk(i));
  assert.equal(getProcessedCached('k1').channels[0].length, 1, '命中 k1');
  getProcessedCached('k3'); // 触碰 k3 → 晋升为最新
  putProcessedCached('k9', mk(9)); // 淘汰最久未用 = k2（k1/k3 已被触碰晋升）
  assert.equal(getProcessedCached('k2'), undefined, 'k2 被逐出');
  assert.ok(getProcessedCached('k1'), 'k1 因触碰幸存');
  assert.ok(getProcessedCached('k3'), 'k3 因触碰幸存');
  assert.ok(getProcessedCached('k9'), '新条目在缓存');
  assert.equal(getProcessedCached('ghost'), undefined, '未命中返回 undefined');
  clearClipProcessCache();
  assert.equal(getProcessedCached('k1'), undefined, 'clear 后全空');
});

// ---------- processedCacheKey：键拼装形态（clipProcessKey + '#' + buffer 长度） ----------
test('processedCacheKey：指纹 # 源样本长度', () => {
  assert.equal(processedCacheKey({ speed: 1.5, pitchSemi: -3 }, 44100), 's150|p-3#44100');
  assert.equal(processedCacheKey({}, 0), 's100|p0#0');
});
