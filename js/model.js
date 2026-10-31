// 数据模型与时间轴计算 —— 纯逻辑，无 DOM 依赖（可在 Node 中单测）
// 约定：坐标单位米，原点舞台左上，+x 右 +y 下；角度 0=上(−y)、顺时针、0..359

export const DEFAULT_BPM = 120;
export const ROLE_COLOR = { M: '#3b82f6', F: '#ec4899', X: '#10b981' };
export const ROLE_NAME = { M: '男', F: '女', X: '其他' };

let _uidCounter = 0;
export function uid(prefix = 'id') {
  _uidCounter = (_uidCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${_uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
export function clone(o) { return JSON.parse(JSON.stringify(o)); }
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// ---------- 创建 ----------
export function addDancer(project, name, role = 'X', short = '') {
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
export function createProject({ title = '未命名队列舞', pairs = 6, extraM = 0, extraF = 0, grouping = 'gender', presetMerged = false } = {}) {
  const project = {
    version: 1,
    meta: { title, team: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    // build-61-stageaspect F1：缺省场地改 4:3 横向（16×12）——横视口下空间利用率高、舞者呈示更大、
    // 横向移动余地更大（面积 192m² 与旧缺省 12×16 相同）。既有项目零迁移：只影响新建项目，
    // 旧档 12×16 仍可用（舞台页签「3:4」预设一键回到竖向排练厅）。
    // build-62-formations2 F3：+wingM 左右候场区宽（米）——纯视觉标记，不改舞者位置域；
    //   validateProject 同步清洗。
    // build-63-stageview2 F1：后台/候场瘦身——缺省 backstageM 2→1、wingM 1.5→1（后台通道不占
    //   大面积；既有项目保留各自数值零迁移，范围 [0,10]/[0,5] 不变）。
    stage: { widthM: 16, depthM: 12, audience: 'bottom', gridM: 0.5, snap: true, backstageM: 1, wingM: 2, bgImage: null },
    audio: { name: '', durationSec: 0, bpm: DEFAULT_BPM, beatsPerBar: 4, firstBeatSec: 0 },
    media: { assets: [], activeAssetId: null }, // v3 音乐剪辑：媒体资产库（blob 走存储层，项目记录只存元数据）
    settings: { labelMode: 'no' }, // 项目级显示设置：'no'=编号序号(1..N) | 'short'=简称 | 'name'=姓名
    dancers: [], groups: [], formations: [],
    // build-70-formationclips M1：timeline.blocks 整体退役——队形即 clip（一等时间轴对象），
    // 时长字段 startBeat/lenBeats 直接驻队形；变换段=相邻 clip 间空隙自动推导（不再存 travel）。
    timeline: { metronome: false, playSpeed: 1, tags: [], audioClips: [], tracks: [defaultTrack()] },
    // build-68-nocountin：timeline.countInBeats（数拍入场）退役——不再生成该字段；
    // sanitizeTimeline 对旧 JSON 里的残留做容忍剥离（delete，零迁移），载入不报错。
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
  // 初始队形：双横排（build-70 M1：首 clip [0, 16) 拍缺省）
  const f = { id: uid('f'), name: '开场队形', color: '#64748b', note: '', positions: {}, startBeat: 0, lenBeats: FORM_CLIP_LEN_DEFAULT };
  project.formations.push(f);
  genDefaultRows(project, f);
  if (presetMerged) applyPresetMerged(project, f, pairs);
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
// 开场双横排生成（Wave1 需求 5 起导出）：可选第三参 options = { ids }——提供时仅对这些舞者
// 写生成位置（其余舞者位置原样保留），行数/间距等几何按子集人数推导（内部逻辑只在 ids 子集
// 内进行，子集按名册序取、限名册内防悬挂 id 写入 positions）；缺省=现行为（全员，逐字节不变）。
export function genDefaultRows(project, f, options = {}) {
  const roster = orderedDancers(project);
  const ids = (Array.isArray(options.ids) && options.ids.length)
    ? roster.filter(id => options.ids.includes(id))
    : roster;
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
export function dancerById(project, id) { return project.dancers.find(d => d.id === id) || null; }
export function orderedDancers(project) { return project.dancers.map(d => d.id); }
export function removeDancer(project, dancerId) {
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

// build-69-roster R1：画布删除的新语义——仅从指定队形移除（名册保留）。
// 名册是唯一身份源：画布不再是删除舞者的入口。只动该帧：positions 键删除 + 该帧 merges
// 引用清理（清空后键移除，与 removeDancer 同口径）；dancers/groups/其它队形零触碰。
// 可撤销性由调用方经 store.mutate(fn, label) 提交单条历史获得。
export function removeDancerFromFormation(project, formationIndex, dancerIds) {
  const f = project?.formations?.[formationIndex];
  if (!f) return;
  const ids = [...new Set(dancerIds || [])];
  for (const id of ids) delete f.positions[id];
  if (f.merges) {
    f.merges = f.merges.filter(m => !ids.includes(m.a) && !ids.includes(m.b));
    if (!f.merges.length) delete f.merges;
  }
}
// build-69-roster R2：「重新入队」——把名册舞者补齐进全部缺席队形（曾被「移出队形」者）。
// 复用 ensureDancerInFormation（补位语义与新增舞者一致）；返回补齐的队形数
//（0=本就全勤，名册 UI 据此 disabled）。
export function rejoinFormations(project, dancerId) {
  if (!dancerById(project, dancerId)) return 0;
  let n = 0;
  for (const f of project.formations) {
    if (!f.positions[dancerId]) { ensureDancerInFormation(project, f, dancerId); n++; }
  }
  return n;
}
// Wave1 需求 5：「在场」判定——舞者位置在舞台矩形内（0≤x≤widthM 且 0≤y≤depthM，含边界）。
// 后台（depthM 外条带）/左右候场（wingM 条带）/观众区舞者均在矩形外，一律不算在场。
// 按名册序返回在场舞者 id（生成器 ids 子集与名册上场状态的共用口径）。
export function onStageIds(project, formation) {
  const { widthM, depthM } = project?.stage || {};
  const out = [];
  for (const d of project?.dancers || []) {
    const p = formation?.positions?.[d.id];
    if (p && p.x >= 0 && p.x <= widthM && p.y >= 0 && p.y <= depthM) out.push(d.id);
  }
  return out;
}
// Wave1 需求 6：名册「上场」——把舞者写入指定队形（positions 补位）。源位置顺延：其它队形
// 有位 → 取与当前队形距离最近的一个（|i−fi| 同距取更早者，与 carryPositionsForward 的
// 「向前找」口径一致），x/y/facing 整体顺延；全部无位 → 舞台中央（facing=面向观众，与
// ensureDancerInFormation 同口径）。已在场/非法入参 → no-op 返回 false；写入成功返回 true。
// 纯函数（原地改 project，单条历史由调用方 store.mutate 提交）。
export function admitToFormation(project, formationIndex, dancerId) {
  const fs = project?.formations || [];
  const f = fs[formationIndex];
  if (!f || !dancerById(project, dancerId)) return false;
  if (f.positions[dancerId]) return false; // 已在场：no-op
  let src = null;
  for (let k = 1; !src && k < fs.length; k++) {
    const back = fs[formationIndex - k];
    const fwd = fs[formationIndex + k];
    src = (back && back.positions[dancerId]) ? back.positions[dancerId]
      : (fwd && fwd.positions[dancerId]) ? fwd.positions[dancerId] : null;
  }
  f.positions[dancerId] = src
    ? { x: src.x, y: src.y, facing: src.facing }
    : { x: project.stage.widthM / 2, y: project.stage.depthM / 2, facing: faceAudience(project.stage) };
  return true;
}
// ---------- build-69-roster R3：批量添加（名册是唯一身份源，批量入口在名册） ----------
// 命名延续既有 M_i/F_i 序列语义（createProject 的 pairs 形态）：扫描名册取前缀最大序号+1。
function nextNameIndex(project, prefix) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const d of project.dancers) {
    const m = re.exec(d.name || '');
    if (m) max = Math.max(max, +m[1]);
  }
  return max + 1;
}
// 「第k对」编组命名序：取既有「第k对」最大序+1（与 gender 分组并存；追加不冲突）
function nextCoupleIndex(project) {
  let max = 0;
  for (const g of project.groups || []) {
    const m = /^第(\d+)对$/.exec(g.name || '');
    if (m) max = Math.max(max, +m[1]);
  }
  return max + 1;
}
// 按对添加 n 对：每对 M_k/F_k（k 为男女统一序——男女各自序列都从同一 k 起，避免错位配对），
// 并建「第g对」编组 {memberIds:[男,女]}（复用既有 createGroup/groups 结构）。
// 返回新增舞者 id（按对交替，先男后女）；新舞者经 addDancer 自动补进全部队形。
export function addCouples(project, n) {
  const cnt = Math.max(0, Math.floor(+n || 0));
  const added = [];
  let k = Math.max(nextNameIndex(project, 'M'), nextNameIndex(project, 'F'));
  let g = nextCoupleIndex(project);
  for (let i = 0; i < cnt; i++, k++, g++) {
    const m = addDancer(project, `M${k}`, 'M');
    const f = addDancer(project, `F${k}`, 'F');
    createGroup(project, [m.id, f.id], `第${g}对`);
    added.push(m.id, f.id);
  }
  return added;
}
// 按数量添加 n 名指定角色舞者（role 'M'|'F'|'X'）：命名按角色前缀延续（X 用 舞者n 序列）。
// 返回新增舞者 id；不建编组（按对语义仅 addCouples 承担）。
export function addDancersBatch(project, n, role = 'X') {
  const cnt = Math.max(0, Math.floor(+n || 0));
  const r = ['M', 'F', 'X'].includes(role) ? role : 'X';
  const prefix = r === 'X' ? '舞者' : r;
  const added = [];
  let k = nextNameIndex(project, prefix);
  for (let i = 0; i < cnt; i++, k++) {
    added.push(addDancer(project, `${prefix}${k}`, r).id);
  }
  return added;
}

// ---------- RTS 式编组（project.groups：纯选择辅助，可与合并交叉叠加，不改变渲染/数据语义） ----------
export function groupById(project, groupId) { return (project.groups || []).find(g => g.id === groupId) || null; }
export function nextGroupName(project) {
  const used = new Set((project.groups || []).map(g => g.name));
  let n = 1;
  while (used.has(`组${n}`)) n++;
  return `组${n}`;
}
export function createGroup(project, memberIds = [], name = '') {
  const g = { id: uid('g'), name: name || nextGroupName(project), memberIds: [...memberIds] };
  project.groups = project.groups || [];
  project.groups.push(g);
  return g;
}
export function removeGroup(project, groupId) {
  project.groups = (project.groups || []).filter(g => g.id !== groupId);
}
export function renameGroup(project, groupId, name) {
  const n = String(name ?? '').trim().slice(0, 40);
  if (!n) return;
  const g = groupById(project, groupId);
  if (g) g.name = n;
}
export function setGroupMembers(project, groupId, memberIds) {
  const g = groupById(project, groupId);
  if (g) g.memberIds = [...new Set(memberIds)];
}
// 组选择的单元原子展开：成员若在合并单元中，展开为整单元两人
export function expandUnits(formation, ids) {
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
export function carryPositionsForward(project, index) {
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
// build-73-syncui F1：把指定舞者在 index 队形的当前坐标同步到其后所有队形（批量调队形：
// 先摆好一段，再一键把后续同名舞者全部带到同一摆位）。纯函数（原地改 project，store.mutate
// 提交单条历史可撤销）。语义要点：
//   ① 仅同步 x/y——facing 保留目标队形原值（朝向是逐段表演语义，不由批量同步覆盖）；
//   ② 源队形缺位的 id（越界/已移出当前队形）直接忽略——不臆造坐标；
//   ③ 后续队形缺同名舞者（已移出）跳过——不做 ensureFormationComplete 补位（那是入场语义）；
//   ④ 末队形（无后续）自然返回 {formations:0}——调用方（菜单项）据此隐藏入口。
// 返回 {formations, dancers}：实际写入的队形数 / 有效同步的舞者数（toast 口径）。
// Wave1 需求 4：泛化出 syncPositionsRange——dir 'forward'|'backward' + 有限 count=只同步
// 相邻的 N 个队形（forward=index+1..index+N；backward=index-1..index-N；越界自动截断；
// count 非有限数=不限）。语义与上完全一致（只同步 x/y、facing 保留、缺位跳过）；
// syncForwardPositions 保留为薄包装（现调用方/测试零改写）。
export function syncPositionsRange(project, formationIndex, dancerIds, { dir = 'forward', count = Infinity } = {}) {
  const src = project.formations[formationIndex];
  if (!src) return { formations: 0, dancers: 0 };
  const ids = (dancerIds || []).filter(id => src.positions[id]);
  if (!ids.length) return { formations: 0, dancers: 0 };
  const backward = dir === 'backward';
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : Infinity;
  let formations = 0;
  for (let k = 1; k <= n; k++) {
    const i = formationIndex + (backward ? -k : k);
    if (i < 0 || i >= project.formations.length) break; // 越界自动截断
    const f = project.formations[i];
    let touched = false;
    for (const id of ids) {
      const cur = f.positions[id];
      if (!cur) continue;
      const from = src.positions[id];
      cur.x = from.x;
      cur.y = from.y;
      touched = true;
    }
    if (touched) formations++;
  }
  return { formations, dancers: ids.length };
}
export function syncForwardPositions(project, formationIndex, dancerIds) {
  return syncPositionsRange(project, formationIndex, dancerIds);
}

// ---------- 帧内合并单元（任意两名舞者合为一个呈示符号） ----------
export const UNIT_STYLES = ['capsule', 'single'];
export const mergeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export function findMerge(formation, idA, idB) {
  const key = mergeKey(idA, idB);
  return (formation.merges || []).find(m => mergeKey(m.a, m.b) === key) || null;
}
export function addMerge(formation, idA, idB, style = 'capsule') {
  if (idA === idB || findMerge(formation, idA, idB)) return null;
  if (!UNIT_STYLES.includes(style)) style = 'capsule';
  // 一名舞者同时只属于一个合并单元：先解除两人涉及的其他绑定（替换语义）
  formation.merges = (formation.merges || []).filter(m => m.a !== idA && m.b !== idA && m.a !== idB && m.b !== idB);
  const m = { a: idA, b: idB, style };
  formation.merges.push(m);
  return m;
}
export function removeMerge(formation, idA, idB) {
  const key = mergeKey(idA, idB);
  formation.merges = (formation.merges || []).filter(m => mergeKey(m.a, m.b) !== key);
}
export function setMergeStyle(formation, idA, idB, style) {
  const m = findMerge(formation, idA, idB);
  if (m && UNIT_STYLES.includes(style)) m.style = style;
}
// 把合并单元两人收拢/拆开到标准间距（用于呈示切换与合并确认的后处理）
export function collapseUnit(f, idA, idB) {
  const a = f.positions[idA], b = f.positions[idB];
  if (!a || !b) return;
  const mx = Math.round(((a.x + b.x) / 2) * 100) / 100;
  const my = Math.round(((a.y + b.y) / 2) * 100) / 100;
  a.x = b.x = mx; a.y = b.y = my;
}
// 帧布局顺延：仅补齐缺席舞者位置；合并单元完全由手动操作创建
export function applyFormationLayout(project, index) {
  const f = project.formations[index];
  if (!f) return;
  carryPositionsForward(project, index);
}
// 按名册当前列表顺序重编 short（第 n 人 = n）
export function renumberShorts(project) {
  project.dancers.forEach((d, i) => { d.short = String(i + 1); });
}

// ---------- 舞者标签（canvas 呈示文本；round23 需求 2 显示字段可切换） ----------
// labelMode：'no'=编号序号(1..N，名册顺序) | 'short'=简称 | 'name'=姓名（缺失回退简称→序号）。
// 默认 'no'：标准建档（short=序号）下呈示与历史版本逐字节一致（零迁移成本）。
export const LABEL_MODES = ['no', 'short', 'name'];
export function labelModeOf(project) {
  const lm = project?.settings?.labelMode;
  return LABEL_MODES.includes(lm) ? lm : 'no';
}
export function dancerOrdinal(project, dancerId) {
  const i = project.dancers.findIndex(d => d.id === dancerId);
  return i + 1; // 0 → 无此人
}
export function dancerLabel(project, dancer, ordinal = dancerOrdinal(project, dancer?.id), mode = labelModeOf(project)) {
  const no = ordinal > 0 ? String(ordinal) : String(dancer?.short ?? '?');
  if (!dancer) return no;
  if (mode === 'name') { const nm = String(dancer.name ?? '').trim(); return nm || dancer.short || no; }
  if (mode === 'short') return String(dancer.short ?? '') || no;
  return no;
}
// 长名截断省略：圆内空间约 4 字符（名称模式>4 截为 3+…；序号/简称通常不受影响）
export function truncateLabel(s, max = 4) {
  const t = String(s ?? '');
  return t.length <= max ? t : t.slice(0, Math.max(1, max - 1)) + '…';
}
// build-74-labelname：舞者级显示覆盖——dancer.labelMode ∈ LABEL_MODES 时覆盖项目级
// settings.labelMode；'' / 缺省 / 非法 = 跟随项目（validateProject 对非法值做 delete 清洗）。
export function effectiveLabelMode(project, dancer) {
  const lm = dancer?.labelMode;
  return LABEL_MODES.includes(lm) ? lm : labelModeOf(project);
}
// 舞台呈示标签表（Map<id, {text, idx}>）：每舞者按各自有效模式解析文本；解析文本重合的
// 舞者（简称/姓名模式下的同名同姓等）按名册顺序加 1..n 角标去重（idx=0 无角标）。
// 'no' 模式序号天然唯一；跨模式混合（覆盖不一致）同样按文本判重，天然兜底。
export function labelTableOf(project) {
  const table = new Map();
  const byText = new Map();
  const ds = Array.isArray(project?.dancers) ? project.dancers : [];
  ds.forEach((d, i) => {
    const text = dancerLabel(project, d, i + 1, effectiveLabelMode(project, d));
    table.set(d.id, { text, idx: 0 });
    if (!byText.has(text)) byText.set(text, []);
    byText.get(text).push(d.id);
  });
  for (const ids of byText.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, k) => { table.get(id).idx = k + 1; });
  }
  return table;
}
// 一键生成简称：默认档案名（M1/F12 这类 /^[A-Za-z]\d+$/）原名即简称；其余取首个字素
// （[...nm] 按码点切，emoji/扩展区汉字不劈半）；空名保留原值。重合不在此消解——呈示层
// labelTableOf 角标去重兜底。返回实际改动人数（toast 用）。
export function autoShorts(project) {
  let n = 0;
  for (const d of (Array.isArray(project?.dancers) ? project.dancers : [])) {
    const nm = String(d.name ?? '').trim();
    if (!nm) continue;
    const s = /^[A-Za-z]\d+$/.test(nm) ? nm : ([...nm][0] || '');
    if (s && s !== d.short) { d.short = s; n++; }
  }
  return n;
}

// ---------- 场地预设（build-61-stageaspect F2：宽:深 比例/尺度档，纯数据+纯函数，node 可测） ----------
// 只写 widthM/depthM（audience/backstage/grid 不动）；档位参考场地类型见 kind。
// 4:3 档即新建项目缺省（F1）；「小场地」8×6 与 16×12 同为 4:3 比例——高亮匹配因此
// 先按精确宽深命中（区分这对同比档），再按宽深比兜底（自由输入 20×15 仍亮 4:3 档）。
export const STAGE_PRESETS = [
  { id: '43',    label: '4:3',   widthM: 16, depthM: 12, kind: '标准舞池' },
  { id: '34',    label: '3:4',   widthM: 12, depthM: 16, kind: '竖向排练厅' },
  { id: '11',    label: '1:1',   widthM: 14, depthM: 14, kind: '方形场地' },
  { id: '169',   label: '16:9',  widthM: 18, depthM: 10, kind: '宽幅舞台' },
  { id: 'small', label: '小场地', widthM: 8,  depthM: 6,  kind: '小排练室' },
];
// 给定宽深 → 命中预设档 id 或 null（都不中=钮全不亮）。比率比较用交叉相乘+绝对 ε，
// 规避浮点除法不等（尺寸输入 step 0.5，值可含 .5 小数）。
export function stagePresetHit(widthM, depthM, presets = STAGE_PRESETS) {
  const w = Number(widthM), d = Number(depthM);
  if (!Number.isFinite(w) || !Number.isFinite(d) || w <= 0 || d <= 0) return null;
  const exact = presets.find(p => p.widthM === w && p.depthM === d);
  if (exact) return exact.id;
  const byRatio = presets.find(p => Math.abs(p.widthM * d - w * p.depthM) <= 1e-6);
  return byRatio ? byRatio.id : null;
}

// ---------- 队形 ----------
// 观众方向 → 面向观众的朝向角（0=上/−y 顺时针）。
// build-62-formations2 F3 语义修订：bottom/top 是「观众显示方向」（正面视角/背面镜像视角），
// 数据坐标恒按「观众在数据 +y 侧」的底侧约定（genSlots 几何/后台区布局同此约定）——
// audience='top' 时画布渲染做垂直镜像（y'=depthM−y，朝向角经 stage.js mirrorFacing 随之镜像），
// 因此 top 与 bottom 的数据朝向一致（180）：显示镜像后舞者恰好面向画面上方的观众标注。
// left/right 仍是数据侧语义（无镜像，几何约定维持现状）。
export function faceAudience(stage) { return { bottom: 180, top: 180, left: 270, right: 90 }[stage.audience] ?? 180; }
export function ensureDancerInFormation(project, formation, dancerId) {
  if (formation.positions[dancerId]) return;
  const n = Object.keys(formation.positions).length;
  formation.positions[dancerId] = {
    x: project.stage.widthM / 2 + (n % 5 - 2) * 0.6,
    y: project.stage.depthM / 2 + (Math.floor(n / 5) - 1) * 0.6,
    facing: faceAudience(project.stage),
  };
}
export function ensureFormationComplete(project, formation) {
  for (const d of project.dancers) ensureDancerInFormation(project, formation, d.id);
}
// build-70-formationclips M2：＋新队形=追加到**末 clip.end 之后**（len=16 拍缺省）——clip 模型下
// 无「插入中间」语义（插入点无空隙可落，交叉禁止不变式排除之）；srcIndex 仅决定复制谁的内容
//（positions/merges/note）。数组序=时间序不变式由「追加在末尾」按构造成立。
export function createFormationFrom(project, srcIndex, { name } = {}) {
  const src = project.formations[srcIndex];
  const lastEnd = project.formations.length
    ? clipEndOf(project.formations[project.formations.length - 1]) : 0;
  const f = {
    id: uid('f'), name: name || `队形 ${project.formations.length + 1}`,
    color: ['#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'][project.formations.length % 6],
    note: src?.note || '',
    positions: src ? clone(src.positions) : {},
    merges: src && src.merges ? clone(src.merges) : [],
    startBeat: rBeat(lastEnd), lenBeats: FORM_CLIP_LEN_DEFAULT,
  };
  project.formations.push(f);
  ensureFormationComplete(project, f);
  return f;
}
// build-70 M2：删除队形=移除 formation+clip，**空位保留**——后续队形的 startBeat/lenBeats
// 一个字节不动（被删 clip 留下的空白=前邻与后邻之间的变换段，自动适应——需求「删除不把
// 后续队形移过来」的模型级保证）。
export function deleteFormation(project, index) {
  if (project.formations.length <= 1) return null;
  const [rm] = project.formations.splice(index, 1);
  return rm;
}
// 调整队形顺序：clip 槽位（startBeat/lenBeats 集合）留在原地、内容按新序换槽——
// 旧 blocks 模型 syncTimeline「时长保序、内容换位」语义的 clip 对应（总布局逐值不变）。
export function moveFormation(project, from, to) {
  if (from === to || from < 0 || from >= project.formations.length) return;
  const slots = project.formations.map(f => ({ startBeat: f.startBeat, lenBeats: f.lenBeats }));
  const [f] = project.formations.splice(from, 1);
  project.formations.splice(clamp(to, 0, project.formations.length), 0, f);
  project.formations.forEach((g, i) => { g.startBeat = slots[i].startBeat; g.lenBeats = slots[i].lenBeats; });
}
export function formationIndexById(project, fid) { return project.formations.findIndex(f => f.id === fid); }

// ---------- 时间轴（build-70-formationclips M1：队形即 clip，blocks 模型退役） ----------
// 队形是一等时间轴对象：startBeat（clip 起点，≥0）与 lenBeats（clip 长度，≥1 拍）直接驻队形。
// 变换（travel）不再存于数据——**相邻两 clip 之间的空隙即变换段**，时长=空隙本身（自动适应
// clip 增删/移动/缩放产生的空白，可为 0=瞬时切换）；[0, 首 clip.start) 保持首队形（候场）、
// [末 clip.end, 域尾) 保持末队形。交叉禁止不变式：按 startBeat 排序后 clip[i].end ≤ clip[i+1].start
//（载入迁移/移动/缩放/空隙调整全链钳制收口）。数组序=时间序不变式由全部写路径维持。
export const FORM_CLIP_LEN_DEFAULT = 16; // 新建 clip 缺省长度（拍）
export const FORM_CLIP_LEN_MIN = 1;      // clip 长度下限（拍）
const rBeat = v => Math.round(Number(v) * 100) / 100;
// clip 字段读取（读侧兜底）：缺省/非数值回退缺省值；有限但越域的钳回合法域（0.5 拍脏数据 → 1）
export function clipStartOf(f) {
  const v = Number(f?.startBeat);
  return Number.isFinite(v) ? rBeat(Math.max(0, v)) : 0;
}
export function clipLenOf(f) {
  const v = Number(f?.lenBeats);
  return Number.isFinite(v) ? rBeat(Math.max(FORM_CLIP_LEN_MIN, v)) : FORM_CLIP_LEN_DEFAULT;
}
export function clipEndOf(f) { return rBeat(clipStartOf(f) + clipLenOf(f)); }
// 段派生（纯函数）：segments=按 startBeat 排序的 clip 列表（start/end=clip 时间域、
// i=formations 数组下标——运行时不变式下两者同序），totalBeats=末 clip.end（=编舞域尾）。
// 旧 computeSegments（hold/travel 累计推导）退役：clip 内=保持位形、clip 间空隙=变换段，
// 不再有独立的过渡时长可读——变换时长永远=空隙本身（自动适应）。
export function segmentsFromClips(formations) {
  const fs = Array.isArray(formations) ? formations : [];
  const items = fs.map((f, i) => ({ f, i, start: clipStartOf(f), end: clipEndOf(f) }))
    .sort((a, b) => a.start - b.start || a.i - b.i);
  const segments = items.map(it => ({ i: it.i, formationId: it.f.id, start: it.start, end: it.end }));
  return { segments, totalBeats: segments.length ? segments[segments.length - 1].end : 0 };
}
export function spb(project) { return 60 / (project.audio.bpm || DEFAULT_BPM); }
export function beatToSec(project, beat) { return (project.audio.firstBeatSec || 0) + beat * spb(project); }
export function secToBeat(project, sec) { return (sec - (project.audio.firstBeatSec || 0)) / spb(project); }

export function totalDurationSec(project) {
  const { totalBeats } = segmentsFromClips(project.formations);
  return beatToSec(project, totalBeats);
}
// ---------- 音乐域基座（音乐模式重定位 M1 · D1；build-70 换源） ----------
// 音乐模式时间轴主域上界（秒）：max(末队形 clip.end 换算秒, 音频 clip 终点, 活动资产时长, 10s 托底)。
// build-70-formationclips：队形 clip 成为一等时间轴对象后，其域随 clip 拖动/缩放/增删自动伸缩
//（同形换源——max 公式不变，新增末队形 clip.end 参与取大；音频 clip 终点 ≤ 资产时长，保留项显式自洽）。
// 该模块反向 import 无（clip 终点就地规约，不 import audio-clips——避免依赖环）。
export function musicDomainSec(p) {
  let clipEnd = 0;
  for (const c of clipsOf(p)) {
    const e = (Number(c.timelineStartSec) || 0) + (Number(c.lengthSec) || 0);
    if (e > clipEnd) clipEnd = e;
  }
  const assetDur = Number(activeAssetOf(p)?.durationSec) || 0;
  const formEndSec = beatToSec(p, segmentsFromClips(p?.formations).totalBeats);
  return Math.max(formEndSec, clipEnd, assetDur, 10);
}

// ---------- 时间轴标记（音乐时间轴 tag 道：主歌/副歌/间奏等分段记号） ----------
// build-49-tagregion F1 区域块化：tag=区域块 { id, name, level(0..2), beat=区域起点拍（字段名沿用）,
// endBeat=区域终点拍（必填，> beat）, color?, sig?, bars? }。区域即段——索引/划分轨的「段」概念
// 直接读 [beat,endBeat)，空白=该层该处没有任何区域；音乐模式不再由 sectionSegmentsOf 邻接推导。
// 当前以时间轴（秒）为唯一对齐规范（beat↔second 映射机制保留：stage 编舞仍需），BPM 估计全面退场。
export const TAG_NAME_MAX = 20;
// 区域宽缺省/下限（拍）：新建/迁移末尾=16（2 个 4/4 小节）；零/负宽兜底与拖缘下限=1 拍
export const TAG_REGION_DEFAULT_BEATS = 16;
export const TAG_REGION_MIN_BEATS = 1;
// 区域终点读取（UI/索引共用）：缺 endBeat（未迁移数据兜底）→ beat+16
export function tagEndBeatOf(tag) {
  const e = Number(tag?.endBeat);
  return Number.isFinite(e) ? e : (Number(tag?.beat) || 0) + TAG_REGION_DEFAULT_BEATS;
}
function cleanTagName(name) { return String(name ?? '').trim().slice(0, TAG_NAME_MAX); }
// 清洗（validateProject/导入入口共用）：丢弃非合法项——beat 非有限或负值、清洗后 name 为空、
// 重复 id（保首个弃后续）；id 缺失/空则补 uid。返回新数组，不改输入。
// color（W1 段色板 0..3）：合法整数则透传；无/非法 → 输出不含该键（shape 与既有逐值一致）。
// level/sig/bars（build-47 分层+手动节奏标注）：三者均为可选字段、缺省即旧数据零迁移——
//   level 合法整数钳 0..TAG_LEVEL_MAX 后非 0 才落盘（0=最高层=缺省，不写键）；
//   sig 白名单（TAG_SIGS）外不落键；bars 非正整数不落键。
// description（Wave1 需求 1）：非空字符串 trim 后保留（slice 200）；空/非法不落键。
// build-49 F1：清洗后统一过 resolveTagRegions——旧点 tag 迁移为区域 + 不变式强制（见其注释）。
export function sanitizeTags(raw) {
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
    const levelOk = clampTagLevel(t.level);
    const sigOk = TAG_SIGS.includes(t.sig) ? t.sig : null;
    const barsOk = tagBarsValid(t.bars) ? t.bars : null;
    // description（Wave1 需求 1）：区域备注——非空字符串 trim 后保留（slice 200）；空/非法
    // 不落键（JSON 往返不新增键，与既有 sig/bars 同纪律）。
    const desc = typeof t.description === 'string' ? t.description.trim().slice(0, 200) : '';
    out.push({
      id, beat, name,
      // build-49 F1：区域终点透传（有限才落键；合法性/不变式由 resolveTagRegions 统一强制）
      ...(Number.isFinite(Number(t.endBeat)) ? { endBeat: Number(t.endBeat) } : {}),
      ...(colorOk ? { color: t.color } : {}),
      ...(levelOk ? { level: levelOk } : {}),
      ...(sigOk ? { sig: sigOk } : {}),
      ...(barsOk ? { bars: barsOk } : {}),
      ...(desc ? { description: desc } : {}),
    });
  }
  return resolveTagRegions(out);
}
// ---------- 区域解析与不变式（build-49-tagregion F1，数组级一遍；就地改写传入项、返回原数组） ----------
// ①迁移（只在缺 endBeat 时）：同层按 beat 排序（同拍位按 id 稳定序），endBeat=下一个同层 tag.beat
//   （无缝衔接，保留旧分段观感），末尾 tag endBeat=beat+16；
// ②不变式强制：endBeat 非有限或 ≤ beat → beat+1 兜底；同层不交叠——越界钳到邻界（容忍相等=贴合），
//   钳后仍 ≤ beat（同拍位退化，UI 拖拽不会造出）→ beat+1 兜底。
// 已有合法 endBeat 且不越界的数据零触碰（JSON 往返逐字节稳定）。数组顺序不重排（渲染层自排序）。
const rTag2 = v => Math.round(v * 100) / 100;
export function resolveTagRegions(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  const byLevel = new Map();
  for (const t of arr) {
    const lv = tagLevelOf(t);
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(t);
  }
  for (const list of byLevel.values()) {
    list.sort((a, b) => a.beat - b.beat || String(a.id).localeCompare(String(b.id)));
    // ①迁移：缺 endBeat → 无缝衔接/末尾 +16
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!Number.isFinite(Number(t.endBeat))) {
        t.endBeat = i + 1 < list.length ? list[i + 1].beat : rTag2(t.beat + TAG_REGION_DEFAULT_BEATS);
      }
    }
    // ②不变式：endBeat > beat → 同层不交叠钳制 → 钳后兜底
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!(Number(t.endBeat) > t.beat)) t.endBeat = rTag2(t.beat + TAG_REGION_MIN_BEATS);
      if (i + 1 < list.length && t.endBeat > list[i + 1].beat) t.endBeat = rTag2(list[i + 1].beat);
      if (!(t.endBeat > t.beat)) t.endBeat = rTag2(t.beat + TAG_REGION_MIN_BEATS);
    }
  }
  return arr;
}
export function tagById(project, id) { return (project.timeline.tags || []).find(t => t.id === id) || null; }
// 默认名「标记 N」：N 从现有数量+1 起找第一个未被占用的号（删除后打点不重号）
export function nextTagName(project) {
  const tags = project.timeline.tags || [];
  const used = new Set(tags.map(t => t.name));
  let n = tags.length + 1;
  while (used.has(`标记 ${n}`)) n++;
  return `标记 ${n}`;
}
export function addTag(project, beat, name = '', extra = null) {
  project.timeline.tags = project.timeline.tags || [];
  const b = Number(beat);
  const t = { id: uid('tag'), beat: Number.isFinite(b) ? Math.max(0, b) : 0, name: cleanTagName(name) || nextTagName(project) };
  // 区域宽（build-49 F1）：缺省 16 拍（2 个 4/4 小节）；extra.endBeat 合法（有限且 > beat）则用之
  const eb = Number(extra?.endBeat);
  t.endBeat = rTag2(Number.isFinite(eb) && eb > t.beat ? eb : t.beat + TAG_REGION_DEFAULT_BEATS);
  // build-47 可选字段（分层编辑器/长按新建入口）：合法才落键（缺省 shape 与旧数据逐值一致）
  if (extra && typeof extra === 'object') {
    const lv = clampTagLevel(extra.level);
    if (lv) t.level = lv;
    if (TAG_SIGS.includes(extra.sig)) t.sig = extra.sig;
    if (Number.isInteger(extra.bars) && extra.bars > 0) t.bars = extra.bars;
  }
  project.timeline.tags.push(t);
  resolveTagRegions(project.timeline.tags); // 层内不交叠钳制（右邻区贴合；同层无空间时缩到邻界内）
  return t;
}
export function removeTag(project, id) {
  project.timeline.tags = (project.timeline.tags || []).filter(t => t.id !== id);
}
export function renameTag(project, id, name) {
  const t = tagById(project, id);
  const n = cleanTagName(name);
  if (t && n) t.name = n;
}
// 移动标记（stage 拖旗路径沿用；build-49 区域模型）：整块平移——endBeat 随 beat 同步平移保持区域宽。
// 负值钳 0、两位小数舍入；区域是否压到同层邻区由 UI 层拖拽钳制（clampRegionMove）把守，此处兜底不变式
// 交由下一次 sanitize/resolve（JSON 往返/导入）收口。
export function moveTag(project, id, beat) {
  const t = tagById(project, id);
  const b = Number(beat);
  if (t && Number.isFinite(b)) {
    const nb = Math.max(0, Math.round(b * 100) / 100);
    const w = Math.max(TAG_REGION_MIN_BEATS, tagEndBeatOf(t) - t.beat);
    t.beat = nb;
    t.endBeat = rTag2(nb + w);
  }
}

// ---------- 区域几何钳制纯函数（build-49 F2 交互同构，node 可测；UI 拖拽与模型写入共用口径） ----------
// 同层邻界（贴靠式约束）：lo=左邻区 endBeat（无左邻=0）；hi=右邻区 beat（无右邻=Infinity）。
// level 给定时按目标层解析（跨层落位用）；缺省=tag 当前层。自身不参与（同层移动不受自己约束）。
export function tagRegionBounds(project, tagId, level = null) {
  const t = tagById(project, tagId);
  if (!t) return { lo: 0, hi: Infinity, width: TAG_REGION_DEFAULT_BEATS };
  const lv = Number.isInteger(level) ? level : tagLevelOf(t);
  let lo = 0, hi = Infinity;
  const others = (project.timeline.tags || [])
    .filter(x => x.id !== t.id && tagLevelOf(x) === lv)
    .sort((a, b2) => a.beat - b2.beat);
  for (const o of others) {
    if (o.beat <= t.beat) lo = Math.max(lo, tagEndBeatOf(o));
    else hi = Math.min(hi, o.beat);
  }
  return { lo, hi, width: Math.max(TAG_REGION_MIN_BEATS, tagEndBeatOf(t) - t.beat) };
}
// 整块移动钳制：newBeat ∈ [lo, hi-width]；无空间（hi-width < lo，左右邻区已贴合）→ null（原位不动）
export function clampRegionMove(newBeat, width, lo, hi) {
  const b = Number(newBeat);
  if (!Number.isFinite(b)) return null;
  const w = Math.max(TAG_REGION_MIN_BEATS, Number(width) || TAG_REGION_MIN_BEATS);
  const l = Math.max(0, Number.isFinite(lo) ? lo : 0);
  const h = Number.isFinite(hi) ? hi : Infinity;
  if (h - w < l) return null;
  return rTag2(Math.max(l, Math.min(b, h - w)));
}
// 边界钳制：side 'L' → beat ∈ [lo, endBeat-最小宽]；side 'R' → endBeat ∈ [beat+最小宽, hi]
export function clampRegionEdge(side, value, beat, endBeat, lo, hi) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (side === 'L') {
    const l = Math.max(0, Number.isFinite(lo) ? lo : 0);
    return rTag2(Math.max(l, Math.min(v, endBeat - TAG_REGION_MIN_BEATS)));
  }
  const h = Number.isFinite(hi) ? hi : Infinity;
  return rTag2(Math.max(beat + TAG_REGION_MIN_BEATS, Math.min(v, h)));
}
// 区域移动（拖体路径）：当前层邻界钳制后整块平移；无空间/未知 id 不动（返回是否变更）
export function moveTagRegion(project, tagId, newBeat) {
  const t = tagById(project, tagId);
  if (!t) return false;
  const { lo, hi, width } = tagRegionBounds(project, tagId);
  const b = clampRegionMove(newBeat, width, lo, hi);
  if (b == null) return false;
  t.beat = b;
  t.endBeat = rTag2(b + width);
  return true;
}
// 区域边界调整（拖缘路径）：'L'=改 beat（首缘）、'R'=改 endBeat（尾缘）；邻界贴合 + 最小宽 1 拍钳制
export function resizeTagRegion(project, tagId, side, value) {
  const t = tagById(project, tagId);
  if (!t) return false;
  const { lo, hi } = tagRegionBounds(project, tagId);
  const v = clampRegionEdge(side === 'L' ? 'L' : 'R', value, t.beat, tagEndBeatOf(t), lo, hi);
  if (v == null) return false;
  if (side === 'L') t.beat = v; else t.endBeat = v;
  return true;
}
// 跨层落位（拖体换层路径）：目标层邻界钳制（贴合式）；目标层无空间 → 不动（返回 null）。
// 落位成功 = level 变更 + beat/endBeat 整块平移到钳制后位置。
export function placeTagRegion(project, tagId, level, newBeat) {
  const t = tagById(project, tagId);
  if (!t || !Number.isInteger(level)) return null;
  const lv = clampTagLevel(level);
  const { lo, hi, width } = tagRegionBounds(project, tagId, lv);
  const b = clampRegionMove(newBeat, width, lo, hi);
  if (b == null) return null;
  if (lv === 0) delete t.level; else t.level = lv;
  t.beat = b;
  t.endBeat = rTag2(b + width);
  return t;
}
// 层内重贴（升降级/落层后调用）：区域钳回当前层邻界内——保宽优先平移，无空间则贴 lo 并缩宽（≥最小宽）
export function fitTagRegionInLevel(project, tagId) {
  const t = tagById(project, tagId);
  if (!t) return;
  const { lo, hi, width } = tagRegionBounds(project, tagId);
  if (t.beat < lo || tagEndBeatOf(t) > hi) {
    if (hi - width >= lo) {
      const nb = rTag2(Math.max(lo, Math.min(t.beat, hi - width)));
      t.beat = nb;
      t.endBeat = rTag2(nb + width);
    } else {
      t.beat = rTag2(lo);
      t.endBeat = rTag2(lo + Math.max(TAG_REGION_MIN_BEATS, Math.min(width, hi - lo)));
    }
  }
}
// tag.color（W1 节奏划分轨换色）：0..3 = 段色板索引（呈示层 SEG_COLORS 解释）；缺省=按段序 4 色循环。
// 可选字段、向后兼容：旧项目无 color → sanitize 原样不含该键（shape 与既有逐值一致，零迁移成本）。
export const SEG_COLOR_COUNT = 4;

// ---------- tag 分层 + 手动节奏标注（build-47-taghier） ----------
// level：层级 0..TAG_LEVEL_MAX，0=最高层、缺省 0（旧数据零迁移：无 level 键=0，不落盘）。
// sig：拍值字符串白名单（如 '3/4'）；bars：正整数小节数。二者均可缺省（完全不标节奏）。
// 展示组合走 tagRhythmLabel（'3/4 · 2小节' / '3/4' / '2小节' / ''）。
export const TAG_LEVEL_MAX = 3;
export const TAG_SIGS = ['2/4', '3/4', '4/4', '6/8'];
// level 清洗：非法（非整数/越界）钳回 0..MAX；结果 0 = 缺省不落盘
export function clampTagLevel(v) {
  const n = Number(v);
  if (!Number.isInteger(n)) return 0;
  return Math.max(0, Math.min(TAG_LEVEL_MAX, n));
}
function tagBarsValid(v) { return Number.isInteger(v) && v > 0; }
// tag 的有效层级（缺省/非法 → 0）；读侧统一入口
export function tagLevelOf(tag) { return tag ? clampTagLevel(tag.level) : 0; }
// 节奏标注展示组合（纯函数）：sig+bars → '3/4 · 2小节'；只有 sig → '3/4'；只有 bars → '2小节'；都无 → ''
export function tagRhythmLabel(tag) {
  if (!tag) return '';
  const sig = TAG_SIGS.includes(tag.sig) ? tag.sig : null;
  const bars = tagBarsValid(tag.bars) ? tag.bars : null;
  if (sig && bars) return `${sig} · ${bars}小节`;
  if (sig) return sig;
  if (bars) return `${bars}小节`;
  return '';
}
// 项目内出现的层级集合（升序、去空层；无 tag → [0] 单层=现状）。
// maxLevels：呈示层上限截断（移动端传 3——层数最多 3×28px，高层优先保留）。
export function tagLevelsOf(project, maxLevels = TAG_LEVEL_MAX + 1) {
  const set = new Set();
  for (const t of project?.timeline?.tags || []) set.add(tagLevelOf(t));
  if (!set.size) set.add(0);
  return [...set].sort((a, b) => a - b).slice(0, Math.max(1, maxLevels));
}
// 设置 tag 层级（右键「升一级/降一级」入口；非法不动；钳 0..MAX；0=删键保持缺省 shape）
export function setTagLevel(project, tagId, level) {
  const t = tagById(project, tagId);
  if (!t || !Number.isInteger(level)) return null;
  const lv = clampTagLevel(level);
  if (lv === 0) delete t.level; else t.level = lv;
  return t;
}
// 设置手动节奏标注（popover 编辑器入口）：sig ∉ 白名单/空 → 删键；bars 非正整数/空 → 删键。
// 就地改写该 tag；返回该 tag（未知 id → null）。
export function setTagRhythm(project, tagId, { sig = null, bars = null } = {}) {
  const t = tagById(project, tagId);
  if (!t) return null;
  if (TAG_SIGS.includes(sig)) t.sig = sig; else delete t.sig;
  if (tagBarsValid(bars)) t.bars = bars; else delete t.bars;
  return t;
}

// ---------- 显式层管理（build-48-tagui F4）：p.timeline.tagLevelCount（1..3，缺省 1） ----------
// 音乐模式划分轨层数不再按出现 level 推导（tagLevelsOf 退役为索引面板专用），改由本显式计数
// 驱动：空层也渲染轨道（可直接双击/长按建 tag）；「加层/删层」在轨头卡片操作，不再只靠降级。
// JSON 往返：缺省 1 不落键（旧项目 shape 逐值一致）；越层 tag（旧项目降级/导入）sanitize 钳到 count-1。
export const TAG_LEVEL_COUNT_MAX = 3;
// 层数清洗：非整数/越界钳回 1..MAX（非法 → 1=缺省单层）
export function clampTagLevelCount(v) {
  const n = Number(v);
  if (!Number.isInteger(n)) return 1;
  return Math.max(1, Math.min(TAG_LEVEL_COUNT_MAX, n));
}
// 读侧统一入口（缺省/非法 → 1）
export function tagLevelCountOf(project) {
  return clampTagLevelCount(project?.timeline?.tagLevelCount ?? 1);
}
// 设置显式层数：写键（1=删键保持缺省 shape）并把 level > n-1 的 tag 钳降到 n-1（数据不丢失、
// 全部收拢到最底层）。返回生效层数。
export function setTagLevelCount(project, n) {
  const c = clampTagLevelCount(n);
  if (c <= 1) delete project.timeline.tagLevelCount;
  else project.timeline.tagLevelCount = c;
  const maxLv = c - 1;
  for (const t of project.timeline.tags || []) {
    if (tagLevelOf(t) > maxLv) setTagLevel(project, t.id, maxLv);
  }
  return c;
}
// 加层（轨头「＋ 加层」入口；上限 MAX 由模型与 UI 双把守）：返回 { ok, count } / { ok:false, error }
export function addTagLayer(project) {
  const c = tagLevelCountOf(project);
  if (c >= TAG_LEVEL_COUNT_MAX) return { ok: false, error: `划分轨最多 ${TAG_LEVEL_COUNT_MAX} 层` };
  setTagLevelCount(project, c + 1);
  return { ok: true, count: c + 1 };
}
// 删层：仅空层可删（该层有 tag → 拒绝）；删除后更深层号依次上移（level-1，保持层序连续）。
// level 缺省=最底层（count-1）。返回 { ok, count } / { ok:false, error }。
export function removeTagLayer(project, level = null) {
  const c = tagLevelCountOf(project);
  if (c <= 1) return { ok: false, error: '仅剩一层划分轨，不可删除' };
  const k = Number.isInteger(level) ? level : c - 1;
  if (k < 0 || k >= c) return { ok: false, error: '层不存在' };
  const tags = project.timeline.tags || [];
  const n = tags.filter(t => tagLevelOf(t) === k).length;
  if (n) return { ok: false, error: `该层仍有 ${n} 个标记——先删除或移动到其他层` };
  for (const t of tags) {
    const lv = tagLevelOf(t);
    if (lv > k) setTagLevel(project, t.id, lv - 1);
  }
  setTagLevelCount(project, c - 1);
  resolveTagRegions(project.timeline.tags); // 层号上移可能造成同层挤叠——区域不变式重贴（build-49 F1）
  return { ok: true, count: c - 1 };
}

// ---------- 节奏划分轨（W1 §2.2.1）：段 = 相邻 tags 派生区间（stage 旧语义专用，build-49 归属注记） ----------
// 【归属】build-49-tagregion F1 起，「区域即段」——音乐模式一律直接读 tag 的 [beat,endBeat) 区域本身，
// 不再经过本函数邻接推导；本函数仅服务 stage（编舞）非严格旧语义路径：drawSegEmphasis 段界强调线、
// 编舞模式乐段索引面板。strict 选项同为 stage/兼容面保留（音乐模式已不调用）。
// 段派生（纯函数）：段 i = [tags[i].beat, tags[i+1].beat)，末段到曲终；
// 首个 tag 之前的区间不属任何段（呈示为未划分灰底）。零长段（重复拍位）跳过。
// endBeatOverride（M1 D4 可选参数）：末段终点拍位——音乐模式调用方传 secToBeat(musicDomainSec)
// 使划分域覆盖到音频末（队形域短于音频时后半也能划分）；缺省=末 clip.end（编舞调用方零变化）。
// level（build-47 分层，第三参缺省 0）：只取该层 tag 成段——同层相邻 tag 成段、各层独立派生；
// 缺省 0 = 全部既有调用方零改动（旧数据无 level 键=全 0 层）。
// opts.strict（build-48-tagui F3，第四参可选）：严格相邻同层 tag 之间成段——末 tag 不延域尾、
// 末 tag 之后与首 tag 之前同为无标注空白（不画段带、不进索引）。音乐模式调用方传 strict；
// 缺省 false = 旧「末段延域尾」语义逐值不变（stage 红线 E-12 隔离）。
// 返回值 additive 扩展：tags=该层排序后的 tag 列表（strict 下末 tag 不成段——呈示层据此补画孤儿旗）。
export function sectionSegmentsOf(project, endBeatOverride, level = 0, opts = null) {
  const lv = Number.isInteger(level) ? level : 0;
  const strict = !!(opts && opts.strict);
  const tags = [...(project.timeline.tags || [])]
    .filter(t => tagLevelOf(t) === lv)
    .sort((a, b) => a.beat - b.beat || String(a.id).localeCompare(String(b.id)));
  // build-70 换源：域尾缺省=末 clip.end（segmentsFromClips；旧 computeSegments 退役）
  const { totalBeats } = segmentsFromClips(project.formations);
  const endBeat = (Number.isFinite(endBeatOverride) && endBeatOverride > 0) ? endBeatOverride : totalBeats;
  const segs = [];
  for (let i = 0; i < tags.length; i++) {
    const start = tags[i].beat;
    // strict：末 tag 之后=空白（末 tag 不成段）；非 strict：末段延到域尾（现状）
    if (strict && i + 1 >= tags.length) break;
    const end = i + 1 < tags.length ? tags[i + 1].beat : Math.max(endBeat, start);
    if (end > start) segs.push({ i, tag: tags[i], start, end });
  }
  return { segs, totalBeats: endBeat, tags };
}
// 跨层段列表 → 索引面板分层归属（build-47 F3 纯函数）：按 start 升序扫描，
// 每段深度 = 「最近一个 start 落入其范围的低层段」层级+1（子段按 beat 落入父段范围即归属，
// 不强制完全包含）；无任何父段 → 顶层（depth 0）。返回 [{seg, depth}]（保持时间序）。
export function nestSegmentsByLevel(segs) {
  const sorted = [...(segs || [])].sort((a, b) =>
    a.start - b.start || tagLevelOf(a.tag) - tagLevelOf(b.tag) || String(a.tag?.id ?? '').localeCompare(String(b.tag?.id ?? '')));
  const last = new Map(); // level → 该层最近一段（时间序扫描的归属候选）
  const out = [];
  for (const s of sorted) {
    const lv = tagLevelOf(s.tag);
    let depth = 0;
    for (let k = lv - 1; k >= 0; k--) {
      const c = last.get(k);
      if (c && s.start >= c.start && s.start < c.end) { depth = k + 1; break; }
    }
    last.set(lv, { start: s.start, end: s.end });
    out.push({ seg: s, depth });
  }
  return out;
}
// 折叠集过滤（build-50 F2 纯函数）：rows=nestSegmentsByLevel 出参（[{seg,depth}] 时间序=先序），
// collapsed=折叠中的 tag id 集。语义：收起某行 → 其后所有 depth 更大的连续后代（递归：子的子
// 一并隐藏，后代自身是否也在折叠集不影响）全部 hidden，直到遇到 depth ≤ 收起行 depth 的下一行
// （兄弟/更高层，恢复可见）。缺省全展开（空集）；行自身永不 hidden（它是折叠/展开的钮面）。
// 返回 [{seg, depth, hidden}]（同序附加 hidden 标志，不改变入参）。
export function filterCollapsedRows(rows, collapsed) {
  const set = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
  const list = Array.isArray(rows) ? rows : [];
  let cover = Infinity; // 当前仍生效的收起祖先中最浅 depth（其所有 depth>cover 的后代隐藏）
  const out = [];
  for (const r of list) {
    const depth = r?.depth ?? 0;
    if (depth > cover) { out.push({ ...r, hidden: true }); continue; }
    // 可见行：若自身折叠则从此处开始遮蔽其子树，否则清空遮蔽
    cover = set.has(r?.seg?.tag?.id) ? depth : Infinity;
    out.push({ ...r, hidden: false });
  }
  return out;
}
// build-56-indextab 退役注记：索引面板拖宽/拖高钳制（build-50 F1）与浮动面板避让定位
// （build-51 F2 常量组+摆位纯函数）随浮动面板一并退役——索引进两模式侧栏 tab 后尺寸/摆位由
// 宿主容器 flex 决定，无自由几何可钳可摆（零残留由 tests/indextab.test.js 钉住）。
// fixed 下拉摆位（build-50 F3 纯函数，#export-dd 用；#music-toolbar 的 auto-seg 左对齐语义
// 不同不入此函数）：按钮 rect（{bottom,right}）+视口宽 → fixed 坐标。右对齐按钮
// （right=视口宽-按钮右缘，钳 ≥8px 留边）、top=按钮底+4px。
export function placeDropdownBelow(btn, vw) {
  const view = Number(vw) || 0;
  return { top: (Number(btn?.bottom) || 0) + 4, right: Math.max(8, view - (Number(btn?.right) || 0)) };
}

// ---------- build-51-stageux F4：时间轴底部导航滑块（视口概览条）几何（纯函数，node 可测） ----------
// 拇指宽=可视宽/内容宽×条宽（≥TLNAV_MIN_THUMB 下限）；位置=scrollLeft/溢出量线性映射。
// 内容不溢出（scrollW≤clientW）=拇指满宽禁用态（tlnav-off，不可拖不响应点条）。
export const TLNAV_MIN_THUMB = 24;
export function tlnavThumb({ clientW, scrollW, scrollLeft = 0, barW }) {
  const cw = Math.max(0, Number(clientW) || 0), sw = Math.max(0, Number(scrollW) || 0);
  const sl = Math.max(0, Number(scrollLeft) || 0), bw = Math.max(0, Number(barW) || 0);
  if (sw <= cw || bw <= 0) return { w: bw, x: 0, disabled: true };
  const w = Math.max(TLNAV_MIN_THUMB, Math.round(bw * cw / sw));
  const maxScroll = sw - cw;
  const x = Math.round((Math.min(sl, maxScroll) / maxScroll) * (bw - w));
  return { w, x, disabled: false };
}
// 拖拇指 → scrollLeft：拇指左缘在条内的比例 × 溢出量（拖中实时平移；越界钳 [0,maxScroll]）。
export function tlnavScrollForThumbPos({ thumbLeft, thumbW, barW, clientW, scrollW }) {
  const maxScroll = Math.max(0, (Number(scrollW) || 0) - (Number(clientW) || 0));
  const denom = Math.max(1, (Number(barW) || 0) - (Number(thumbW) || 0));
  const ratio = Math.max(0, Math.min(1, (Number(thumbLeft) || 0) / denom));
  return Math.round(ratio * maxScroll);
}
// 点条身空白 → 视口中心跳到该处：目标 scrollLeft = 当前 scrollLeft + 点击点 − 条宽/2（钳量程）。
//（等价于「点击处的内容点滚到视口中心」——不改滚动量纲，点击即达无比例换算漂移。）
export function tlnavScrollForBarClick({ clickX, barW, clientW, scrollW, scrollLeft }) {
  const maxScroll = Math.max(0, (Number(scrollW) || 0) - (Number(clientW) || 0));
  const target = (Number(scrollLeft) || 0) + (Number(clickX) || 0) - (Number(barW) || 0) / 2;
  return Math.max(0, Math.min(maxScroll, Math.round(target)));
}
const r2 = v => Math.round(v * 100) / 100;
// 来源①均分 N 段：按 totalBeats/N 生成 N 个段起点拍位（含 0）。N 钳制 1..64；totalBeats≤0 → []。
export function evenSectionBeats(totalBeats, n) {
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
export function barRuleSections(totalBeats, rules = [{ name: '主歌', beats: 16 }, { name: '副歌', beats: 8 }]) {
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
export function parseSectionTable(text) {
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
export function sectionTableToEntries(entries, totalBeats) {
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
// build-49 F1：落标即区域——无缝衔接（endBeat=下一个 entry.beat，末尾 +16）；build-48 起入口暂隐，
// 模型保留（可回）。
export function applySectionEntries(project, entries) {
  const list = (entries || []).map((e, k) => ({
    id: uid('tag'),
    beat: Math.max(0, r2(Number(e.beat) || 0)),
    name: cleanTagName(e.name) || `段落 ${k + 1}`,
    ...(Number.isInteger(e.color) && e.color >= 0 && e.color < SEG_COLOR_COUNT ? { color: e.color } : {}),
  }));
  for (let i = 0; i < list.length; i++) {
    list[i].endBeat = i + 1 < list.length ? list[i + 1].beat : r2(list[i].beat + TAG_REGION_DEFAULT_BEATS);
  }
  project.timeline.tags = list;
}
// 段级操作（右键/索引「…」菜单共用；对 tags 的原子改写，历史条数由调用方 mutateLabeled 保证恰一）：
// 删除标记 = 移除该区域（该层该处回到空白；相邻区域不自动延展——区域模型下空白天然合法）
export function removeSection(project, tagId) { removeTag(project, tagId); }
// 换色（0..3 越界钳制；非法输入不动）
export function setSectionColor(project, tagId, color) {
  const t = tagById(project, tagId);
  if (!t || !Number.isInteger(color) || color < 0 || color >= SEG_COLOR_COUNT) return;
  t.color = color;
}

// ---------- 位置插值 ----------
export function lerpAngle(a, b, t) {
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
// build-70 M3 播放插值（segmentsFromClips 同链）：clip 内=保持位形；clip 间空隙=变换段
//（prev→next easeInOut 插值，时长=空隙本身——自动适应 clip 操作产生的空白，空隙 0=瞬时切换）；
// [0, 首 clip.start)=保持首队形（候场）；beat ≥ 末 clip.end=保持末队形。
export function posAt(project, beat) {
  const formations = project.formations;
  if (!formations.length) return { positions: {}, seg: null, phase: 'hold', t: 0 };
  const b = Number(beat) || 0;
  const mkSeg = f => ({ i: formations.indexOf(f), formationId: f.id, start: clipStartOf(f), end: clipEndOf(f) });
  if (b < clipStartOf(formations[0])) {
    return { positions: formations[0].positions, seg: mkSeg(formations[0]), phase: 'hold', t: 0 };
  }
  for (let i = 0; i < formations.length; i++) {
    const f = formations[i];
    const s = clipStartOf(f), e = clipEndOf(f);
    if (b < e) return { positions: f.positions, seg: mkSeg(f), phase: 'hold', t: 0 };
    const next = formations[i + 1];
    if (next && b < clipStartOf(next)) {
      // 变换段（空隙）：prev→next 插值；空隙 0 时此分支不可达（b<e 与 b<next.start 不相交）
      const t = easeInOut((b - e) / Math.max(1e-6, clipStartOf(next) - e));
      return { positions: lerpFormations(f.positions, next.positions, t), seg: mkSeg(f), phase: 'travel', t };
    }
  }
  const lastF = formations[formations.length - 1];
  return { positions: lastF.positions, seg: mkSeg(lastF), phase: 'hold', t: 1 };
}
// 播放头所属队形下标：clip 内=该队形；变换段（空隙）=前队形（旧 travel 段 seg.i 语义延续）；
// 候场（首 clip 前）=0；越末 clip.end=末队形（build-51 越界防护语义在 segmentsFromClips 下自动成立）。
export function currentFormationIndexAt(project, beat) {
  const formations = project.formations;
  if (!formations.length) return 0;
  const b = Number(beat) || 0;
  if (b < clipStartOf(formations[0])) return 0;
  for (let i = 0; i < formations.length; i++) {
    const f = formations[i];
    if (b < clipEndOf(f)) return i;
    const next = formations[i + 1];
    if (next && b < clipStartOf(next)) return i; // 变换段：前队形
  }
  return formations.length - 1;
}

// ---------- clip 操作（build-70 M2：移动/缩放/空隙/分割；全链钳制，node 可测） ----------
// 时间邻界（交叉禁止不变式把守）：lo=左邻 clip.end（无左邻=0）、hi=右邻 clip.start（无右邻=∞）。
// 全部按 formations 数组序解析（数组序=时间序不变式）；写入值 rBeat 两位小数舍入。
function clipBoundsOf(formations, index) {
  const { segments } = segmentsFromClips(formations);
  const k = segments.findIndex(s => s.i === index);
  if (k < 0) return null;
  return {
    lo: k > 0 ? segments[k - 1].end : 0,
    hi: k + 1 < segments.length ? segments[k + 1].start : Infinity,
  };
}
// 整段平移（拖 clip 体）：newStart 钳 [lo, hi−len]（不越左右邻）；越界/非法入参钳界内落地。
export function moveFormationClip(project, index, newStart) {
  const f = project?.formations?.[index];
  if (!f) return false;
  const b = clipBoundsOf(project.formations, index);
  if (!b) return false;
  const s = Number(newStart);
  if (!Number.isFinite(s)) return false;
  const len = clipLenOf(f);
  const maxS = Number.isFinite(b.hi) ? b.hi - len : Infinity;
  f.startBeat = rBeat(Math.max(0, Math.min(Math.max(s, b.lo), maxS >= b.lo ? maxS : b.lo)));
  return true;
}
// 缘缩放（拖左右缘）：'L'=start 与 len 联动（start ∈ [lo, end−MIN]）；'R'=len（end ∈ [start+MIN, hi]）。
export function resizeFormationClip(project, index, side, value) {
  const f = project?.formations?.[index];
  if (!f) return false;
  const b = clipBoundsOf(project.formations, index);
  if (!b) return false;
  const v = Number(value);
  if (!Number.isFinite(v)) return false;
  const s = clipStartOf(f), e = clipEndOf(f);
  if (side === 'L') {
    const ns = Math.min(Math.max(v, b.lo), e - FORM_CLIP_LEN_MIN);
    if (!(ns >= b.lo)) return false; // 空间不足（退化）不动
    f.startBeat = rBeat(Math.max(0, ns));
    f.lenBeats = rBeat(e - f.startBeat);
  } else {
    const ne = Math.min(Math.max(v, s + FORM_CLIP_LEN_MIN), b.hi);
    if (!(ne >= s + FORM_CLIP_LEN_MIN)) return false;
    f.lenBeats = rBeat(ne - s);
  }
  return true;
}
// 选中 clip 长度直写（保持±1 拍/面板输数；右缘动）：钳 [MIN, hi−start]。
export function setFormationClipLen(project, index, len) {
  const f = project?.formations?.[index];
  if (!f) return false;
  const b = clipBoundsOf(project.formations, index);
  if (!b) return false;
  const v = Number(len);
  if (!Number.isFinite(v)) return false;
  const maxLen = Number.isFinite(b.hi) ? b.hi - clipStartOf(f) : Infinity;
  f.lenBeats = rBeat(Math.max(FORM_CLIP_LEN_MIN, Math.min(v, maxLen)));
  return true;
}
// 过渡（空隙）调整：下一 clip 的 start=本 clip.end+gap。ripple=false（UI 口径）只动下一 clip、
// 钳不越下下个（next.start ≤ 下下个.start−next.len）；ripple=true（技能 apply 级联口径）后续整列
// 同步平移（相对空隙/长度不变——旧 blocks ripple 语义对应）。gap 钳 ≥0（重叠=交叉禁止）。
export function setFormationGap(project, index, gap, { ripple = false } = {}) {
  const formations = project?.formations || [];
  const f = formations[index];
  const next = formations[index + 1];
  if (!f || !next) return false;
  const g = Number(gap);
  if (!Number.isFinite(g) || g < 0) return false;
  const curEnd = clipEndOf(f);
  let ns = rBeat(curEnd + g);
  if (!ripple) {
    const nextNext = formations[index + 2];
    const hi = nextNext ? clipStartOf(nextNext) - clipLenOf(next) : Infinity;
    ns = Math.min(ns, Math.max(curEnd, hi)); // 无空间时退化为贴合（gap=0）
  }
  const delta = rBeat(ns - clipStartOf(next));
  if (!delta) return false;
  if (ripple) {
    for (let k = index + 1; k < formations.length; k++) {
      formations[k].startBeat = rBeat(Math.max(0, clipStartOf(formations[k]) + delta));
    }
  } else {
    next.startBeat = ns;
  }
  return true;
}
// 分割队形 clip（需求 2）：beat 落在 clip 内部且两端各留 ≥1 拍 → 深拷贝队形内容为两个 clip
//（前段 [start, beat]、后段 [beat, end]）——两 clip 位形完全相同（缩略图同位形 ✓）。
// 就地改写前段（len 缩短）、新队形插入后一位（数组序=时间序成立）。beat 非法/空间不足 → null。
export function splitFormationClip(project, index, beat) {
  const formations = project?.formations || [];
  const f = formations[index];
  if (!f) return null;
  const s = clipStartOf(f), e = clipEndOf(f);
  const b = Number(beat);
  if (!Number.isFinite(b) || !(b >= s + FORM_CLIP_LEN_MIN && b <= e - FORM_CLIP_LEN_MIN)) return null;
  const cut = rBeat(b);
  const back = clone(f);
  back.id = uid('f');
  back.startBeat = cut;
  back.lenBeats = rBeat(e - cut);
  f.lenBeats = rBeat(cut - s);
  formations.splice(index + 1, 0, back);
  return back;
}

// ---------- 小节/8拍显示 ----------
export function beatLabel(project, beat) {
  const bpb = project.audio.beatsPerBar || 4;
  const b = Math.max(0, beat);
  const bar = Math.floor(b / bpb) + 1, bt = Math.floor(b % bpb) + 1;
  return `${bar}.${bt}`;
}
export function countLabel(beat) { return `${Math.floor(Math.max(0, beat) / 8) + 1}`; } // 第 n 个 8 拍

// ---------- 时间轴对齐 ----------
// build-70 M2：「对齐到播放头」=选中 clip 的 start 对齐目标拍（moveFormationClip 邻界钳制——
// 旧 alignBlockStart「压上一块 hold/改过渡」机制随 blocks 模型退役；对齐=整段平移到界内最近位）。
// 返回对齐后的实际 start（供 UI toast 汇报钳制结果）。
export function alignFormationClipStart(project, index, targetBeat) {
  const f = project?.formations?.[index];
  if (!f) return null;
  if (!moveFormationClip(project, index, targetBeat)) return null;
  return clipStartOf(f);
}

// ---------- 媒体资产与音频 clip（v3 音乐剪辑 · 规格 docs/music-clip-ui-spec.md） ----------
// project.media = { assets: [{id,name,durationSec,size}], activeAssetId }
// project.timeline.tracks = [{id,name,gain,muted}]（多轨模型 · 见下方「多轨」节）
// project.timeline.audioClips = [{id,assetId,trackId?,timelineStartSec,srcStartSec,lengthSec,fadeInSec,fadeOutSec,fadeInCurve?,fadeOutCurve?,gain,name,muted?,color?,fadeInAuto?,fadeOutAuto?,autoPair?,autoPairIn?,autoPairOut?,rate?,speed?,pitchSemi?}]
// rate（滑动变速 varispeed · 0.25–4 磁带式）：slot 内消耗的源内容量按 rate 加速（源读取位 =
// srcStartSec + 时间轴相对时刻 × rate，音高随速度变化）；时间轴 slot 域（timelineStartSec/
// lengthSec/淡化）完全不受影响。缺省=1（键可省，读侧 clip.rate || 1）。
// speed（离线变速·保音高 TSM · 0.25–4 两位小数）+ pitchSemi（离线变调·半音整数 ±12）：二者经
// js/clip-process.js 的 SignalsmithStretch 管线离线渲染 processed buffer（音高不随 speed 变），
// 与 rate（磁带式·音高随速度）正交可叠加。缺省=1/0（键可省，读侧 clip.speed || 1、
// clip.pitchSemi || 0，js/clip-process.js 的 needsProcess 判定是否走处理管线）。
// clip=可自由摆放的独立对象：间隙=静音，重叠=自动等功率交叉淡化（fades 记录在 clip 上）。
// 淡化曲线（build-45）：fadeInCurve/fadeOutCurve ∈ [-1,1]，缺省 0=等功率 sin（旧数据无字段
// → 清洗不补写，读侧 fadePow(Number(undefined)||0)=1，零迁移成本；清洗只在非 0 时落盘）。
export const MIN_CLIP_DUR = 0.005;
const r6c = v => Math.round(v * 1e6) / 1e6;
// 淡化曲线清洗/钳制（build-45，导出供时间线拖拽与引擎 setSeamCurves 共用）：非有限数值 = 0
//（等功率缺省，旧数据零迁移）；[-1,1] 外收界；r6 舍入与时长字段同规矩。
// 0 值在 sanitizeAudioClips 落盘时省略（见其内注释）。
export function clampCurve(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return r6c(Math.max(-1, Math.min(1, n)));
}
// 媒体资产清洗：非合法项丢弃；id 补 uid、去重；name 非空 ≤120 字；时长/大小钳制；dataBase64 剥离（导入入口已还原 Blob）
export function sanitizeMedia(raw) {
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
// 淡化 ≥0 且总量 ≤ length 按比例收缩、gain 0..4、rate/speed 钳 [0.25,4] 两位小数且非 ≈1 不落键、
// pitchSemi 整数钳 [-12,12] 且非 0 不落键）、
// id 补 uid/去重；数组顺序即 z 序（保持不排序）。
// autoPair 双缘升级（R47）：autoPairOut/autoPairIn 各记一条交叉淡化缘（out=对后端 clip 淡出、
// in=对前端 clip 淡入）；旧单字段 autoPair 迁移为双缘等价——只有单侧 auto 缘时按缘归属精确迁移，
// 双侧 auto 缘并存（链式中段，旧单字段只保留了最后写入的 out 侧）按「末次写入=out 侧」启发式迁移，
// in 侧陈旧记录留待 prune 的幽灵清理收口。autoPair 单字段保留为兼容镜像（旧版应用读新文件用）。
// opts.trackIds（Set）+ opts.defaultTrackId：多轨清洗——clip.trackId 非悬挂则保留，悬挂/缺失
// 回落 defaultTrackId；opts 缺省时保留既有 trackId 字符串（纯清洗入口不强行补轨语义）。
export function sanitizeAudioClips(raw, assets, opts = {}) {
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
    // 淡化曲线（build-45）：[-1,1] 外收界；非法/缺失 = 0（等功率）；r6 与时长字段同规矩。
    // 非 0 才落盘（缺省形态与旧项目 JSON 逐字节一致，deepEqual 往返不新增键）。
    const fic = clampCurve(c.fadeInCurve);
    const foc = clampCurve(c.fadeOutCurve);
    const gain = Number(c.gain);
    // rate（滑动变速）：有限数值 → 钳 [0.25,4] → 两位小数（1% 粒度）；|v−1|<0.005（含 1 本身）
    // 或非法/缺省不落键——缺省=1.00，JSON 往返零漂移，与 gain/fade 同纪律；旧 clip 无键按 1
    // 处理（读侧消费方一律 clip.rate || 1），不补键。时间轴 slot 域字段不受 rate 影响。
    const rateNum = Number(c.rate);
    const rateC = Number.isFinite(rateNum)
      ? Math.round(Math.max(0.25, Math.min(4, rateNum)) * 100) / 100
      : 1;
    const rateOk = Number.isFinite(rateNum) && Math.abs(rateC - 1) >= 0.005;
    // speed（离线变速·保音高 TSM）：与 rate 同纪律——有限数值 → 钳 [0.25,4] → 两位小数；
    // |v−1|<0.005（含 1 本身）或非法/缺省不落键——缺省=1.00，JSON 往返零漂移；读侧一律
    // clip.speed || 1（js/clip-process.js needsProcess 判定）。时间轴 slot 域字段不受影响。
    const speedNum = Number(c.speed);
    const speedC = Number.isFinite(speedNum)
      ? Math.round(Math.max(0.25, Math.min(4, speedNum)) * 100) / 100
      : 1;
    const speedOk = Number.isFinite(speedNum) && Math.abs(speedC - 1) >= 0.005;
    // pitchSemi（离线变调·半音）：整数（数值且整值；数值字符串经 Number 合法化）→ 钳 [-12,12]；
    // 0 或非法（非整值如 2.5/非数值）不落键——缺省=0，JSON 往返零漂移；读侧 clip.pitchSemi || 0。
    const semiNum = Number(c.pitchSemi);
    const semiC = (Number.isFinite(semiNum) && Number.isInteger(semiNum))
      ? Math.max(-12, Math.min(12, semiNum))
      : 0;
    const semiOk = Number.isFinite(semiNum) && Number.isInteger(semiNum) && semiC !== 0;
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
      ...(rateOk ? { rate: rateC } : {}),
      ...(speedOk ? { speed: speedC } : {}),
      ...(semiOk ? { pitchSemi: semiC } : {}),
      name: String(c.name ?? '').slice(0, 80),
      ...(c.muted ? { muted: true } : {}),
      ...(typeof c.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.color) ? { color: c.color } : {}),
      ...(c.fadeInAuto ? { fadeInAuto: true } : {}),
      ...(c.fadeOutAuto ? { fadeOutAuto: true } : {}),
      ...(fic ? { fadeInCurve: fic } : {}),
      ...(foc ? { fadeOutCurve: foc } : {}),
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
export function migrateLegacyAudio(p) {
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
export function activeAssetOf(project) {
  const m = project?.media;
  if (!m || !m.assets?.length) return null;
  return m.assets.find(a => a.id === m.activeAssetId) || m.assets[0] || null;
}
export function clipsOf(project) { return project?.timeline?.audioClips || []; }
// clip 查找/终止点辅助（UI 层共用）
export function clipById(project, id) { return clipsOf(project).find(c => c.id === id) || null; }

// ---------- 多轨（多轨模型 · 本期 2 轨起步） ----------
// project.timeline.tracks = [{id, name, gain, muted}]。轨是 clip 的容器与混音单元：
//   gain 0..2 线性（与 ClipTransport.setTrackGain 同域，UI 滑杆 0..1.5）、muted 整轨静音。
// 上限 4 轨（TRACK_MAX）由 UI 层把守（addTrack 不设限）；模型层只保证数据合法与引用不悬挂。
// 单轨项目零体验变化：默认恒有 trk1「配乐」，旧项目载入时缺省补建、clip.trackId 缺省迁移到 trk1。
export const TRACK_MAX = 4;
export const TRACK_NAME_MAX = 24;
export const DEFAULT_TRACK_ID = 'trk1';
export const defaultTrack = () => ({ id: DEFAULT_TRACK_ID, name: '配乐', gain: 1, muted: false });
// 轨清洗：非合法项丢弃；id 缺失补 uid/去重（重复保首个弃后续）；name 非空 ≤24 字；
// gain 0..2 钳制；muted 布尔归一。返回新数组，不改输入。
// laneH（Wave1 并行：timeline.js 划分轨行高驻数据 track.laneH）：有限数值钳 [24,240] 保留；
// 非法/缺省不落键（JSON 往返不新增键）。
export function sanitizeTracks(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    if (!t || typeof t !== 'object') continue;
    const id = (typeof t.id === 'string' && t.id) ? t.id : uid('trk');
    if (seen.has(id)) continue;
    seen.add(id);
    const gain = Number(t.gain);
    const laneH = Number(t.laneH);
    out.push({
      id,
      name: String(t.name ?? '').trim().slice(0, TRACK_NAME_MAX) || `轨 ${out.length + 1}`,
      gain: Number.isFinite(gain) ? Math.max(0, Math.min(2, gain)) : 1,
      muted: !!t.muted,
      ...(Number.isFinite(laneH) ? { laneH: Math.max(24, Math.min(240, laneH)) } : {}),
    });
  }
  return out;
}
export function trackById(project, id) { return (project?.timeline?.tracks || []).find(t => t.id === id) || null; }
// clip 归属轨（引擎/UI 共用）：trackId 悬挂/缺失回落默认轨→首轨（与 validate 清洗同口径）
export function trackOfClip(project, clip) {
  const tracks = project?.timeline?.tracks || [];
  if (!tracks.length) return null;
  const id = clip?.trackId;
  return (id && tracks.find(t => t.id === id)) || tracks.find(t => t.id === DEFAULT_TRACK_ID) || tracks[0];
}
// 新增轨：命名缺省「轨 N」（N 取未被占用最小号）。上限 TRACK_MAX 由 UI 把守，模型层不设限。
export function addTrack(project, { name = '' } = {}) {
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
export function removeTrack(project, trackId) {
  const tracks = project.timeline.tracks || [];
  const i = tracks.findIndex(t => t.id === trackId);
  if (i < 0) return { ok: false, error: '轨不存在' };
  const referenced = clipsOf(project).some(c => (c.trackId || DEFAULT_TRACK_ID) === trackId);
  if (referenced) return { ok: false, error: '轨上仍有音频块，不能删除（请先移动或删除音频块）' };
  const [rm] = tracks.splice(i, 1);
  return { ok: true, removed: rm };
}
export function renameTrack(project, trackId, name) {
  const t = trackById(project, trackId);
  const n = String(name ?? '').trim().slice(0, TRACK_NAME_MAX);
  if (!t || !n) return null;
  t.name = n;
  return t;
}
// 轨增益/静音：模型态写入（0..2 线性）；引擎实时生效由 UI 同步给 ClipTransport
// （syncTracks / setTrackGainById / setTrackMutedById，setTargetAtTime 平滑）。
export function setTrackGain(project, trackId, gain) {
  const t = trackById(project, trackId);
  if (!t) return null;
  const g = Number(gain);
  t.gain = Number.isFinite(g) ? Math.max(0, Math.min(2, g)) : t.gain;
  return t;
}
export function setTrackMuted(project, trackId, muted) {
  const t = trackById(project, trackId);
  if (!t) return null;
  t.muted = !!muted;
  return t;
}
// clip 换轨：clip 与目标轨都必须存在；成功返回 { ok:true, clip }，否则 { ok:false, error }。
export function moveClipToTrack(project, clipId, trackId) {
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
export function stripTracksForV1(project) {
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
export function validateProject(json) {
  const errors = [];
  if (!json || typeof json !== 'object') return { ok: false, errors: ['不是合法的项目对象'] };
  if (json.version !== 1 && json.version !== 2) errors.push(`未知版本 ${json.version}`);
  delete (json.audio || {}).dataBase64; // 内嵌音乐在导入入口处还原为 Blob，不进项目记录
  delete (json.audio || {}).dataFormat;
  const p = json;
  p.meta = (p.meta && typeof p.meta === 'object') ? p.meta : { title: '导入项目' };
  p.meta.title = String(p.meta.title ?? '未命名').slice(0, 120);
  p.stage = { widthM: 12, depthM: 16, audience: 'bottom', gridM: 0.5, snap: true, backstageM: 1, wingM: 2, bgImage: null, ...p.stage };
  p.stage.widthM = num(p.stage.widthM, 12, 4, 60);
  p.stage.depthM = num(p.stage.depthM, 16, 4, 60);
  // build-77-expux（W2 接线清单 #6）：gridM 下界 0.1→0.05——0.05m 档（GRID_PRESETS/细粒度
  // 次级网格线/细吸附）合法入库；main.js STAGE_RANGE 与 props 输入框 min/step 同步放宽
  p.stage.gridM = num(p.stage.gridM, 0.5, 0.05, 2);
  // build-63-stageview2 F1：缺省 2→1（瘦身）；显式数值原样保留（既有项目零迁移）
  p.stage.backstageM = num(p.stage.backstageM, 1, 0, 10);
  p.stage.wingM = num(p.stage.wingM, 2, 0, 5); // build-62 F3 + build-64：侧翼扩容（两侧后台更大空间）
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
  // build-70-formationclips M1 迁移：timeline.blocks 一次性退役——旧顺序块 [{formationId,
  // holdBeats, travelBeats}] → 队形 clip 字段：formation i 的 startBeat=旧块 i 的 holdStart
  //（Σ_{j<i}(hold_j+travel_j) 累计）、lenBeats=旧块 i 的 holdBeats（≥1 钳制）。travelBeats 不迁移：
  // 新模型变换=相邻 clip 间空隙，旧过渡时长自然成为空隙（无损 ✓）。迁移后 blocks 字段删除。
  p.timeline = { metronome: false, playSpeed: 1, tags: [], audioClips: [], ...p.timeline };
  delete p.timeline.countInBeats; // build-68-nocountin：退役字段容忍剥离（旧 JSON 载入不报错、不保留）
  const legacyBlocks = Array.isArray(p.timeline.blocks) ? p.timeline.blocks : null;
  delete p.timeline.blocks; // blocks 字段不保留（重构一次到位：不存新旧并存的中间态）
  p.timeline.tags = sanitizeTags(p.timeline.tags); // 时间轴标记清洗（旧项目无 tags → []，零迁移成本）
  // 显式层数清洗（build-48-tagui F4）：1..3 钳制、缺省 1 不落键（JSON 往返不新增键）；
  // level ≥ tagLevelCount 的越层数据（旧项目降级/导入）钳到 count-1——段不丢失、收拢到最底层
  const tlc = clampTagLevelCount(p.timeline.tagLevelCount);
  if (tlc > 1) p.timeline.tagLevelCount = tlc; else delete p.timeline.tagLevelCount;
  for (const t of p.timeline.tags) {
    if (tagLevelOf(t) > tlc - 1) setTagLevel(p, t.id, tlc - 1);
  }
  // 层钳降后区域不变式重贴（build-49 F1）：同层不交叠、endBeat > beat——越层数据收拢后仍合法
  p.timeline.tags = resolveTagRegions(p.timeline.tags);
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
  // build-74-labelname：舞者级显示覆盖清洗——非法值 delete（键不落盘，JSON 往返不新增键）
  for (const d of p.dancers) {
    if (!d.id || ids.has(d.id)) d.id = uid('d'); ids.add(d.id);
    d.role = ['M', 'F', 'X'].includes(d.role) ? d.role : 'X';
    if (!LABEL_MODES.includes(d.labelMode)) delete d.labelMode;
  }
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
  // build-70 M1：clip 字段清洗与不变式收口（替代旧 syncTimeline）——
  // ①旧 blocks 迁移（有则）：formation i ← 旧块 i（startBeat=累计 holdStart、lenBeats=holdBeats）；
  // ②缺字段补缺（无 blocks 或部分缺）：依序追加到已定义 clip 的末尾之后（len 缺省 16）；
  // ③域钳制：startBeat ≥ 0、lenBeats ≥ 1；
  // ④稳定排序恢复「数组序=时间序」不变式 + 交叉禁止（越界钳到右邻 start；≥1 拍下限兜底）。
  if (legacyBlocks) {
    let b = 0;
    for (let i = 0; i < p.formations.length; i++) {
      const blk = legacyBlocks[i];
      if (!blk || typeof blk !== 'object') continue;
      const hold = Number(blk.holdBeats);
      const travel = Number(blk.travelBeats);
      const f = p.formations[i];
      f.startBeat = rBeat(Math.max(0, b));
      f.lenBeats = rBeat(Math.max(FORM_CLIP_LEN_MIN, Number.isFinite(hold) ? hold : FORM_CLIP_LEN_DEFAULT));
      b = clipEndOf(f) + (Number.isFinite(travel) && travel > 0 ? travel : 0);
    }
  }
  {
    const defined = p.formations.filter(f => Number.isFinite(Number(f.startBeat)) && Number.isFinite(Number(f.lenBeats)));
    let cursor = defined.length ? Math.max(...defined.map(clipEndOf)) : 0;
    for (const f of p.formations) {
      if (!(Number.isFinite(Number(f.startBeat)) && Number.isFinite(Number(f.lenBeats)))) {
        f.startBeat = rBeat(cursor);
        f.lenBeats = FORM_CLIP_LEN_DEFAULT;
      }
      cursor = Math.max(cursor, clipEndOf(f));
    }
  }
  for (const f of p.formations) {
    f.startBeat = clipStartOf(f);
    f.lenBeats = clipLenOf(f);
  }
  {
    const order = p.formations.map((f, i) => ({ f, i }))
      .sort((a, b2) => (clipStartOf(a.f) - clipStartOf(b2.f)) || (a.i - b2.i));
    p.formations = order.map(o => o.f);
    for (let k = 0; k + 1 < p.formations.length; k++) {
      const cur = p.formations[k], nxt = p.formations[k + 1];
      if (clipEndOf(cur) > clipStartOf(nxt)) {
        cur.lenBeats = rBeat(Math.max(FORM_CLIP_LEN_MIN, clipStartOf(nxt) - clipStartOf(cur)));
      }
    }
  }
  return { ok: errors.length === 0, errors, project: p };
}
