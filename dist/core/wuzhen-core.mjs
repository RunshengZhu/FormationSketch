/* wuzhen-core —— 由 scripts/build-core.mjs 生成，勿手改。
 * 源文件：js/model.js + js/shapes.js + js/choreo-extra.js（与 app 同源，零漂移）
 * 重建：node scripts/build-core.mjs
 */

/* ===== module: model.js ===== */
// 数据模型与时间轴计算 —— 纯逻辑，无 DOM 依赖（可在 Node 中单测）
// 约定：坐标单位米，原点舞台左上，+x 右 +y 下；角度 0=上(−y)、顺时针、0..359

const DEFAULT_BPM = 120;
const ROLE_COLOR = { M: '#3b82f6', F: '#ec4899', X: '#10b981' };
const ROLE_NAME = { M: '男', F: '女', X: '其他' };

let _uidCounter = 0;
function uid(prefix = 'id') {
  _uidCounter = (_uidCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${_uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// ---------- 创建 ----------
function addDancer(project, name, role = 'X', short = '') {
  const d = { id: uid('d'), name, short: short || nextShort(project, role), role, color: ROLE_COLOR[role] || ROLE_COLOR.X };
  project.dancers.push(d);
  for (const f of project.formations) ensureDancerInFormation(project, f, d.id);
  return d;
}
function nextShort(project, role) {
  const used = new Set(project.dancers.map(d => d.short));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}
// createProject：pairs=「对数」（M/F 交替生成的数量语义，无任何绑定）；grouping=预定义编组方案
//   'gender'（默认）→ 建「男士」「女士」两组；'none' → 不建组。
// presetMerged=true → 初始化预设「已组合」：开场队形对每对 addMerge(…,'capsule') 并
//   collapseUnit 收拢到各对默认点位的中点（保持双横排布局节奏），建档即成 pairs 个合并单元；
//   两人间距 0 ≤ 合并阈值，呈示为胶囊；拖动/拆开走既有单元原子语义。旧项目载入不受影响。
function createProject({ title = '未命名队列舞', pairs = 6, extraM = 0, extraF = 0, grouping = 'gender', presetMerged = false } = {}) {
  const project = {
    version: 1,
    meta: { title, team: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    stage: { widthM: 12, depthM: 16, audience: 'bottom', gridM: 0.5, snap: true, backstageM: 2, bgImage: null },
    audio: { name: '', durationSec: 0, bpm: DEFAULT_BPM, beatsPerBar: 4, firstBeatSec: 0 },
    media: { assets: [], activeAssetId: null }, // v3 音乐剪辑：媒体资产库（blob 走存储层，项目记录只存元数据）
    settings: { labelMode: 'no' }, // 项目级显示设置：'no'=编号序号(1..N) | 'short'=简称 | 'name'=姓名
    dancers: [], groups: [], formations: [],
    timeline: { blocks: [], countInBeats: 8, metronome: false, playSpeed: 1, tags: [], audioClips: [], tracks: [defaultTrack()] },
  };
  for (let i = 1; i <= pairs; i++) {
    addDancer(project, `M${i}`, 'M', String(i));
    addDancer(project, `F${i}`, 'F', String(i));
  }
  for (let i = 1; i <= extraM; i++) addDancer(project, `M${pairs + i}`, 'M');
  for (let i = 1; i <= extraF; i++) addDancer(project, `F${pairs + i}`, 'F');
  if (grouping === 'gender') {
    const men = project.dancers.filter(d => d.role === 'M').map(d => d.id);
    const women = project.dancers.filter(d => d.role === 'F').map(d => d.id);
    if (men.length) project.groups.push({ id: uid('g'), name: '男士', memberIds: men });
    if (women.length) project.groups.push({ id: uid('g'), name: '女士', memberIds: women });
  }
  // 初始队形：双横排
  const f = { id: uid('f'), name: '开场队形', color: '#64748b', note: '', positions: {} };
  project.formations.push(f);
  genDefaultRows(project, f);
  if (presetMerged) applyPresetMerged(project, f, pairs);
  syncTimeline(project);
  return project;
}
// 「已组合」预设后处理：M_i×F_i 两两合并为 capsule 单元并收拢（位置=各对的默认队形点位中点）。
// 收拢后间距 0 ≤ 合并阈值 0.8m → 呈示为胶囊徽标；数据形态与手动 merge 完全一致（帧级 merges）。
function applyPresetMerged(project, f, pairs) {
  const byName = n => project.dancers.find(d => d.name === n);
  for (let i = 1; i <= pairs; i++) {
    const m = byName(`M${i}`), w = byName(`F${i}`);
    if (!m || !w) continue;
    if (addMerge(f, m.id, w.id, 'capsule')) collapseUnit(f, m.id, w.id);
  }
}
function genDefaultRows(project, f) {
  const ids = orderedDancers(project);
  const { widthM: W, depthM: H } = project.stage;
  const n = ids.length, rows = n <= 4 ? 1 : 2, m = 1.5;
  const per = Math.ceil(n / rows);
  const spacing = per > 1 ? (W - 2 * m) / (per - 1) : 0;
  const face = faceAudience(project.stage);
  ids.forEach((id, i) => {
    const r = Math.floor(i / per), c = i % per;
    const rowCount = Math.min(per, n - r * per);
    const off = (per - rowCount) * spacing / 2;
    f.positions[id] = { x: m + off + c * spacing, y: H / 2 + (r - (rows - 1) / 2) * 1.6, facing: face };
  });
}

// ---------- 舞者 / 编组 ----------
function dancerById(project, id) { return project.dancers.find(d => d.id === id) || null; }
function orderedDancers(project) { return project.dancers.map(d => d.id); }
function removeDancer(project, dancerId) {
  project.dancers = project.dancers.filter(d => d.id !== dancerId);
  // 编组成员联动清理（删除组≠删除舞者；反之删舞者需清引用）
  for (const g of project.groups || []) g.memberIds = (g.memberIds || []).filter(id => id !== dancerId);
  for (const f of project.formations) {
    delete f.positions[dancerId];
    // 帧内合并单元引用一并清理（保证 positions 键 === dancers id、merges 不悬挂）
    if (f.merges) {
      f.merges = f.merges.filter(m => m.a !== dancerId && m.b !== dancerId);
      if (!f.merges.length) delete f.merges;
    }
  }
}

// ---------- RTS 式编组（project.groups：纯选择辅助，可与合并交叉叠加，不改变渲染/数据语义） ----------
function groupById(project, groupId) { return (project.groups || []).find(g => g.id === groupId) || null; }
function nextGroupName(project) {
  const used = new Set((project.groups || []).map(g => g.name));
  let n = 1;
  while (used.has(`组${n}`)) n++;
  return `组${n}`;
}
function createGroup(project, memberIds = [], name = '') {
  const g = { id: uid('g'), name: name || nextGroupName(project), memberIds: [...memberIds] };
  project.groups = project.groups || [];
  project.groups.push(g);
  return g;
}
function removeGroup(project, groupId) {
  project.groups = (project.groups || []).filter(g => g.id !== groupId);
}
function renameGroup(project, groupId, name) {
  const n = String(name ?? '').trim().slice(0, 40);
  if (!n) return;
  const g = groupById(project, groupId);
  if (g) g.name = n;
}
function setGroupMembers(project, groupId, memberIds) {
  const g = groupById(project, groupId);
  if (g) g.memberIds = [...new Set(memberIds)];
}
// 组选择的单元原子展开：成员若在合并单元中，展开为整单元两人
function expandUnits(formation, ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const m = formation && (formation.merges || []).find(x => x.a === id || x.b === id);
    for (const u of (m ? [m.a, m.b] : [id])) {
      if (!seen.has(u)) { seen.add(u); out.push(u); }
    }
  }
  return out;
}
// 从更早的队形顺延缺失舞者的位置（查不到则放舞台中心附近）
function carryPositionsForward(project, index) {
  const f = project.formations[index];
  if (!f) return;
  const { widthM, depthM } = project.stage;
  for (const d of project.dancers) {
    if (f.positions[d.id]) continue;
    let found = null;
    for (let i = index - 1; i >= 0 && !found; i--) {
      const prev = project.formations[i].positions[d.id];
      if (prev) found = { x: prev.x, y: prev.y, facing: prev.facing };
    }
    f.positions[d.id] = found || { x: widthM / 2, y: depthM / 2, facing: faceAudience(project.stage) };
  }
}
// ---------- 帧内合并单元（任意两名舞者合为一个呈示符号） ----------
const UNIT_STYLES = ['capsule', 'single'];
const mergeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
function findMerge(formation, idA, idB) {
  const key = mergeKey(idA, idB);
  return (formation.merges || []).find(m => mergeKey(m.a, m.b) === key) || null;
}
function addMerge(formation, idA, idB, style = 'capsule') {
  if (idA === idB || findMerge(formation, idA, idB)) return null;
  if (!UNIT_STYLES.includes(style)) style = 'capsule';
  // 一名舞者同时只属于一个合并单元：先解除两人涉及的其他绑定（替换语义）
  formation.merges = (formation.merges || []).filter(m => m.a !== idA && m.b !== idA && m.a !== idB && m.b !== idB);
  const m = { a: idA, b: idB, style };
  formation.merges.push(m);
  return m;
}
function removeMerge(formation, idA, idB) {
  const key = mergeKey(idA, idB);
  formation.merges = (formation.merges || []).filter(m => mergeKey(m.a, m.b) !== key);
}
function setMergeStyle(formation, idA, idB, style) {
  const m = findMerge(formation, idA, idB);
  if (m && UNIT_STYLES.includes(style)) m.style = style;
}
// 把合并单元两人收拢/拆开到标准间距（用于呈示切换与合并确认的后处理）
function collapseUnit(f, idA, idB) {
  const a = f.positions[idA], b = f.positions[idB];
  if (!a || !b) return;
  const mx = Math.round(((a.x + b.x) / 2) * 100) / 100;
  const my = Math.round(((a.y + b.y) / 2) * 100) / 100;
  a.x = b.x = mx; a.y = b.y = my;
}
// 帧布局顺延：仅补齐缺席舞者位置；合并单元完全由手动操作创建
function applyFormationLayout(project, index) {
  const f = project.formations[index];
  if (!f) return;
  carryPositionsForward(project, index);
}
// 按名册当前列表顺序重编 short（第 n 人 = n）
function renumberShorts(project) {
  project.dancers.forEach((d, i) => { d.short = String(i + 1); });
}

// ---------- 舞者标签（canvas 呈示文本；round23 需求 2 显示字段可切换） ----------
// labelMode：'no'=编号序号(1..N，名册顺序) | 'short'=简称 | 'name'=姓名（缺失回退简称→序号）。
// 默认 'no'：标准建档（short=序号）下呈示与历史版本逐字节一致（零迁移成本）。
const LABEL_MODES = ['no', 'short', 'name'];
function labelModeOf(project) {
  const lm = project?.settings?.labelMode;
  return LABEL_MODES.includes(lm) ? lm : 'no';
}
function dancerOrdinal(project, dancerId) {
  const i = project.dancers.findIndex(d => d.id === dancerId);
  return i + 1; // 0 → 无此人
}
function dancerLabel(project, dancer, ordinal = dancerOrdinal(project, dancer?.id)) {
  const no = ordinal > 0 ? String(ordinal) : String(dancer?.short ?? '?');
  if (!dancer) return no;
  const mode = labelModeOf(project);
  if (mode === 'name') { const nm = String(dancer.name ?? '').trim(); return nm || dancer.short || no; }
  if (mode === 'short') return String(dancer.short ?? '') || no;
  return no;
}
// 长名截断省略：圆内空间约 4 字符（名称模式>4 截为 3+…；序号/简称通常不受影响）
function truncateLabel(s, max = 4) {
  const t = String(s ?? '');
  return t.length <= max ? t : t.slice(0, Math.max(1, max - 1)) + '…';
}

// ---------- 队形 ----------
function faceAudience(stage) { return { bottom: 180, top: 0, left: 270, right: 90 }[stage.audience] ?? 180; }
function ensureDancerInFormation(project, formation, dancerId) {
  if (formation.positions[dancerId]) return;
  const n = Object.keys(formation.positions).length;
  formation.positions[dancerId] = {
    x: project.stage.widthM / 2 + (n % 5 - 2) * 0.6,
    y: project.stage.depthM / 2 + (Math.floor(n / 5) - 1) * 0.6,
    facing: faceAudience(project.stage),
  };
}
function ensureFormationComplete(project, formation) {
  for (const d of project.dancers) ensureDancerInFormation(project, formation, d.id);
}
function createFormationFrom(project, srcIndex, { name } = {}) {
  const src = project.formations[srcIndex];
  const f = {
    id: uid('f'), name: name || `队形 ${project.formations.length + 1}`,
    color: ['#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'][project.formations.length % 6],
    note: src?.note || '', 
    positions: src ? clone(src.positions) : {},
    merges: src && src.merges ? clone(src.merges) : [],
  };
  if (srcIndex >= 0 && srcIndex < project.formations.length - 1) project.formations.splice(srcIndex + 1, 0, f);
  else project.formations.push(f);
  ensureFormationComplete(project, f);
  syncTimeline(project);
  return f;
}
function deleteFormation(project, index) {
  if (project.formations.length <= 1) return null;
  const [rm] = project.formations.splice(index, 1);
  syncTimeline(project);
  return rm;
}
function moveFormation(project, from, to) {
  if (from === to || from < 0 || from >= project.formations.length) return;
  const [f] = project.formations.splice(from, 1);
  project.formations.splice(clamp(to, 0, project.formations.length), 0, f);
  syncTimeline(project);
}
function formationIndexById(project, fid) { return project.formations.findIndex(f => f.id === fid); }

// ---------- 时间轴 ----------
function syncTimeline(project) {
  const old = new Map(project.timeline.blocks.map(b => [b.formationId, b]));
  project.timeline.blocks = project.formations.map(f => {
    const o = old.get(f.id);
    return { formationId: f.id, holdBeats: o?.holdBeats ?? 16, travelBeats: o?.travelBeats ?? 8 };
  });
}
function spb(project) { return 60 / (project.audio.bpm || DEFAULT_BPM); }
function beatToSec(project, beat) { return (project.audio.firstBeatSec || 0) + beat * spb(project); }
function secToBeat(project, sec) { return (sec - (project.audio.firstBeatSec || 0)) / spb(project); }

function computeSegments(project) {
  const blocks = project.timeline.blocks, formations = project.formations;
  const segs = [];
  let b = 0;
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    const hasTravel = i < blocks.length - 1;
    const holdStart = b, holdEnd = b + Math.max(0, blk.holdBeats);
    const travelEnd = hasTravel ? holdEnd + Math.max(0, blk.travelBeats) : holdEnd;
    segs.push({ i, formationId: blk.formationId, holdStart, holdEnd, travelEnd, hasTravel });
    b = travelEnd;
  }
  return { segments: segs, totalBeats: b };
}
function totalDurationSec(project) {
  const { totalBeats } = computeSegments(project);
  return beatToSec(project, totalBeats);
}
function segmentAt(segments, beat) {
  if (!segments.length) return null;
  if (beat <= 0) return segments[0];
  for (const s of segments) if (beat < s.travelEnd) return s;
  return segments[segments.length - 1];
}

// ---------- 时间轴标记（音乐时间轴 tag 道：主歌/副歌/间奏等分段记号） ----------
// 纯拍位标记：beat 为浮点拍，与 blocks 同基准——随 BPM/首拍自然换算秒位（beatToSec），
// 不参与播放/循环/队形任何逻辑；name 非空、≤ TAG_NAME_MAX 字（超长截断）。
const TAG_NAME_MAX = 20;
function cleanTagName(name) { return String(name ?? '').trim().slice(0, TAG_NAME_MAX); }
// 清洗（validateProject/导入入口共用）：丢弃非合法项——beat 非有限或负值、清洗后 name 为空、
// 重复 id（保首个弃后续）；id 缺失/空则补 uid。返回新数组，不改输入。
// color（W1 段色板 0..3）：合法整数则透传；无/非法 → 输出不含该键（shape 与既有逐值一致）。
function sanitizeTags(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    if (!t || typeof t !== 'object') continue;
    const beat = Number(t.beat);
    if (!Number.isFinite(beat) || beat < 0) continue;
    const name = cleanTagName(t.name);
    if (!name) continue;
    const id = (typeof t.id === 'string' && t.id) ? t.id : uid('tag');
    if (seen.has(id)) continue;
    seen.add(id);
    const colorOk = Number.isInteger(t.color) && t.color >= 0 && t.color < SEG_COLOR_COUNT;
    out.push(colorOk ? { id, beat, name, color: t.color } : { id, beat, name });
  }
  return out;
}
function tagById(project, id) { return (project.timeline.tags || []).find(t => t.id === id) || null; }
// 默认名「标记 N」：N 从现有数量+1 起找第一个未被占用的号（删除后打点不重号）
function nextTagName(project) {
  const tags = project.timeline.tags || [];
  const used = new Set(tags.map(t => t.name));
  let n = tags.length + 1;
  while (used.has(`标记 ${n}`)) n++;
  return `标记 ${n}`;
}
function addTag(project, beat, name = '') {
  project.timeline.tags = project.timeline.tags || [];
  const b = Number(beat);
  const t = { id: uid('tag'), beat: Number.isFinite(b) ? Math.max(0, b) : 0, name: cleanTagName(name) || nextTagName(project) };
  project.timeline.tags.push(t);
  return t;
}
function removeTag(project, id) {
  project.timeline.tags = (project.timeline.tags || []).filter(t => t.id !== id);
}
function renameTag(project, id, name) {
  const t = tagById(project, id);
  const n = cleanTagName(name);
  if (t && n) t.name = n;
}
function moveTag(project, id, beat) {
  const t = tagById(project, id);
  const b = Number(beat);
  if (t && Number.isFinite(b)) t.beat = Math.max(0, Math.round(b * 100) / 100);
}
// tag.color（W1 节奏划分轨换色）：0..3 = 段色板索引（呈示层 SEG_COLORS 解释）；缺省=按段序 4 色循环。
// 可选字段、向后兼容：旧项目无 color → sanitize 原样不含该键（shape 与既有逐值一致，零迁移成本）。
const SEG_COLOR_COUNT = 4;

// ---------- 节奏划分轨（W1 §2.2.1）：段 = 相邻 tags 派生区间，落标 = 批量写 timeline.tags ----------
// 段派生（纯函数）：段 i = [tags[i].beat, tags[i+1].beat)，末段到曲终（totalBeats）；
// 首个 tag 之前的区间不属任何段（呈示为未划分灰底）。零长段（重复拍位）跳过。
function sectionSegmentsOf(project) {
  const tags = [...(project.timeline.tags || [])].sort((a, b) => a.beat - b.beat || String(a.id).localeCompare(String(b.id)));
  const { totalBeats } = computeSegments(project);
  const segs = [];
  for (let i = 0; i < tags.length; i++) {
    const start = tags[i].beat;
    const end = i + 1 < tags.length ? tags[i + 1].beat : Math.max(totalBeats, start);
    if (end > start) segs.push({ i, tag: tags[i], start, end });
  }
  return { segs, totalBeats };
}
const r2 = v => Math.round(v * 100) / 100;
// 来源①均分 N 段：按 totalBeats/N 生成 N 个段起点拍位（含 0）。N 钳制 1..64；totalBeats≤0 → []。
function evenSectionBeats(totalBeats, n) {
  const T = Number(totalBeats), k = Math.round(Number(n));
  if (!(T > 0) || !(k >= 1) || !(k <= 64)) return [];
  const out = [];
  for (let i = 0; i < k; i++) {
    const b = r2((T * i) / k);
    if (!out.length || b > out[out.length - 1]) out.push(b); // 舍入产生的重复拍位去重
  }
  return out;
}
// 来源②按小节规则：规则表循环落标（缺省 主歌16拍→副歌8拍 交替；可后续接 skill DENSITY_RULES）。
// 重复段名追加序号（主歌1/副歌1/主歌2…）供索引列表区分。返回 [{name, beat}]。
function barRuleSections(totalBeats, rules = [{ name: '主歌', beats: 16 }, { name: '副歌', beats: 8 }]) {
  const T = Number(totalBeats);
  if (!(T > 0) || !Array.isArray(rules) || !rules.length) return [];
  const out = [];
  let b = 0, round = 0;
  const usedCount = {};
  while (b < T && out.length < 256) {
    const rule = rules[round % rules.length];
    const len = Math.max(0.5, Number(rule.beats) || 0);
    usedCount[rule.name] = (usedCount[rule.name] || 0) + 1;
    out.push({ name: rules.length > 1 ? `${rule.name}${usedCount[rule.name]}` : rule.name, beat: r2(b) });
    b += len;
    round++;
  }
  return out;
}
// 来源③导入段落表解析（纯函数）：「前奏8 主歌32 副歌32」/「前奏 8，主歌 32」/换行分隔均可。
// 每个词条 = 名称+拍数（拍数可带小数）；任一词条不合法 → 整表拒绝（返回 []，调用方 toast）。
// 名称不含空白/数字开头歧义：以「非数字结尾」切分；上限 256 段。
function parseSectionTable(text) {
  const raw = String(text || '').trim().split(/[\s,，;；、]+/).filter(Boolean);
  if (!raw.length) return [];
  // 「名称」与「拍数」被空白拆开（「前奏 8」）时回拼到前一词；纯数字词不独立成段
  const tokens = [];
  for (const tok of raw) {
    if (/^\d+(?:\.\d+)?$/.test(tok) && tokens.length) tokens[tokens.length - 1] += tok;
    else tokens.push(tok);
  }
  const out = [];
  for (const tok of tokens) {
    const m = /^(.+?)(\d+(?:\.\d+)?)$/.exec(tok);
    const name = m ? m[1].trim() : '';
    const beats = m ? Number(m[2]) : NaN;
    if (!name || !(beats > 0)) return [];
    out.push({ name, beats });
  }
  return out.length > 256 ? [] : out;
}
// 段落表 → 段起点序列（累计拍位，越过曲终即止；末段由派生规则自动延到曲终）
function sectionTableToEntries(entries, totalBeats) {
  const T = Number(totalBeats);
  if (!(T > 0) || !Array.isArray(entries) || !entries.length) return [];
  const out = [];
  let b = 0;
  for (const e of entries) {
    if (b >= T || out.length >= 256) break;
    out.push({ name: e.name, beat: r2(b) });
    b += Math.max(0.5, Number(e.beats) || 0);
  }
  return out;
}
// 落标（唯一写入点）：整体替换 timeline.tags（划分=定义全曲结构；undo 一键还原）。
// entries: [{name, beat}]（color 可选 0..3）。拍位钳非负、保留 2 位小数；名称清洗（空→「段落 k」）。
function applySectionEntries(project, entries) {
  project.timeline.tags = (entries || []).map((e, k) => ({
    id: uid('tag'),
    beat: Math.max(0, r2(Number(e.beat) || 0)),
    name: cleanTagName(e.name) || `段落 ${k + 1}`,
    ...(Number.isInteger(e.color) && e.color >= 0 && e.color < SEG_COLOR_COUNT ? { color: e.color } : {}),
  }));
}
// 段级操作（右键/边界拖拽共用；均为对 tags 的原子改写，历史条数由调用方 mutateLabeled 保证恰一）：
// 于此拆分：在 beat 处插入段起点（拍位 ≥0.01 起；新段名=原段名+「·2」截断，色随原段）
function splitSectionAt(project, tagId, beat) {
  const src = tagById(project, tagId);
  const b = Math.max(0.01, r2(Number(beat) || 0));
  if (!src) return null;
  const t = { id: uid('tag'), beat: b, name: cleanTagName(`${src.name}·2`) || nextTagName(project), ...(src.color != null ? { color: src.color } : {}) };
  project.timeline.tags.push(t);
  return t;
}
// 删除段 = 移除其段起点 tag（该区间并入前段；首段删除后区间呈未划分灰底）
function removeSection(project, tagId) { removeTag(project, tagId); }
// 合并相邻 = 移除「下一段」的段起点（本段延到再下一段/曲终）；末段则并入前段（移除自身起点）
function mergeSectionWithNext(project, tagId) {
  const tags = [...(project.timeline.tags || [])].sort((a, b) => a.beat - b.beat);
  const idx = tags.findIndex(t => t.id === tagId);
  if (idx < 0) return;
  const victim = idx + 1 < tags.length ? tags[idx + 1] : tags[idx - 1]; // 末段→并前段
  if (victim) removeTag(project, victim.id);
}
// 换色（0..3 越界钳制；非法输入不动）
function setSectionColor(project, tagId, color) {
  const t = tagById(project, tagId);
  if (!t || !Number.isInteger(color) || color < 0 || color >= SEG_COLOR_COUNT) return;
  t.color = color;
}

// ---------- 位置插值 ----------
function lerpAngle(a, b, t) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return (a + d * t + 360) % 360;
}
function lerpFormations(A, B, t) {
  const out = {};
  const ids = new Set([...Object.keys(A), ...Object.keys(B)]);
  for (const id of ids) {
    const a = A[id] || B[id], b = B[id] || A[id];
    out[id] = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      facing: lerpAngle(a.facing || 0, b.facing || 0, t),
    };
  }
  return out;
}
function posAt(project, beat) {
  const formations = project.formations;
  if (!formations.length) return { positions: {}, seg: null, phase: 'hold', t: 0 };
  const { segments } = computeSegments(project);
  if (beat <= 0) return { positions: formations[0].positions, seg: segments[0], phase: 'hold', t: 0 };
  const last = segments[segments.length - 1];
  if (beat >= last.travelEnd) return { positions: formations[formations.length - 1].positions, seg: last, phase: 'hold', t: 1 };
  const seg = segmentAt(segments, beat);
  if (beat < seg.holdEnd) return { positions: formations[seg.i].positions, seg, phase: 'hold', t: 0 };
  const t = easeInOut((beat - seg.holdEnd) / Math.max(1e-6, seg.travelEnd - seg.holdEnd));
  return { positions: lerpFormations(formations[seg.i].positions, formations[seg.i + 1].positions, t), seg, phase: 'travel', t };
}
function currentFormationIndexAt(project, beat) {
  const { segments } = computeSegments(project);
  const seg = segmentAt(segments, beat);
  return seg ? seg.i : 0;
}

// ---------- 小节/8拍显示 ----------
function beatLabel(project, beat) {
  const bpb = project.audio.beatsPerBar || 4;
  const b = Math.max(0, beat);
  const bar = Math.floor(b / bpb) + 1, bt = Math.floor(b % bpb) + 1;
  return `${bar}.${bt}`;
}
function countLabel(beat) { return `${Math.floor(Math.max(0, beat) / 8) + 1}`; } // 第 n 个 8 拍

// ---------- 时间轴对齐 ----------
// 把第 index 个队形块的起点对齐到目标拍（调整前一个过渡的时长，必要时压缩上一块的保持时长）
function alignBlockStart(project, index, targetBeat, segments = computeSegments(project).segments) {
  if (index <= 0 || !segments[index] || !segments[index - 1]) return false;
  const prevSeg = segments[index - 1];
  const prev = project.timeline.blocks[index - 1];
  let need = targetBeat - prevSeg.holdEnd;
  if (need < 0.5) {
    const reduce = Math.min(0.5 - need, Math.max(0, prev.holdBeats - 0.5));
    prev.holdBeats = Math.max(0.5, prev.holdBeats - reduce);
    need += reduce;
  }
  prev.travelBeats = Math.max(0.5, need);
  return true;
}

// ---------- 媒体资产与音频 clip（v3 音乐剪辑 · 规格 docs/music-clip-ui-spec.md） ----------
// project.media = { assets: [{id,name,durationSec,size}], activeAssetId }
// project.timeline.tracks = [{id,name,gain,muted}]（多轨模型 · 见下方「多轨」节）
// project.timeline.audioClips = [{id,assetId,trackId?,timelineStartSec,srcStartSec,lengthSec,fadeInSec,fadeOutSec,gain,name,muted?,color?,fadeInAuto?,fadeOutAuto?,autoPair?,autoPairIn?,autoPairOut?}]
// clip=可自由摆放的独立对象：间隙=静音，重叠=自动等功率交叉淡化（fades 记录在 clip 上）。
const MIN_CLIP_DUR = 0.005;
const r6c = v => Math.round(v * 1e6) / 1e6;
// 媒体资产清洗：非合法项丢弃；id 补 uid、去重；name 非空 ≤120 字；时长/大小钳制；dataBase64 剥离（导入入口已还原 Blob）
function sanitizeMedia(raw) {
  const m = (raw && typeof raw === 'object') ? raw : {};
  const seen = new Set();
  const assets = [];
  for (const a of Array.isArray(m.assets) ? m.assets : []) {
    if (!a || typeof a !== 'object') continue;
    delete a.dataBase64; delete a.dataFormat; // 内嵌数据不进项目记录
    const id = (typeof a.id === 'string' && a.id) ? a.id : uid('ast');
    if (seen.has(id)) continue;
    seen.add(id);
    const dur = Number(a.durationSec);
    const size = Number(a.size);
    assets.push({
      id,
      name: String(a.name ?? '').slice(0, 120) || '音频',
      durationSec: Number.isFinite(dur) ? Math.max(0, Math.min(36000, dur)) : 0,
      size: Number.isFinite(size) && size > 0 ? Math.round(size) : 0,
    });
  }
  const activeId = (typeof m.activeAssetId === 'string' && seen.has(m.activeAssetId)) ? m.activeAssetId
    : (assets[0]?.id ?? null);
  return { assets, activeAssetId: assets.length ? activeId : null };
}
// 音频 clip 清洗：引用有效资产、数值域钳制（时间 ≥0、length>MIN、srcStart+length ≤ 资产时长、
// 淡化 ≥0 且总量 ≤ length 按比例收缩、gain 0..4）、id 补 uid/去重；数组顺序即 z 序（保持不排序）。
// autoPair 双缘升级（R47）：autoPairOut/autoPairIn 各记一条交叉淡化缘（out=对后端 clip 淡出、
// in=对前端 clip 淡入）；旧单字段 autoPair 迁移为双缘等价——只有单侧 auto 缘时按缘归属精确迁移，
// 双侧 auto 缘并存（链式中段，旧单字段只保留了最后写入的 out 侧）按「末次写入=out 侧」启发式迁移，
// in 侧陈旧记录留待 prune 的幽灵清理收口。autoPair 单字段保留为兼容镜像（旧版应用读新文件用）。
// opts.trackIds（Set）+ opts.defaultTrackId：多轨清洗——clip.trackId 非悬挂则保留，悬挂/缺失
// 回落 defaultTrackId；opts 缺省时保留既有 trackId 字符串（纯清洗入口不强行补轨语义）。
function sanitizeAudioClips(raw, assets, opts = {}) {
  const durOf = new Map((assets || []).map(a => [a.id, a.durationSec]));
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c !== 'object') continue;
    const assetId = typeof c.assetId === 'string' ? c.assetId : '';
    if (!durOf.has(assetId)) continue;
    const id = (typeof c.id === 'string' && c.id) ? c.id : uid('clip');
    if (seen.has(id)) continue;
    seen.add(id);
    const assetDur = durOf.get(assetId) || 0;
    let start = Number(c.timelineStartSec), src = Number(c.srcStartSec), len = Number(c.lengthSec);
    if (!Number.isFinite(start) || !Number.isFinite(src) || !Number.isFinite(len)) continue;
    start = Math.max(0, start); src = Math.max(0, src);
    len = Math.min(Math.max(len, 0), Math.max(0, assetDur - src));
    if (len < MIN_CLIP_DUR) continue;
    let fi = Math.max(0, Number(c.fadeInSec) || 0);
    let fo = Math.max(0, Number(c.fadeOutSec) || 0);
    const total = fi + fo;
    if (total > len && total > 0) { const k = len / total; fi *= k; fo *= k; }
    const gain = Number(c.gain);
    // autoPair 旧单字段 → 双缘迁移（见函数头注释）
    const legacyPair = (typeof c.autoPair === 'string' && c.autoPair) ? c.autoPair : null;
    let pairOut = (typeof c.autoPairOut === 'string' && c.autoPairOut) ? c.autoPairOut : null;
    let pairIn = (typeof c.autoPairIn === 'string' && c.autoPairIn) ? c.autoPairIn : null;
    if (!pairOut && legacyPair && c.fadeOutAuto) pairOut = legacyPair;            // 单 out 缘 / 双缘末写=out
    if (!pairIn && legacyPair && c.fadeInAuto && !c.fadeOutAuto) pairIn = legacyPair; // 单 in 缘
    // trackId：多轨清洗（validate 入口传 trackIds）；悬挂/缺失回落默认轨
    let trackId = (typeof c.trackId === 'string' && c.trackId) ? c.trackId : null;
    if (opts.trackIds) {
      if (!trackId || !opts.trackIds.has(trackId)) {
        trackId = (opts.defaultTrackId && opts.trackIds.has(opts.defaultTrackId))
          ? opts.defaultTrackId
          : [...opts.trackIds][0] || null;
      }
    }
    out.push({
      id, assetId,
      timelineStartSec: r6c(start),
      srcStartSec: r6c(src),
      lengthSec: r6c(len),
      fadeInSec: r6c(Math.min(fi, len)),
      fadeOutSec: r6c(Math.min(fo, len)),
      gain: Number.isFinite(gain) ? Math.max(0, Math.min(4, gain)) : 1,
      name: String(c.name ?? '').slice(0, 80),
      ...(c.muted ? { muted: true } : {}),
      ...(typeof c.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.color) ? { color: c.color } : {}),
      ...(c.fadeInAuto ? { fadeInAuto: true } : {}),
      ...(c.fadeOutAuto ? { fadeOutAuto: true } : {}),
      ...(legacyPair ? { autoPair: legacyPair } : {}),
      ...(pairOut ? { autoPairOut: pairOut } : {}),
      ...(pairIn ? { autoPairIn: pairIn } : {}),
      ...(trackId ? { trackId } : {}),
    });
  }
  return out;
}
// v1 单音频 → 1 asset + 全长 clip（零体验变化：全长 clip 与旧「整曲播放」逐拍等价）。
// 已有 assets（含 assets 非空但 audioClips 为空的形态）不迁移；无音乐不迁移。返回是否发生迁移。
function migrateLegacyAudio(p) {
  if (!p || !p.media || !p.timeline) return false;
  if (p.media.assets.length) return false;
  const name = String(p.audio?.name || '').trim();
  if (!name) return false;
  const dur = Number(p.audio?.durationSec) || 0;
  const asset = { id: uid('ast'), name, durationSec: Math.max(0, dur), size: 0 };
  p.media = { assets: [asset], activeAssetId: asset.id };
  p.timeline.audioClips = dur > MIN_CLIP_DUR ? [{
    id: uid('clip'), assetId: asset.id, trackId: DEFAULT_TRACK_ID,
    timelineStartSec: 0, srcStartSec: 0, lengthSec: r6c(dur),
    fadeInSec: 0, fadeOutSec: 0, gain: 1, name,
  }] : [];
  return true;
}
function activeAssetOf(project) {
  const m = project?.media;
  if (!m || !m.assets?.length) return null;
  return m.assets.find(a => a.id === m.activeAssetId) || m.assets[0] || null;
}
function clipsOf(project) { return project?.timeline?.audioClips || []; }
// clip 查找/终止点辅助（UI 层共用）
function clipById(project, id) { return clipsOf(project).find(c => c.id === id) || null; }

// ---------- 多轨（多轨模型 · 本期 2 轨起步） ----------
// project.timeline.tracks = [{id, name, gain, muted}]。轨是 clip 的容器与混音单元：
//   gain 0..2 线性（与 ClipTransport.setTrackGain 同域，UI 滑杆 0..1.5）、muted 整轨静音。
// 上限 4 轨（TRACK_MAX）由 UI 层把守（addTrack 不设限）；模型层只保证数据合法与引用不悬挂。
// 单轨项目零体验变化：默认恒有 trk1「配乐」，旧项目载入时缺省补建、clip.trackId 缺省迁移到 trk1。
const TRACK_MAX = 4;
const TRACK_NAME_MAX = 24;
const DEFAULT_TRACK_ID = 'trk1';
const defaultTrack = () => ({ id: DEFAULT_TRACK_ID, name: '配乐', gain: 1, muted: false });
// 轨清洗：非合法项丢弃；id 缺失补 uid/去重（重复保首个弃后续）；name 非空 ≤24 字；
// gain 0..2 钳制；muted 布尔归一。返回新数组，不改输入。
function sanitizeTracks(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    if (!t || typeof t !== 'object') continue;
    const id = (typeof t.id === 'string' && t.id) ? t.id : uid('trk');
    if (seen.has(id)) continue;
    seen.add(id);
    const gain = Number(t.gain);
    out.push({
      id,
      name: String(t.name ?? '').trim().slice(0, TRACK_NAME_MAX) || `轨 ${out.length + 1}`,
      gain: Number.isFinite(gain) ? Math.max(0, Math.min(2, gain)) : 1,
      muted: !!t.muted,
    });
  }
  return out;
}
function trackById(project, id) { return (project?.timeline?.tracks || []).find(t => t.id === id) || null; }
// clip 归属轨（引擎/UI 共用）：trackId 悬挂/缺失回落默认轨→首轨（与 validate 清洗同口径）
function trackOfClip(project, clip) {
  const tracks = project?.timeline?.tracks || [];
  if (!tracks.length) return null;
  const id = clip?.trackId;
  return (id && tracks.find(t => t.id === id)) || tracks.find(t => t.id === DEFAULT_TRACK_ID) || tracks[0];
}
// 新增轨：命名缺省「轨 N」（N 取未被占用最小号）。上限 TRACK_MAX 由 UI 把守，模型层不设限。
function addTrack(project, { name = '' } = {}) {
  project.timeline.tracks = project.timeline.tracks || [];
  const used = new Set(project.timeline.tracks.map(t => t.name));
  let n = project.timeline.tracks.length + 1;
  while (used.has(`轨 ${n}`)) n++;
  const t = {
    id: uid('trk'),
    name: String(name ?? '').trim().slice(0, TRACK_NAME_MAX) || `轨 ${n}`,
    gain: 1, muted: false,
  };
  project.timeline.tracks.push(t);
  return t;
}
// 删除轨：仅允许空轨（无任何 clip 引用；trackId 缺失的 clip 视为归属 trk1）。
// 非空/不存在/删除后无轨可回退（tracks 至少保留一条供 validate 缺省重建，此处不硬拦最后一轨，
// 但约定 UI 不提供删最后一轨入口）→ 返回 { ok:false, error }；删除 clip 策略=拒绝（简单安全）。
function removeTrack(project, trackId) {
  const tracks = project.timeline.tracks || [];
  const i = tracks.findIndex(t => t.id === trackId);
  if (i < 0) return { ok: false, error: '轨不存在' };
  const referenced = clipsOf(project).some(c => (c.trackId || DEFAULT_TRACK_ID) === trackId);
  if (referenced) return { ok: false, error: '轨上仍有音频块，不能删除（请先移动或删除音频块）' };
  const [rm] = tracks.splice(i, 1);
  return { ok: true, removed: rm };
}
function renameTrack(project, trackId, name) {
  const t = trackById(project, trackId);
  const n = String(name ?? '').trim().slice(0, TRACK_NAME_MAX);
  if (!t || !n) return null;
  t.name = n;
  return t;
}
// 轨增益/静音：模型态写入（0..2 线性）；引擎实时生效由 UI 同步给 ClipTransport
// （syncTracks / setTrackGainById / setTrackMutedById，setTargetAtTime 平滑）。
function setTrackGain(project, trackId, gain) {
  const t = trackById(project, trackId);
  if (!t) return null;
  const g = Number(gain);
  t.gain = Number.isFinite(g) ? Math.max(0, Math.min(2, g)) : t.gain;
  return t;
}
function setTrackMuted(project, trackId, muted) {
  const t = trackById(project, trackId);
  if (!t) return null;
  t.muted = !!muted;
  return t;
}
// clip 换轨：clip 与目标轨都必须存在；成功返回 { ok:true, clip }，否则 { ok:false, error }。
function moveClipToTrack(project, clipId, trackId) {
  const clip = clipById(project, clipId);
  if (!clip) return { ok: false, error: '音频块不存在' };
  const t = trackById(project, trackId);
  if (!t) return { ok: false, error: '目标轨不存在' };
  clip.trackId = t.id;
  return { ok: true, clip };
}
// 「不含音乐」v1 导出剥离助手（汇合轮接线点）：多轨数据不随 v1 轻量文件出户——
// 返回深拷贝（不改原项目）：去 timeline.tracks、去各 clip.trackId（autoPair 双缘保留，
// 与轨无关）。v2（含乐）导出随行无需处理（cloneBasic 全量克隆）。
function stripTracksForV1(project) {
  const p = JSON.parse(JSON.stringify(project));
  if (p.timeline) delete p.timeline.tracks;
  for (const c of p.timeline?.audioClips || []) delete c.trackId;
  return p;
}

// ---------- 校验 / 迁移 ----------
function num(v, def, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
function validateProject(json) {
  const errors = [];
  if (!json || typeof json !== 'object') return { ok: false, errors: ['不是合法的项目对象'] };
  if (json.version !== 1 && json.version !== 2) errors.push(`未知版本 ${json.version}`);
  delete (json.audio || {}).dataBase64; // 内嵌音乐在导入入口处还原为 Blob，不进项目记录
  delete (json.audio || {}).dataFormat;
  const p = json;
  p.meta = (p.meta && typeof p.meta === 'object') ? p.meta : { title: '导入项目' };
  p.meta.title = String(p.meta.title ?? '未命名').slice(0, 120);
  p.stage = { widthM: 12, depthM: 16, audience: 'bottom', gridM: 0.5, snap: true, backstageM: 2, bgImage: null, ...p.stage };
  p.stage.widthM = num(p.stage.widthM, 12, 4, 60);
  p.stage.depthM = num(p.stage.depthM, 16, 4, 60);
  p.stage.gridM = num(p.stage.gridM, 0.5, 0.1, 2);
  p.stage.backstageM = num(p.stage.backstageM, 2, 0, 10);
  p.stage.snap = !!p.stage.snap;
  if (!['bottom', 'top', 'left', 'right'].includes(p.stage.audience)) p.stage.audience = 'bottom';
  p.audio = { name: '', durationSec: 0, bpm: DEFAULT_BPM, beatsPerBar: 4, firstBeatSec: 0, ...p.audio };
  p.audio.bpm = num(p.audio.bpm, DEFAULT_BPM, 30, 300);
  p.audio.beatsPerBar = num(p.audio.beatsPerBar, 4, 2, 12);
  p.audio.firstBeatSec = num(p.audio.firstBeatSec, 0, 0, 3600);
  p.audio.durationSec = num(p.audio.durationSec, 0, 0, 36000);
  p.audio.name = String(p.audio.name ?? '').slice(0, 200);
  // 项目级显示设置：旧项目无 settings → 补默认值（labelMode='no' 维持现状），零迁移成本
  p.settings = { ...(p.settings && typeof p.settings === 'object' ? p.settings : {}) };
  if (!LABEL_MODES.includes(p.settings.labelMode)) p.settings.labelMode = 'no';
  p.dancers = Array.isArray(p.dancers) ? p.dancers : [];
  delete p.pairs; // v3：舞对概念退役——旧项目载入时忽略并清除 pairs 字段，不破坏 formations/positions/merges
  p.groups = Array.isArray(p.groups) ? p.groups : [];
  p.formations = Array.isArray(p.formations) ? p.formations : [];
  p.timeline = { blocks: [], countInBeats: 8, metronome: false, playSpeed: 1, tags: [], audioClips: [], ...p.timeline };
  p.timeline.countInBeats = num(p.timeline.countInBeats, 8, 0, 32);
  p.timeline.blocks = Array.isArray(p.timeline.blocks) ? p.timeline.blocks : [];
  p.timeline.tags = sanitizeTags(p.timeline.tags); // 时间轴标记清洗（旧项目无 tags → []，零迁移成本）
  // 媒体资产与音频 clip（v3 音乐剪辑）：清洗 + v1 单音频迁移（1 asset + 全长 clip，零体验变化）
  p.media = sanitizeMedia(p.media);
  // 多轨（tracks）：清洗 + 缺省补建 trk1「配乐」（旧项目零体验变化）；clip.trackId 悬挂回落 trk1
  p.timeline.tracks = sanitizeTracks(p.timeline.tracks);
  if (!p.timeline.tracks.length) p.timeline.tracks = [defaultTrack()];
  const trackOpts = {
    trackIds: new Set(p.timeline.tracks.map(t => t.id)),
    defaultTrackId: p.timeline.tracks.some(t => t.id === DEFAULT_TRACK_ID) ? DEFAULT_TRACK_ID : p.timeline.tracks[0].id,
  };
  p.timeline.audioClips = sanitizeAudioClips(p.timeline.audioClips, p.media.assets, trackOpts);
  migrateLegacyAudio(p);
  // 迁移/清洗后再过一遍 clip 清洗（迁移产物引用新 asset，域已合法；此处幂等收口）
  p.timeline.audioClips = sanitizeAudioClips(p.timeline.audioClips, p.media.assets, trackOpts);
  for (const f of p.formations) f.positions = f.positions || {};
  const ids = new Set();
  for (const d of p.dancers) { if (!d.id || ids.has(d.id)) d.id = uid('d'); ids.add(d.id); d.role = ['M', 'F', 'X'].includes(d.role) ? d.role : 'X'; }
  const dids = new Set(p.dancers.map(d => d.id));
  p.formations = p.formations.filter(f => f && f.id);
  // groups 清洗：缺省 []、悬挂成员清理（引用已删除舞者的 memberIds）、组内去重、组 id 去重
  const seenG = new Set();
  p.groups = p.groups
    .filter(g => g && typeof g === 'object' && g.id && !seenG.has(g.id) && (seenG.add(g.id), true))
    .map(g => ({
      id: String(g.id),
      name: String(g.name ?? '').trim().slice(0, 40) || '编组',
      memberIds: [...new Set((Array.isArray(g.memberIds) ? g.memberIds : []).filter(id => dids.has(id)))],
    }));
  if (!p.formations.length) p.formations.push({ id: uid('f'), name: '开场队形', color: '#64748b', note: '', positions: {} });
  for (const f of p.formations) {
    const np = {};
    for (const [k, v] of Object.entries(f.positions)) if (dids.has(k) && v && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y)) np[k] = { x: v.x, y: v.y, facing: ((v.facing || 0) % 360 + 360) % 360 };
    f.positions = np;
    // 合并单元清洗：引用有效、去重、样式合法；旧样式 diamond/twin 载入时迁移归一为 capsule
    if (Array.isArray(f.merges)) {
      const seen = new Set();
      f.merges = f.merges
        .map(m => (m && (m.style === 'diamond' || m.style === 'twin') ? { ...m, style: 'capsule' } : m))
        .filter(m => m && dids.has(m.a) && dids.has(m.b) && m.a !== m.b && UNIT_STYLES.includes(m.style) && !seen.has(mergeKey(m.a, m.b)) && (seen.add(mergeKey(m.a, m.b)), true)).slice(0, 32);
      if (!f.merges.length) delete f.merges;
    } else delete f.merges;
  }
  syncTimeline(p);
  return { ok: errors.length === 0, errors, project: p };
}

/* ===== module: shapes.js ===== */
/* from model: faceAudience, uid → 同作用域（拼接） */
// 队形生成器与整体位置变换 —— 纯逻辑，无 DOM 依赖
/* import from model（拼接后为局部名） */
const SHAPE_KINDS = ['rows', 'line', 'columns', 'circle', 'arc', 'v', 'diagonal', 'diamond'];

const margin = stage => Math.min(1.5, stage.widthM / 8);

// 生成 count 个槽位（米坐标）
function genSlots(kind, count, stage, opts = {}) {
  const m = margin(stage), W = stage.widthM, H = stage.depthM;
  const cx = W / 2, cy = H / 2;
  const face = faceAudience(stage);
  const pts = [];
  const push = (x, y, f = face) => pts.push({ x, y, facing: ((f % 360) + 360) % 360 });

  switch (kind) {
    case 'line': {
      const y = cy, sp = count > 1 ? (W - 2 * m) / (count - 1) : 0;
      for (let i = 0; i < count; i++) push(cx - (count - 1) * sp / 2 + i * sp, y);
      break;
    }
    case 'rows': {
      const rows = clampInt(opts.rows || (count <= 4 ? 1 : 2), 1, 4);
      const per = Math.ceil(count / rows), gap = 1.6;
      const sp = per > 1 ? (W - 2 * m) / (per - 1) : 0;
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / per), c = i % per;
        const rowCount = Math.min(per, count - r * per);
        const off = (per - rowCount) * sp / 2;
        push(m + off + c * sp, cy + (r - (rows - 1) / 2) * gap);
      }
      break;
    }
    case 'columns': {
      const cols = clampInt(opts.cols || Math.max(2, Math.round(count / 3)), 1, count);
      const per = Math.ceil(count / cols), gapX = 1.4, gapY = per > 1 ? (H - 2 * m) / (per - 1) : 0;
      for (let i = 0; i < count; i++) {
        const c = Math.floor(i / per), r = i % per;
        push(cx + (c - (cols - 1) / 2) * gapX, m + r * gapY);
      }
      break;
    }
    case 'circle': {
      const r = Math.min(W, H) / 2 - m;
      for (let i = 0; i < count; i++) {
        const th = 360 * i / count; // 0=顶部，顺时针
        const rad = th * Math.PI / 180;
        push(cx + r * Math.sin(rad), cy - r * Math.cos(rad), th + 180); // 面向圆心
      }
      break;
    }
    case 'arc': {
      // 弧形：圆心在观众侧，队伍背对观众心、面向观众，呈环抱状
      const r = Math.min(W / 2, H * 0.7) - m;
      const baseY = cy + r * 0.45;
      const spread = 130; // 总张角
      for (let i = 0; i < count; i++) {
        const a = (-spread / 2 + spread * (count > 1 ? i / (count - 1) : 0.5)) * Math.PI / 180;
        push(cx + r * Math.sin(a), baseY - r * Math.cos(a));
      }
      break;
    }
    case 'v': {
      // V 形：顶点在上（远台），开口朝观众
      const s = 1.1, ang = 27 * Math.PI / 180;
      const half = Math.floor(count / 2);
      let k = 0;
      for (let side = -1; side <= 1; side += 2) {
        for (let j = 0; j < (side < 0 ? half : count - half); j++) {
          const d = j + 1;
          push(cx + side * d * s * Math.sin(ang), cy - H * 0.18 + d * s * Math.cos(ang));
          k++;
        }
      }
      break;
    }
    case 'diagonal': {
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0.5;
        push(m + t * (W - 2 * m), m + t * (H - 2 * m));
      }
      break;
    }
    case 'diamond': {
      // 菱形周界均布：顶点 上/右/下/左
      const vs = [{ x: cx, y: m }, { x: W - m, y: cy }, { x: cx, y: H - m }, { x: m, y: cy }];
      const lens = [0, 1, 2, 3].map(i => dist(vs[i], vs[(i + 1) % 4]));
      const per = lens.reduce((a, b) => a + b, 0);
      for (let i = 0; i < count; i++) {
        let d = per * i / count, seg = 0;
        while (seg < 3 && d > lens[seg]) { d -= lens[seg]; seg++; }
        const a = vs[seg], b = vs[(seg + 1) % 4], t = d / lens[seg];
        push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
      break;
    }
    default:
      for (let i = 0; i < count; i++) push(cx, cy);
  }
  if (opts.face === 'center') for (const p of pts) p.facing = ((angleTo(p, { x: cx, y: cy }) % 360) + 360) % 360;
  return pts;
}

function clampInt(v, a, b) { return Math.max(a, Math.min(b, Math.round(v))); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function angleTo(a, b) { return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI + 360) % 360; } // 0=上 顺时针 0..360

// 把槽位映射进队形：优先保持现有就近站位（slot→最近舞者，贪心）
function applySlots(formation, orderedIds, slots, { current = {} } = {}) {
  const remaining = new Set(orderedIds);
  const positions = {};
  for (const s of slots) {
    let best = null, bd = Infinity;
    for (const id of remaining) {
      const p = current[id];
      const d = p ? dist(p, s) : 1e9; // 无位置的舞者最后安排
      if (d < bd) { bd = d; best = id; }
    }
    if (!best) break;
    remaining.delete(best);
    positions[best] = { x: round2(s.x), y: round2(s.y), facing: Math.round(s.facing ?? 0) };
  }
  formation.positions = positions;
}
function round2(v) { return Math.round(v * 100) / 100; }

// ---------- 整体变换 ----------
function mirrorH(formation, stage) { // 左右镜像
  for (const p of Object.values(formation.positions)) { p.x = round2(stage.widthM - p.x); p.facing = (360 - p.facing) % 360; }
}
function mirrorV(formation, stage) { // 前后镜像
  for (const p of Object.values(formation.positions)) { p.y = round2(stage.depthM - p.y); p.facing = (180 - p.facing + 360) % 360; }
}
function rotateSelected(positions, ids, deg, center) {
  const rad = deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  for (const id of ids) {
    const p = positions[id]; if (!p) continue;
    const dx = p.x - center.x, dy = p.y - center.y;
    p.x = round2(center.x + dx * cos - dy * sin);
    p.y = round2(center.y + dx * sin + dy * cos);
    p.facing = ((p.facing + deg) % 360 + 360) % 360;
  }
}
function distributeAxis(positions, ids, axis) {
  const list = ids.map(id => ({ id, p: positions[id] })).filter(e => e.p);
  list.sort((a, b) => a.p[axis] - b.p[axis]);
  if (list.length < 3) return;
  const lo = list[0].p[axis], hi = list[list.length - 1].p[axis];
  list.forEach((e, i) => { e.p[axis] = round2(lo + (hi - lo) * i / (list.length - 1)); });
}
function swapTwo(formation, idA, idB) {
  const a = formation.positions[idA], b = formation.positions[idB];
  if (!a || !b) return;
  formation.positions[idA] = b; formation.positions[idB] = a;
}
function faceAll(positions, ids, target, { stage }) {
  const face = faceAudience(stage);
  const cx = stage.widthM / 2, cy = stage.depthM / 2;
  for (const id of ids) {
    const p = positions[id]; if (!p) continue;
    if (target === 'audience') p.facing = face;
    else if (target === 'center') p.facing = Math.round(((angleTo(p, { x: cx, y: cy }) % 360) + 360) % 360);
  }
}

/* ===== module: choreo-extra.js ===== */
/* from model: DEFAULT_BPM, ROLE_COLOR, UNIT_STYLES → 同作用域（拼接） */
// 编舞辅助纯函数（wuzhen-core 扩展）—— 无 DOM 依赖，Node 可直接 import；
// 由 scripts/build-core.mjs 与 model/shapes 一起打包为 dist/core/wuzhen-core.mjs。
// 注意：本文件与 model.js/shapes.js 拼接进同一模块作用域，顶层标识符不得与
// 它们的导出名或私有名冲突（禁用 dist/round2/margin/clampInt/num 等）。
/* import from model（拼接后为局部名） */
// 合并单元「呈示为单元符号」的间距阈值（与 app js/stage.js MERGE_DIST 同值同语义）
const UNIT_MERGE_DIST = 0.8;

// 数字格式化：两位小数内稳定输出（SVG 坐标/长度）
function fx(v) { return String(Math.round(v * 100) / 100); }
// XML 文本转义（标签内容/属性通用最小集）
function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---------- toSVG：队形 → 零依赖 SVG 字符串（候选可视化） ----------
// 与 app 呈示同语义（js/stage.js drawOne/drawUnitSymbol/drawBond）：
//   - 舞台边界矩形；坐标米→px（scale px/米），padding 米留白；
//   - 合并单元两人 ≤0.8m：capsule=圆角矩形左右双半色+中缝+双 short 标签 /
//     single=单圆（取名册靠前成员颜色与标签）+虚线外环；>0.8m：两独立圆+虚线绑定；
//   - 独立舞者=角色色圆+白色朝向指针（0=上、顺时针）+short 标签。
// 参数：formation={positions:{id:{x,y,facing}}, merges?:[{a,b,style}]}
//       opts.stage={widthM,depthM}；opts.unitStyle='capsule'|'single'（覆盖各单元自报样式）
//       opts.dancers=[{id,short,role,color?}]（标签与配色来源，缺失回退 id 尾 4 位+灰）
//       opts.scale=px/米（默认24）；opts.padding=米（默认1）
function toSVG(formation, { stage, unitStyle, dancers = [], scale = 24, padding = 1 } = {}) {
  const st = { ...(stage || {}) };
  const W = Number(st.widthM) > 0 ? Number(st.widthM) : 12;
  const H = Number(st.depthM) > 0 ? Number(st.depthM) : 16;
  const s = Number(scale) > 0 ? Number(scale) : 24;
  const pad = Number(padding) >= 0 ? Number(padding) : 1;
  const pos = (formation && formation.positions) || {};
  const merges = formation && Array.isArray(formation.merges) ? formation.merges : [];
  const vw = Math.ceil((W + 2 * pad) * s), vh = Math.ceil((H + 2 * pad) * s);
  const X = x => fx((x + pad) * s), Y = y => fx((y + pad) * s);
  const r = 0.45 * s;
  const meta = new Map();
  for (const d of (Array.isArray(dancers) ? dancers : [])) meta.set(d.id, d);
  const infoOf = id => {
    const d = meta.get(id);
    return {
      short: String(d?.short ?? String(id).slice(-4)),
      color: d?.color || ROLE_COLOR[d?.role] || '#64748b',
    };
  };
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}" font-family="sans-serif">`);
  // 舞台边界矩形
  parts.push(`  <rect x="${X(0)}" y="${Y(0)}" width="${fx(W * s)}" height="${fx(H * s)}" fill="#ffffff" stroke="#334155" stroke-width="2"/>`);
  // 单人圆（独立舞者与「拉伸的合并」共用）：角色色圆 + 朝向指针 + short 标签
  const one = (id, p) => {
    const inf = infoOf(id);
    const facing = ((Number(p.facing) || 0) % 360 + 360) % 360;
    return [
      `  <circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${fx(r)}" fill="${inf.color}" stroke="rgba(15,23,42,.55)" stroke-width="1.5"/>`,
      `  <g transform="translate(${X(p.x)},${Y(p.y)}) rotate(${fx(facing)})"><polygon points="0,${fx(-r * 0.55)} ${fx(r * 0.42)},${fx(r * 0.38)} ${fx(-r * 0.42)},${fx(r * 0.38)}" fill="rgba(255,255,255,.92)"/></g>`,
      `  <text x="${X(p.x)}" y="${Y(p.y)}" fill="#fff" font-weight="700" font-size="${fx(r * 0.95)}" text-anchor="middle" dominant-baseline="central">${esc(inf.short)}</text>`,
    ].join('\n');
  };
  // 合并单元（帧级 merges）：接近=单元符号，分离=两圆+虚线绑定
  const mergedIds = new Set();
  merges.forEach((m, i) => {
    const a = pos[m.a], b = pos[m.b];
    if (!a || !b) return;
    mergedIds.add(m.a); mergedIds.add(m.b);
    const cx = (Number(a.x) + Number(b.x)) / 2, cy = (Number(a.y) + Number(b.y)) / 2;
    if (Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) <= UNIT_MERGE_DIST) {
      const style = UNIT_STYLES.includes(unitStyle) ? unitStyle : m.style;
      if (style === 'single') {
        // 单圆 + 虚线外环（颜色/标签取名册靠前的成员）
        const first = [m.a, m.b].filter(id => meta.has(id));
        const lead = first.length ? (meta.get(first[0])) : null;
        const inf = lead ? { short: String(lead.short ?? String(lead.id).slice(-4)), color: lead.color || ROLE_COLOR[lead.role] || '#64748b' } : infoOf(m.a);
        parts.push(`  <!-- single 单元 ${esc(inf.short)} -->`);
        parts.push(`  <circle cx="${X(cx)}" cy="${Y(cy)}" r="${fx(r)}" fill="${inf.color}" stroke="rgba(15,23,42,.55)" stroke-width="1.5"/>`);
        parts.push(`  <text x="${X(cx)}" y="${Y(cy)}" fill="#fff" font-weight="700" font-size="${fx(r * 0.95)}" text-anchor="middle" dominant-baseline="central">${esc(inf.short)}</text>`);
        parts.push(`  <circle cx="${X(cx)}" cy="${Y(cy)}" r="${fx(r * 1.45)}" fill="none" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      } else { // capsule：圆角矩形左右双半色 + 中缝 + 双标签
        const A = infoOf(m.a), B = infoOf(m.b);
        const w = r * 3.4, h = r * 1.5, rad = h * 0.45;
        const x0 = (cx + pad) * s - w / 2, y0 = (cy + pad) * s - h / 2, cxp = (cx + pad) * s;
        parts.push(`  <!-- capsule 单元 ${esc(A.short)}×${esc(B.short)} -->`);
        parts.push(`  <clipPath id="wzc${i}"><rect x="${fx(x0)}" y="${fx(y0)}" width="${fx(w)}" height="${fx(h)}" rx="${fx(rad)}"/></clipPath>`);
        parts.push(`  <rect x="${fx(x0)}" y="${fx(y0)}" width="${fx(w)}" height="${fx(h)}" rx="${fx(rad)}" fill="${A.color}"/>`);
        parts.push(`  <rect x="${fx(x0 + w / 2)}" y="${fx(y0)}" width="${fx(w / 2)}" height="${fx(h)}" fill="${B.color}" clip-path="url(#wzc${i})"/>`);
        parts.push(`  <line x1="${fx(cxp)}" y1="${fx(y0)}" x2="${fx(cxp)}" y2="${fx(y0 + h)}" stroke="rgba(255,255,255,.85)" stroke-width="2"/>`);
        parts.push(`  <rect x="${fx(x0)}" y="${fx(y0)}" width="${fx(w)}" height="${fx(h)}" rx="${fx(rad)}" fill="none" stroke="#334155" stroke-width="2"/>`);
        parts.push(`  <text x="${fx(cxp - w * 0.25)}" y="${fx(y0 + h / 2)}" fill="#fff" font-weight="700" font-size="${fx(h * 0.62)}" text-anchor="middle" dominant-baseline="central">${esc(A.short)}</text>`);
        parts.push(`  <text x="${fx(cxp + w * 0.25)}" y="${fx(y0 + h / 2)}" fill="#fff" font-weight="700" font-size="${fx(h * 0.62)}" text-anchor="middle" dominant-baseline="central">${esc(B.short)}</text>`);
      }
    } else {
      // 拉伸的合并：两独立圆 + 虚线绑定
      parts.push(`  <line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="rgba(56,189,248,.45)" stroke-width="1.5" stroke-dasharray="3 4"/>`);
      parts.push(one(m.a, a));
      parts.push(one(m.b, b));
    }
  });
  // 未合并舞者
  for (const [id, p] of Object.entries(pos)) {
    if (mergedIds.has(id) || !p) continue;
    parts.push(one(id, p));
  }
  parts.push('</svg>');
  return parts.join('\n');
}

// ---------- diffFormations：两队形的逐人移动量摘要 ----------
// a/b 为 {positions:{id:{x,y,...}}}；比较逐舞者欧氏距离（朝向不参与）。
// moved 仅含位移 > eps（默认 0.01m=1cm，滤除抖动），按距离降序、同距按 id 升序（稳定可复现）。
// 返回 { moved:[{id,from:{x,y},to:{x,y},dist}], maxDist, totalDist, addedIds, removedIds }
function diffFormations(a, b, { eps = 0.01 } = {}) {
  const ap = (a && a.positions) || {}, bp = (b && b.positions) || {};
  const moved = [], addedIds = [], removedIds = [];
  for (const [id, p] of Object.entries(ap)) {
    const q = bp[id];
    if (!q) { removedIds.push(id); continue; }
    const d = Math.hypot(Number(q.x) - Number(p.x), Number(q.y) - Number(p.y));
    if (d > eps) moved.push({ id, from: { x: p.x, y: p.y }, to: { x: q.x, y: q.y }, dist: Math.round(d * 100) / 100 });
  }
  for (const id of Object.keys(bp)) if (!(id in ap)) addedIds.push(id);
  moved.sort((u, v) => (v.dist - u.dist) || String(u.id).localeCompare(String(v.id)));
  const maxDist = moved.length ? moved[0].dist : 0;
  const totalDist = Math.round(moved.reduce((s, m) => s + m.dist, 0) * 100) / 100;
  return { moved, maxDist, totalDist, addedIds, removedIds };
}

// ---------- feasibility：A→B 在 beats 拍内的速度可行性 ----------
// 每人需移动距离 ÷ 可走距离（cap 米/拍 × beats 拍）；cap=速度上限（米/拍）。
// 返回 { maxNeededDist, beats, ok, score, availableDist, secPerBeat, speedCapMPerBeat }
//   score=负荷比 maxNeededDist/availableDist（≤1 可行，越小越从容；无移动=0；不可行>1 或 ∞）。
// bpm 用于换算每拍秒数（secPerBeat）供人参考；非法值回退 DEFAULT_BPM。
function feasibility(from, to, beats, bpm, cap = 1.2) {
  const maxNeededDist = diffFormations(from, to).maxDist;
  const b = Math.max(0, Number(beats) || 0);
  const tempo = Number(bpm) > 0 ? Number(bpm) : DEFAULT_BPM;
  const c = Number(cap) > 0 ? Number(cap) : 1.2;
  const availableDist = Math.round(c * b * 100) / 100;
  const ok = maxNeededDist <= availableDist + 1e-9;
  const score = maxNeededDist <= 0 ? 0
    : (availableDist > 0 ? Math.round((maxNeededDist / availableDist) * 100) / 100 : Infinity);
  return {
    maxNeededDist, beats: b, ok, score,
    availableDist, secPerBeat: Math.round((60 / tempo) * 1000) / 1000, speedCapMPerBeat: c,
  };
}

export {
  /* model.js */
  DEFAULT_BPM,
  ROLE_COLOR,
  ROLE_NAME,
  uid,
  clone,
  clamp,
  easeInOut,
  addDancer,
  createProject,
  dancerById,
  orderedDancers,
  removeDancer,
  groupById,
  nextGroupName,
  createGroup,
  removeGroup,
  renameGroup,
  setGroupMembers,
  expandUnits,
  carryPositionsForward,
  UNIT_STYLES,
  mergeKey,
  findMerge,
  addMerge,
  removeMerge,
  setMergeStyle,
  collapseUnit,
  applyFormationLayout,
  renumberShorts,
  LABEL_MODES,
  labelModeOf,
  dancerOrdinal,
  dancerLabel,
  truncateLabel,
  faceAudience,
  ensureDancerInFormation,
  ensureFormationComplete,
  createFormationFrom,
  deleteFormation,
  moveFormation,
  formationIndexById,
  syncTimeline,
  spb,
  beatToSec,
  secToBeat,
  computeSegments,
  totalDurationSec,
  segmentAt,
  TAG_NAME_MAX,
  sanitizeTags,
  tagById,
  nextTagName,
  addTag,
  removeTag,
  renameTag,
  moveTag,
  SEG_COLOR_COUNT,
  sectionSegmentsOf,
  evenSectionBeats,
  barRuleSections,
  parseSectionTable,
  sectionTableToEntries,
  applySectionEntries,
  splitSectionAt,
  removeSection,
  mergeSectionWithNext,
  setSectionColor,
  lerpAngle,
  posAt,
  currentFormationIndexAt,
  beatLabel,
  countLabel,
  alignBlockStart,
  MIN_CLIP_DUR,
  sanitizeMedia,
  sanitizeAudioClips,
  migrateLegacyAudio,
  activeAssetOf,
  clipsOf,
  clipById,
  TRACK_MAX,
  TRACK_NAME_MAX,
  DEFAULT_TRACK_ID,
  defaultTrack,
  sanitizeTracks,
  trackById,
  trackOfClip,
  addTrack,
  removeTrack,
  renameTrack,
  setTrackGain,
  setTrackMuted,
  moveClipToTrack,
  stripTracksForV1,
  validateProject,
  /* shapes.js */
  SHAPE_KINDS,
  genSlots,
  angleTo,
  applySlots,
  mirrorH,
  mirrorV,
  rotateSelected,
  distributeAxis,
  swapTwo,
  faceAll,
  /* choreo-extra.js */
  toSVG,
  diffFormations,
  feasibility,
};
