// manual3.test.js —— build-58-manual3：说明书板块功能详解 + 显著入口。
// build-59-manual4 改写注明：用户反馈「正文繁琐」→ 18 个板块卡片整体迁往「附录 A · 功能模块详解」
//   （按幕分组、details 默认收起，数据在 js/manual-boards.js），幕内不再有 boards 小节——
//   本文件 F1 组的幕内 boards 断言整体改写为附录 A 口径（manualBoardGroups()）；
//   F4 的 manual.js ≤24KB 体积帽退役（manual4.test.js 以基线×1.2≈16.4KB 新帽接管，板块数据出文件）；
//   F4 构建包含断言随 summary 文案与 build 号同步改写。F2/F3（首页与顶栏入口）不受影响零改写。
// 四组断言：
//   F1 附录 A 板块详解：18 板块（3/5/4/4/2）分组与幕一致、每板块 name/where/steps(3-6)/example
//      齐备、任务书要点关键词全覆盖、fig 引用命中对应幕截图（复用 9 张不重拍）、渲染与 CSS 类族接线；
//   F2 项目库首页显著入口：#btn-library-manual 在 lib-header 内（book 图标+「使用说明书」文字，
//      位于新建项目钮左）、accent 显眼样式、first-run 一次性高亮（wuzhen:manualSeen）；
//   F3 顶栏入口双模式恒显「图标+文字」：桌面「说明书」/移动端短字「说明」（only-mobile 机制，
//      不再 hide-mobile 图标化）；右面板页签区与 rsb 区不加重复入口（注释钉住取舍）；
//   F4 篇幅纪律 + C-09a 静态红线 + 构建包含。
// 纯数据 + 源码/构建静态验证，无浏览器依赖（浏览器侧点击/Esc/高亮实感由主会话 C-09a 实测清单覆盖）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manualOutline, manualBoardGroups } from '../js/manual.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

// ---------- F1 附录 A 板块详解（build-59-manual4 起板块后置于此章） ----------
// 任务书板块清单（幕 → 板块名，顺序一致）
const EXPECT_BOARDS = {
  import: ['＋ 载入音乐按钮', '媒体库侧栏', '音频信息（时长/格式）'],
  'music-edit': ['clip 区域块', '淡化把手与曲线', '增益线', '工具条（剃刀/磁吸/缩放三钮/⤢）', '底部导航滑块'],
  rhythm: ['划分轨区域块', '节奏标注（拍值/小节数）', '索引 pane', '「打点」钮'],
  choreo: ['队形列表', '舞台排点', '块时长条', '播放条'],
  export: ['导出菜单（四项语义不同）', '导入项目文件'],
};

test('F1 附录 A 板块清单与任务书一致（18 板块：3/5/4/4/2，组↔幕一一对应）', () => {
  const groups = manualBoardGroups();
  assert.equal(groups.length, 5, '附录 A 按五幕分 5 组');
  for (const g of groups) {
    assert.deepEqual(g.boards.map(b => b.name), EXPECT_BOARDS[g.act], `组 ${g.act} 板块清单应与任务书一致`);
  }
  assert.equal(groups.reduce((n, g) => n + g.boards.length, 0), 18, '全说明书恰 18 个板块');
  // 内容一字不改的迁移验收：正文各幕不应再有任何板块数据（唯一数据源=manual-boards.js）
  for (const a of manualOutline()) assert.ok(!('boards' in a), `幕 ${a.id} 不应再内联板块`);
});

test('F1 每板块 name/where/steps/example 齐备：steps 3-6 条短句、example「例：」开头一句', () => {
  for (const g of manualBoardGroups()) {
    for (const b of g.boards) {
      assert.ok(b.where.trim().length >= 6, `组 ${g.act} 板块「${b.name}」where 应说明在界面哪里`);
      assert.ok(b.steps.length >= 3 && b.steps.length <= 6, `组 ${g.act} 板块「${b.name}」steps 应 3-6 条，实得 ${b.steps.length}`);
      for (const s of b.steps) {
        // 内联 SVG 图标（同 act steps 既有惯例）按一字折算后再量长度
        const plain = s.replace(/<svg[\s\S]*?<\/svg>/g, '图');
        assert.ok(plain.trim().length >= 6 && plain.trim().length <= 60, `组 ${g.act} 板块「${b.name}」步骤过长/过短：「${plain}」`);
      }
      assert.match(b.example, /^例：/, `组 ${g.act} 板块「${b.name}」example 应以「例：」开头`);
      assert.ok(b.example.length <= 40, `组 ${g.act} 板块「${b.name}」example 应一句以内（≤40 字）`);
    }
  }
});

test('F1 板块说明覆盖任务书要点关键词（每幕板块功能点全覆盖）', () => {
  const groups = manualBoardGroups();
  const textOf = g => g.boards.map(b => [b.name, b.where, b.example, ...b.steps].join('|')).join('|');
  const kw = {
    import: ['载入音乐', '媒体库', '资产行', '配乐', '时长', 'mp3'],
    'music-edit': ['选中', '移动', '修剪', '淡化', '增益', '剃刀', '磁吸', '⤢', '导航滑块'],
    rhythm: ['L1', 'L2', '双击', '拍值', '小节数', '秒区间', '折叠', '打点'],
    // build-91-varispeed 改写注明：「连续时长」已随 build-70-formationclips 退役（队形轴 clip 化，
    // 时长操作天然只作用本 clip）——板块口径改为「同步后面所有位置」（build-73 F1 画布菜单批量同步）。
    choreo: ['新队形', '删除', '折叠', '生成队形', '镜像', '均布', '换位', '朝向', '显示…', '保持', '过渡', '对齐到播放头', '同步后面', '速度', '循环', '节拍器'],
    export: ['含音乐', '不含音乐', 'PNG', 'PDF', '导入'],
  };
  for (const g of groups) {
    const t = textOf(g);
    for (const k of kw[g.act]) assert.ok(t.includes(k), `组 ${g.act} 板块说明应覆盖「${k}」`);
  }
});

test('F1 板块 fig 引用命中对应幕截图（复用 9 张不重拍；板块后置后指向「第 N 幕图 M」）', () => {
  const outline = manualOutline();
  assert.equal(outline.flatMap(a => a.figs).length, 8, '幕内图共 8 张 + 1 开场导览图 = 9（不重拍纪律）');
  for (const g of manualBoardGroups()) {
    const act = outline.find(a => a.id === g.act);
    for (const b of g.boards) {
      if (b.fig) assert.ok(act.figs.includes(b.fig), `组 ${g.act} 板块「${b.name}」fig=${b.fig} 应是第 ${g.no} 幕截图键`);
    }
  }
});

test('F1 渲染接线：附录 A 分组 details 默认收起，man-board 类族与 CSS 齐备', () => {
  const src = read('js/manual.js');
  assert.match(src, /appendixBoards\(\)/, '附录 A 由 appendixBoards() 渲染（五幕循环内不再插板块小节）');
  assert.match(src, /附录 A · 功能模块详解/, '附录 A 章标题');
  for (const cls of ['man-boards', 'man-board-head', 'man-board-name', 'man-board-figref', 'man-board-where', 'man-board-steps', 'man-board-example']) {
    assert.ok(src.includes(cls), `渲染应产出 .${cls}`);
  }
  // build-59-manual4 改写：v3 幕内为 open:''（默认展开）→ 附录 A 默认收起（点击展开）
  assert.match(src, /h\('details', \{ class: 'man-boards' \}/, '板块分组应为默认收起的可折叠 details');
  assert.ok(!src.includes("class: 'man-boards', open"), '不应保留 v3 默认展开写法');
  const css = read('css/style.css');
  for (const sel of ['.manual .man-boards{', '.manual .man-boards summary{', '.manual .man-board-name{', '.manual .man-board-where{', '.manual .man-board-steps{', '.manual .man-board-example{']) {
    assert.ok(css.includes(sel), `css 应有 ${sel} 版式`);
  }
});

// ---------- F2 首页显著入口 ----------
test('F2 项目库首页显著入口：lib-header 标题行内 book 图标 +「使用说明书」文字，位于新建项目钮左', () => {
  const html = read('index.html');
  const header = html.match(/<header class="lib-header">[\s\S]*?<\/header>/);
  assert.ok(header, '应能截取 lib-header');
  const h = header[0];
  assert.ok(h.includes('id="btn-library-manual"'), '说明书入口应在首页标题行显著位置');
  assert.match(h, /id="btn-library-manual"[^>]*>[\s\S]{0,240}?data-icon="book"/, '入口应带 book 图标（符号标志）');
  assert.match(h, /id="btn-library-manual"[^>]*>[\s\S]*?使用说明书</, '入口应带「使用说明书」显著文字');
  assert.ok(h.indexOf('btn-library-manual') < h.indexOf('btn-new-project'), '说明书钮排在新建项目钮左（首个显著位）');
});

test('F2 显眼样式与接线：accent 边框/底色 + hover 强化 + first-run 一次性高亮（wuzhen:manualSeen）', () => {
  const css = read('css/style.css');
  assert.match(css, /\.btn\.lib-manual\{[^}]*var\(--acc\)/, '首页入口 accent 边框与文字色（显眼样式）');
  assert.match(css, /\.btn\.lib-manual:hover\{/, 'hover 强化样式');
  assert.match(css, /\.btn\.lib-manual\.first-run\{[^}]*man-hint/, 'first-run 脉冲动画挂钩');
  assert.match(css, /@keyframes man-hint\{/, '脉冲动画定义存在');
  const main = read('js/main.js');
  assert.match(main, /\$\('btn-library-manual'\)\?\.addEventListener\('click', open\)/, '首页入口应接线打开 #manual-overlay（与编辑器共用）');
  assert.match(main, /wuzhen:manualSeen/, '一次性高亮记忆键');
  assert.match(main, /wireManualFirstRun\(\)/, 'boot 接线首次访问检测');
  assert.match(main, /markManualSeen\(\)/, '打开说明书即清高亮并记住');
});

// ---------- F3 顶栏双模式入口 ----------
test('F3 顶栏入口双模式恒显「图标+文字」：桌面「说明书」+ 移动端短字「说明」，不再 hide-mobile 图标化', () => {
  const html = read('index.html');
  const btn = html.match(/<button id="btn-manual-open"[\s\S]*?<\/button>/)[0];
  assert.ok(!btn.includes('hide-mobile'), '按钮内不应再有 hide-mobile（移动端不再收成纯图标）');
  assert.match(btn, /man-lbl-full"> 说明书</, '桌面全称「说明书」');
  assert.match(btn, /man-lbl-short only-mobile"> 说明</, '移动端短字「说明」（防 375 横溢的压缩排布）');
  const css = read('css/style.css');
  assert.match(css, /\.only-mobile\{display:none\}/, '桌面隐藏短字（只显全称）');
  assert.match(css, /@media \(max-width:1023\.5px\)\{[\s\S]*?\.only-mobile\{display:inline\}/, '移动端改显短字');
  assert.match(css, /#btn-manual-open\{border-color:var\(--acc\);color:var\(--acc\)\}/, '顶栏钮 accent 描边强化（两模式同款式）');
  assert.match(css, /#btn-manual-open:hover,#btn-manual-open:active\{/, '顶栏钮 hover/active 强化');
});

test('F3 取舍注释钉住：编舞右面板页签区与音乐 rsb 区不加说明书入口（顶栏两模式恒在即可）', () => {
  const html = read('index.html');
  const cmt = html.match(/<!--[\s\S]*?build-58-manual3 F3[\s\S]*?-->/);
  assert.ok(cmt, 'F3 取舍注释应存在');
  assert.ok(cmt[0].includes('不加说明书入口'), '注释应写明不加重复入口的取舍');
  assert.ok(cmt[0].includes('.panel-tabs') && cmt[0].includes('#right-sidebar'), '注释应点名列出两处不加的区域');
  assert.ok(!html.match(/class="ptab[^"]*"[^>]*>[^<]*说明书/), '右面板页签不应出现说明书入口');
  assert.ok(!/id="rsb-[^"]*"[^>]*>[^<]*说明书/.test(html), 'rsb 区不应出现说明书入口');
});

// ---------- F4 篇幅纪律 + C-09a 静态红线 + 构建包含 ----------
test('F4 篇幅纪律：板块纯文字 ≤2400 字（manual.js 体积帽由 manual4.test.js 以 16.4KB 接管）', () => {
  let chars = 0;
  for (const g of manualBoardGroups()) {
    for (const b of g.boards) {
      // 内联 SVG 图标按一字折算（同 F1 长度口径），量的是读者读到的文字量
      const plain = s => s.replace(/<svg[\s\S]*?<\/svg>/g, '图');
      chars += plain(b.name).length + plain(b.where).length + plain(b.example).length
        + b.steps.reduce((n, s) => n + plain(s).length, 0);
    }
  }
  assert.ok(chars <= 2400, `板块文字 ${chars} 字超 2400 上限（18 板块×3-6 步的数据地板，任务书 +50% 口径按此收口）`);
});

test('F4 C-09a 静态红线：移动端顶栏/工具条内部横滚兜底仍在（页面级不横溢的既有机制不被破坏）', () => {
  const css = read('css/style.css');
  // build-66-mobileux F2 改写注明：顶栏两段结构后横滚兜底自 #topbar 移到滚动段 #topbar-scroll
  //（#ui-mode-seg 固定段移出滚动流），机制与口径不变
  assert.match(css, /#topbar-scroll\{overflow-x:auto/, '移动端顶栏滚动段过挤内部横滚（C-09a 口径）');
  assert.match(css, /#editor-view\[data-uimode="music"\] #music-toolbar\{overflow-x:auto/, '音乐工具条横滚兜底');
  // 新增短字只进顶栏内部滚动流，不改页面级布局：lib-header 无 overflow 破坏
  assert.match(css, /\.lib-actions\{display:flex/, '首页按钮组 flex 排布（标题行内不折行横溢）');
  // 首页标题行 375 预算：brand 副题移动端收起 + 标题行允许换行兜底（双钮 + brand 压得进 375）
  const html = read('index.html');
  assert.match(html, /lib-sub hide-mobile/, 'brand 副题移动端隐藏（375 宽度预算）');
  assert.match(css, /\.lib-header\{[^}]*flex-wrap:wrap/, '标题行换行兜底（C-09a）');
});

test('F4 构建包含：重建后 dist 含附录 A 板块详解/首页入口/双模式文字/build 号（打包零遗漏）', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-single.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `构建应成功：${r.stderr}`);
  const html = read('dist/formation-studio.html');
  assert.ok(html.includes('btn-library-manual'), '首页入口进包');
  assert.ok(html.includes('man-board-example'), '板块渲染类进包');
  // build-59-manual4 改写：summary 从幕内「板块功能 · 本幕」改为附录 A「第 N 幕 · 标题 · M 个板块」
  assert.ok(html.includes('附录 A · 功能模块详解'), '附录 A 章标题进包');
  assert.ok(html.includes('个板块'), '分组 summary 文案进包');
  assert.ok(html.includes('only-mobile'), '移动端短字机制进包');
  // build-72-checkupdate 改写注明：build 号随版本推进（原 build-71-iomenu），断言语义不变
  assert.match(html, /build-91-varispeed/, 'build 号进包'); // build-91-varispeed 改写注明：版本推进
});
