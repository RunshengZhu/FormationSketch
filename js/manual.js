// 说明书模块：「开场 + 五幕 + 附录」阅读页（build-59-manual4）。
// 沿革：五幕 user story（build-57）→ 正文瘦身 + 板块卡片迁「附录 A · 功能模块详解」
//   （build-59-manual4：js/manual-boards.js 唯一数据源，正文回基线 13656B×1.2 预算内）。
// build-73-syncui：正文同步 build-72（同步后面/移出队形≠删名册/观众上/下候场区/4:3 缺省/
//   检查更新/三区拖宽高）；截图 manual-shots-v5.mjs 重拍（标注自适应，镜头清单沿用 v4）。
// 渲染顺序：开场 → 五幕（纯 story）→ 附录 A（功能详解）→ 附录 B（手势快捷键）→ 数据与限制。
// 复用：顶栏/首页「说明书」钮 → 全屏覆盖层（#manual-overlay）调 renderManual()。
// Node 单测直接 import manualOutline()/manualBoardGroups()/manualImageKeys()（纯数据、无 DOM 依赖）。
import { h, iconHtml } from './ui.js';
import { MANUAL_IMAGES, MANUAL_META } from './manual-assets.js';
import { BOARD_GROUPS } from './manual-boards.js';

// 正文内联图标：入口引用一律「SVG 图标 + 文字」，不嵌 emoji 字符（icons.test.js A 组零回流钉住）。
const ic = (name, size = 16) => iconHtml(name, size);

// ---------- 开场（一分钟看懂） ----------
const INTRO = {
  flow: [
    `① 音乐导入 —— ${ic('music')} 「＋ 载入音乐」或媒体库导入演出曲`,
    '② 音乐编辑 —— 裁剪、拼接多段，衔接处交叉淡化',
    `③ 节奏划分 —— ${ic('flag')} 打点标段落与节奏（主歌/副歌/拍值）`,
    `④ 队形编排 —— 排队形并对齐音乐，最后${ic('book')} 导出分发`,
  ],
  fig: {
    key: 'overview',
    annots: ['① 左栏 · 队形列表', '② 舞台画布', '③ 右面板 / 音乐侧栏', '④ 底部时间轴 + 导航滑块'],
  },
};

// ---------- 五幕（每幕 = 一条 user story） ----------
// figs[].annots 与截图红框标注一一对应（镜头脚本 manual-shots-v3.mjs 同源同文案）。
const ACTS = [
  {
    id: 'import', no: 1, title: '音乐导入',
    story: '作为编舞者，我要把演出音乐载入项目，以便按音乐排队形。',
    steps: [
      '顶栏切「音乐」模式（或按 M）→ 工具条「＋ 载入音乐」选本地文件。',
      '支持 mp3 / wav / m4a / aac / flac / ogg；载入即出波形并生成全长剪辑。',
      '多首音乐走「媒体库」侧栏：＋ 导入音频、改名、拖到音轨落点生成剪辑。',
      '「配乐」chip 标记当前播放用的资产；删除配乐会连同其剪辑一并移除。',
      '音乐存在哪：只存本机浏览器，不跨设备——换设备需重载，或用「含音乐导出」带走。',
    ],
    figs: [
      { key: 'music-import', annots: ['＋ 载入音乐', '媒体库页签', '资产行（拖入音轨）'] },
    ],
    more: '延伸：离线单文件版重开浏览器后音乐需重选一次；重要节点建议导出含乐项目备份。本幕板块逐步详解见附录 A。',
  },
  {
    id: 'music-edit', no: 2, title: '音乐编辑',
    story: '作为编舞者，我要裁剪、拼接多段音乐，以便衔接处平滑过渡。',
    steps: [
      'clip 区域块 = 一段剪辑：拖体移动，拖两缘修剪（Shift = 只移一边界）。',
      '衔接：同轨两 clip 交叠自动配对交叉淡化，拖淡化把手调过渡时长；拖增益线调音量。',
      `剃刀（${ic('razor')}）以播放线剪切选中的 clip；磁吸（S）吸附 clip 缘 / 播放头 / 零交叉。`,
      '底部导航滑块拖动平移长曲；＋ / － 缩放、⤢ 整曲入画。',
      '多轨铺排：轨头「＋ 加轨」；同一资产可拆多段跨轨使用，音量静音在轨头调。',
    ],
    figs: [
      { key: 'music-edit', annots: ['clip 区域块', '工具条（磁吸/剃刀）', '导航滑块'] },
      { key: 'music-clip-detail', annots: ['修剪缘', '淡化把手', '增益线', '波形'] },
    ],
    more: '延伸：双击 clip 循环预览；右键 clip 出菜单（分割 / 删除 / Alt+Delete 波纹删除）。本幕板块逐步详解见附录 A。',
  },
  {
    id: 'rhythm', no: 3, title: '节奏划分',
    story: '作为编舞者，我要标记音乐段落与节奏，以便队形切换踩在音乐结构上。',
    steps: [
      `${ic('flag')} 「打点」在播放头落一个节奏区域；划分轨双击空白也可新建。`,
      '区域块拖移、拖缘调界；同层不交叠（自动贴齐相邻区域）。',
      '分层：轨头「＋ 加层」最多 3 层——L1 标大结构（主歌/副歌），L2 标细分乐句。',
      '双击区域开编辑器：名称、拍值（3/4）、小节数（2小节）随手标注。',
      '「索引」面板（侧栏页签 / ⌘⇧L）：按名称列段、显示节奏与秒区间，点行跳播放头。',
      `编舞模式底部摘要条显示 tag；舞台 tag 道呈示最深层区域（${ic('flag')} 旗点可跳转）。`,
    ],
    figs: [
      { key: 'rhythm-lane', annots: ['L1 结构层', 'L2 乐句层', '节奏标注', '区域接缝'] },
      { key: 'index-music', annots: ['名称优先', '节奏 · 秒区间', '… 菜单', '▸ 层级折叠'] },
    ],
    more: '延伸：自动划分（均分 N 段 / 按小节规则 / 导入段落表）入口在音乐工具条，整表替换可撤销。本幕板块逐步详解见附录 A。',
  },
  {
    id: 'choreo', no: 4, title: '队形编排',
    story: '作为编舞者，我要编排队形并对齐到音乐段落，以便整支舞段段踩着音乐走。',
    steps: [
      '切回「编舞」模式：左栏队形列表逐段排队形，「＋ 新队形」复制当前帧。',
      `舞台排点：拖动 / 框选 / 生成器 / ${ic('flip-h')} 镜像 / 旋转 / 均布 / 换位 / 朝向；「观众在下/在上」一键换视角，舞者可拖到候场区待场。`,
      '长按 / 右键舞者菜单：「移出队形」只清当前帧（名册保留）；「同步后面/前面位置」把当前摆位带到前方/后方的队形（可限 N）。',
      '底部块时长条：「保持 −/＋」「过渡 −/＋」调每段时长（±0.1 秒步进）；左/右栏与底区边缘可拖宽高。',
      `「${ic('align-left')} 对齐到播放头」：把当前队形起点钉到音乐该段落起点（自动改前段过渡）。`,
      '「显示…」下拉：幽灵（前后虚影）/ 路径 / 切帧预览按需开关。空格播放全检，直达曲尾逐段核对。',
    ],
    figs: [
      { key: 'formation-stage', annots: ['队形列表', '排点工具', '块时长条', '属性细条'] },
      { key: 'align', annots: ['对齐到播放头', '保持 / 过渡'] },
    ],
    more: '延伸：名册与编组、合并单元、AI 辅助编创（dancesport-choreo skill）见对应面板与文档。本幕板块逐步详解见附录 A。',
  },
  {
    id: 'export', no: 5, title: '导出',
    story: '作为编舞者，我要导出项目文件，以便备份、换设备或交给别人。',
    steps: [
      '「导出 ▾」→「导出项目文件（含音乐）」：编舞 + 音乐一个文件，迁移即走。',
      '「导出项目文件（不含音乐）」：轻量版；「导入项目文件…」自动进副本不覆盖本地，重载音乐即可。',
      '「当前队形 PNG / 打印 PDF（全部队形）」可出纸质走位图。',
      '应用更新：顶栏 / 项目库「检查更新」一键拉取最新版本；离线单文件版需重新下载。',
    ],
    figs: [
      { key: 'export', annots: ['含音乐 = 全量备份', '不含音乐 = 轻量'] },
    ],
    more: '延伸：无云同步——文件就是迁移介质；赛场前务必带一份含乐 JSON 离机备份。本幕板块逐步详解见附录 A。',
  },
];

// ---------- 附录：速查与限制（压缩版，只留表） ----------
// 手势速查（桌面 vs 触摸/笔，最终语义）：[意图, 桌面, 触摸/笔]
const GESTURE_ROWS = [
  ['选中 / 框选', '左键单击；空白拖动=框选', `点按；「${ic('menu')} 多选」开启后点按=追加；长按空白 0.5s=框选`],
  ['移动 / 合并', '按住拖动（网格吸附；拖到他人身上停 1.5s 弹合并浮窗）', '同左'],
  ['单元浮窗 / 菜单', '双击合并单元，或右键', '长按单元 / 舞者 0.5s'],
  ['平移 / 缩放', '中键或空格+拖动；滚轮（触控板捏合）', '空白拖动平移；双指捏合'],
  ['队形列表重排', '拖拽缩略图', '长按缩略图 0.3s 拿起拖'],
  ['时间轴', '点尺规=播放头；拖块边=调时长；Ctrl+滚轮=缩放', '同左'],
  ['音频 clip（音乐模式）', '拖体=移动；缘把手=修剪；双击=循环预览；右键=菜单', '同左（修剪缘命中放宽 14px）'],
];
// 键盘快捷键：[键, 作用]
const KEY_ROWS = [
  ['空格', `播放 / 暂停；${ic('play')} 起播`],
  ['E / D', `编辑锁开关（${ic('pencil')} 编辑）/ 新队形（复制当前）`],
  ['M', '编舞 ↔ 音乐模式互切（播放中禁止，暂停后可切）'],
  ['G / F', '网格吸附开关 / 面向观众（全体或所选）'],
  ['S / R', `磁吸开关 / 剃刀单发剪切（音乐模式）`],
  ['Ctrl/Cmd+K', '音乐模式：以播放线剪切选中的 clip'],
  ['Ctrl/Cmd+Shift+L', '乐段索引面板开/关'],
  ['Delete / 方向键', '移出所选（音乐模式选中 clip=删除剪辑）/ 微调 0.1m（clip=微移 10ms）'],
  ['Ctrl/Cmd+Z / +Shift+Z', '撤销 / 重做（最多 60 步）'],
  ['1..9（Cmd/Safari 例外）', '选中 / 存为编组 N——Safari 被浏览器保留，用右面板「编组」页按钮'],
];
// 数据与限制（诚实清单，压缩）
const LIMITS = [
  '数据存本浏览器：不跨设备、无云同步；换设备靠「含音乐导出」迁移。iOS Safari 数据 7 天不访问可能被清理——定期导出备份。',
  '离线单文件版配乐不持久：重开浏览器需重选一次；要音乐跟项目走，用含音乐导出。',
  '断网能力需 HTTPS 托管：HTTP 在线入口断网打不开，赛场请提前备下载版。',
  '切帧预览是纯界面动画（约 0.7s）：真正快慢由「过渡」时长（秒）决定。',
  '编组 ≠ 合并：编组是快速选择辅助；合并单元是帧级呈示/操作单元，可叠加使用。',
];

// ---------- 导出：内容骨架（node 可测） ----------
// build-59-manual4：outline 每幕不再含 boards（正文瘦身）；板块数据经 manualBoardGroups()
// 从 js/manual-boards.js 暴露（附录 A 口径：按幕分组，与幕序一致）。
export function manualOutline() {
  return ACTS.map(a => ({
    id: a.id, no: a.no, title: a.title, story: a.story,
    steps: a.steps.length,
    figs: a.figs.map(f => f.key),
    annots: a.figs.flatMap(f => f.annots),
    more: a.more || '',
  }));
}
// 附录 A · 功能模块详解：18 板块按幕分组（3/5/4/4/2），fig 引用对应幕截图键。
export function manualBoardGroups() {
  return BOARD_GROUPS.map(g => ({
    act: g.act, no: g.no, title: g.title,
    boards: g.boards.map(b => ({
      name: b.name, where: b.where, steps: [...b.steps], example: b.example,
      ...(b.fig ? { fig: b.fig } : {}),
    })),
  }));
}
export function manualIntro() {
  return { flow: INTRO.flow.length, flowTexts: [...INTRO.flow], fig: INTRO.fig.key, annots: [...INTRO.fig.annots] };
}
export function manualImageKeys() {
  const keys = [INTRO.fig.key, ...ACTS.flatMap(a => a.figs.map(f => f.key))];
  return [...new Set(keys)].sort();
}

// ---------- 渲染（需要 DOM） ----------
function fig(f) {
  const src = MANUAL_IMAGES[f.key];
  if (!src) return null; // 资产缺失时静默跳过（不产生裂图）
  // 图为内嵌 data URI（零网络成本）：立即解码，不用 lazy（页尾图 naturalWidth=0 回归，见 git 历史）。
  return h('figure', { class: 'man-fig' },
    h('img', { src, alt: MANUAL_META.captions?.[f.key] || f.key }),
    h('figcaption', {},
      MANUAL_META.captions?.[f.key] || '',
      f.annots?.length ? h('div', { class: 'man-annots' },
        '标注：' + f.annots.map((t, i) => `${i + 1} ${t}`).join(' · ')) : null));
}
function stepsList(steps, cls = 'man-steps') {
  return h('ol', { class: cls }, ...steps.map(s => h('li', { html: s })));
}
// build-59-manual4：附录 A——18 板块按幕分组，<details> 默认收起（点击展开）；卡片结构沿用
// build-58（板块已不在幕内，fig 引用从「见本幕图 N」改为「见第 N 幕图 M」，图不重排不重拍）。
function appendixBoards() {
  const figNoOf = (actId, key) => {
    const a = ACTS.find(x => x.id === actId);
    const i = a ? a.figs.findIndex(f => f.key === key) : -1;
    return i < 0 ? 0 : i + 1; // 幕内第几张（0 → 无引用）
  };
  return h('section', { class: 'man-scene', id: 'man-appendix-a' },
    h('h3', {}, '附录 A · 功能模块详解（按幕分组，点开逐步说明）'),
    ...BOARD_GROUPS.map(g => h('details', { class: 'man-boards' },
      h('summary', {}, `第 ${g.no} 幕 · ${g.title} · ${g.boards.length} 个板块`),
      ...g.boards.map(b => h('div', { class: 'man-board' },
        h('div', { class: 'man-board-head' },
          h('span', { class: 'man-board-name' }, b.name),
          b.fig && figNoOf(g.act, b.fig) ? h('span', { class: 'man-board-figref' }, `→ 见第 ${g.no} 幕图 ${figNoOf(g.act, b.fig)}`) : null),
        h('div', { class: 'man-board-where' }, b.where),
        stepsList(b.steps, 'man-steps man-board-steps'),
        h('p', { class: 'man-board-example' }, b.example))))));
}
export function renderManual({ build } = {}) {
  const ver = build || (typeof window !== 'undefined' && window.__MAIN_BUILD) || 'dev';
  const root = h('div', { class: 'manual' },
    h('header', { class: 'man-head' },
      h('div', { class: 'man-ver' }, `适用版本 ${ver} · 本页随应用构建自动更新`),
      h('p', { class: 'man-intro' },
        '舞阵 WuZhen 是网页版队列舞编排工具。工作流一条线：音乐导入 → 音乐编辑 → 节奏划分 → 队形编排 → 导出。数据自动保存在本设备浏览器；下面按这条线分五幕，照着做即可。')),
  );
  // 开场：一分钟看懂（四步主流程 + 界面导览）
  root.append(h('section', { class: 'man-scene', id: 'man-intro' },
    h('h3', {}, '开场 · 一分钟看懂舞阵'),
    stepsList(INTRO.flow, 'man-flow'),
    h('div', { class: 'man-figs' }, fig(INTRO.fig))));
  // 五幕（build-59-manual4 正文瘦身：纯 story+steps+截图+延伸，板块卡片不再幕内展开）
  ACTS.forEach(a => {
    root.append(h('section', { class: 'man-scene', id: 'man-' + a.id },
      h('h3', {}, `第 ${a.no} 幕 · ${a.title}`),
      h('p', { class: 'man-story' }, a.story),
      stepsList(a.steps),
      h('div', { class: 'man-figs' }, ...a.figs.map(f => fig(f)).filter(Boolean)),
      a.more ? h('p', { class: 'man-more' }, a.more) : null));
  });
  // 附录 A：功能模块详解（18 板块按幕分组，details 默认收起——板块详解后置，正文只留主线）
  root.append(appendixBoards());
  // 附录 B：速查（手势 / 快捷键）+ 数据与限制
  root.append(
    h('section', { class: 'man-scene', id: 'man-appendix-b' },
      h('h3', {}, '附录 B · 手势与快捷键速查'),
      h('table', { class: 'man-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '意图'), h('th', {}, '桌面'), h('th', {}, '触摸 / 笔'))),
        // 单元格走 html（内容为本文档自有文案，含内联 SVG 图标）
        h('tbody', {}, ...GESTURE_ROWS.map(r => h('tr', {}, h('td', { html: r[0] }), h('td', { html: r[1] }), h('td', { html: r[2] }))))),
      h('table', { class: 'man-table man-keys' },
        h('thead', {}, h('tr', {}, h('th', {}, '键'), h('th', {}, '作用'))),
        h('tbody', {}, ...KEY_ROWS.map(r => h('tr', {}, h('td', { html: r[0] }), h('td', { html: r[1] }))))),
      h('p', { class: 'man-note' }, '焦点在输入框/下拉时快捷键不触发；触摸端时间轴已禁浏览器滚动接管，拖块/拖播放头可用。')),
    h('section', { class: 'man-scene' },
      h('h3', {}, '数据与限制（诚实清单）'),
      h('ul', { class: 'man-limits' }, ...LIMITS.map(s => h('li', { html: s })))),
  );
  return root;
}
