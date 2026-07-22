import fs from 'node:fs';
import path from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const deckDir = path.dirname(fileURLToPath(import.meta.url));

function dataUri(filePath, mime) {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

const yodaLogo = dataUri(path.join(deckDir, 'assets/yoda-logo.svg'), 'image/svg+xml');
const shougongchuanLogo = dataUri(
  path.join(deckDir, 'assets/shougongchuan-logo.svg'),
  'image/svg+xml'
);
const yodaWebsiteQr = dataUri(path.join(deckDir, 'assets/yoda-website-qr.png'), 'image/png');
const shougongchuanOfficialAccountQr = dataUri(
  path.join(deckDir, 'assets/shougongchuan-official-account-qr.jpg'),
  'image/jpeg'
);
const taskScreenshot = dataUri(path.join(deckDir, 'assets/yoda-tasks.jpg'), 'image/jpeg');
const featureScreenshot = dataUri(path.join(deckDir, 'assets/yoda-feature.jpg'), 'image/jpeg');
const founderPhoto = dataUri(
  '/Users/mark/lovstudio/vault/profile/album/work/2026-04-26-手工川是如何使用AI的.jpg',
  'image/jpeg'
);

const css = `
  :root { --paper:#f6f5f1; --stone:#ecebe6; --ink:#111312; --muted:#626762; --grid:#d4d5d0; --deep:#173d2a; --green:#5dc98f; --blue:#526a7a; --gray:#a9aaa5; --white:#ffffff; }
  * { box-sizing:border-box; }
  html,body { margin:0; width:1600px; height:900px; overflow:hidden; background:var(--paper); }
  body { font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Microsoft YaHei",sans-serif; color:var(--ink); }
  .slide { position:relative; width:1600px; height:900px; overflow:hidden; padding:66px 88px 62px; background:var(--paper); }
  .slide.stone { background:var(--stone); }
  h1,h2,p { margin:0; }
  h1 { font-size:76px; line-height:1.05; letter-spacing:-.045em; font-weight:790; }
  h2 { max-width:1320px; font-size:56px; line-height:1.12; letter-spacing:-.035em; font-weight:770; }
  .sub { margin-top:16px; max-width:1180px; color:#424642; font-size:26px; line-height:1.42; font-weight:510; }
  .eyebrow { margin-bottom:16px; color:var(--deep); font-size:16px; font-weight:780; letter-spacing:.16em; text-transform:uppercase; }
  .brand-lockup { display:flex; align-items:center; gap:12px; }
  .brand-lockup .brand-divider { width:1px; height:22px; background:#c6c8c3; }
  .brand-lockup .yoda-logo { display:block; width:98px; height:auto; }
  .brand-lockup .shougongchuan-logo { display:block; width:100px; height:auto; }
  .mini-brand { position:absolute; right:88px; top:62px; }
  .muted { color:var(--muted); }
  .deep { color:var(--deep); }
  .green { color:#278258; }
  .blue { color:var(--blue); }
  .hairline { height:1px; background:var(--grid); }
  .foot { position:absolute; left:88px; right:88px; bottom:24px; color:#777b77; font-size:15px; line-height:1.4; }
  .metric { font-size:78px; line-height:.95; font-weight:820; letter-spacing:-.05em; }
  .metric-sm { font-size:53px; line-height:1; font-weight:800; letter-spacing:-.04em; }
  .label { color:var(--muted); font-size:18px; line-height:1.4; }
  .body { color:#2c302d; font-size:25px; line-height:1.52; }
  .chart-label { font-size:18px; fill:#5e645f; }
  .chart-strong { font-size:21px; font-weight:720; fill:#151816; }
  .panel { border:1px solid var(--grid); background:rgba(255,255,255,.28); }
  .shot { overflow:hidden; border:1px solid #c8c9c4; background:#fff; box-shadow:0 16px 36px rgba(24,35,29,.08); }
  .shot img,.photo img { width:100%; height:100%; display:block; object-fit:cover; }
  .photo { overflow:hidden; background:#ddd; }
`;

function doc(content) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${content}</body></html>`;
}

function brandLockup(variant = '') {
  return `<div class="brand-lockup ${variant}"><img class="yoda-logo" src="${yodaLogo}" alt="Yoda"><span class="brand-divider"></span><img class="shougongchuan-logo" src="${shougongchuanLogo}" alt="手工川"></div>`;
}

function miniBrand() {
  return `<div class="mini-brand">${brandLockup()}</div>`;
}

const slides = [
  {
    filename: '01-slide-cover.png',
    html: `<section class="slide">
      <div style="position:absolute;left:0;right:0;top:278px;height:304px;background:var(--deep);display:flex;flex-direction:column;align-items:center;justify-content:center">
        <h1 style="font-size:64px;line-height:1.12;font-weight:750;letter-spacing:-.035em;text-align:center;color:white">Agent 时代的集成委托环境</h1>
        <img src="${yodaLogo}" alt="Yoda" style="display:block;width:232px;height:auto;margin-top:42px;filter:brightness(0) invert(1)">
      </div>
      <div style="position:absolute;left:0;right:0;top:654px;text-align:center;color:var(--deep);font-size:20px;font-weight:700;letter-spacing:.12em">融资商业计划书</div>
      <div style="position:absolute;left:0;right:0;top:710px;text-align:center;color:#777c78;font-size:17px;font-weight:560">2026 年 7 月</div>
    </section>`,
  },
  {
    filename: '02-slide-ide-shift.png',
    html: `<section class="slide stone">${miniBrand()}
      <div class="eyebrow">范式迁移</div><h2>IDE 的中心，正从“代码”迁移到“委托”</h2>
      <p class="sub">每一代 IDE 都围绕当时最稀缺的生产要素重构</p>
      <div style="position:absolute;left:88px;right:88px;top:340px">
        <div style="height:3px;background:linear-gradient(90deg,#b0b2ad 0 75%,#173d2a 75% 100%)"></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:30px;margin-top:-10px">
          ${[
            ['1990s', '语言中心', 'Dev-C++ / Visual Studio', '编译与运行'],
            ['2000s', '工程中心', 'JetBrains', '理解与维护'],
            ['2015–2025', '代码工作台', 'VS Code / Cursor', '扩展与生成'],
            ['2026+', '委托环境', 'Yoda', '意图、证据与责任'],
          ]
            .map(
              ([era, title, products, job], index) =>
                `<div><span style="display:block;width:18px;height:18px;border-radius:50%;background:${index === 3 ? '#173d2a' : '#aeb0ab'};border:4px solid var(--stone)"></span><div style="font-size:16px;color:${index === 3 ? '#173d2a' : '#777'};margin-top:25px">${era}</div><div style="font-size:32px;font-weight:780;margin-top:10px;color:${index === 3 ? '#173d2a' : '#111'}">${title}</div><div style="font-size:21px;font-weight:650;margin-top:16px">${products}</div><div class="label" style="margin-top:8px">解决：${job}</div></div>`
            )
            .join('')}
        </div>
      </div>
      <div style="position:absolute;left:88px;right:88px;bottom:58px;border-top:1px solid var(--grid);padding-top:24px;font-size:25px;font-weight:730;color:var(--deep)">下一代 IDE 不是编辑器旁边多一个聊天框，而是 Integrated Delegation Environment。</div>
    </section>`,
  },
  {
    filename: '03-slide-delegation-gap.png',
    html: `<section class="slide">${miniBrand()}
      <div class="eyebrow">核心问题</div><h2>实现成本快速下降，委托复杂度反而上升</h2>
      <p class="sub">Agent 越能独立工作，人越需要新的控制面</p>
      <div style="position:absolute;left:88px;right:88px;top:300px;bottom:82px;display:grid;grid-template-columns:66% 34%;gap:48px">
        <div class="panel" style="position:relative;padding:28px 32px 24px">
          <div style="position:absolute;right:24px;top:18px;font-size:14px;color:#888">趋势示意 · 非统计数据</div>
          <svg viewBox="0 0 880 420" style="width:100%;height:100%">
            <defs><marker id="arrow3" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#555"/></marker></defs>
            ${[70, 150, 230, 310].map((y) => `<line x1="90" y1="${y}" x2="825" y2="${y}" stroke="#d4d5d0" stroke-width="1"/>`).join('')}
            <line x1="90" y1="360" x2="835" y2="360" stroke="#8d918d" stroke-width="2" marker-end="url(#arrow3)"/>
            <line x1="90" y1="360" x2="90" y2="35" stroke="#8d918d" stroke-width="2" marker-end="url(#arrow3)"/>
            <text x="720" y="402" class="chart-label">Agent 自主能力 →</text><text x="14" y="30" class="chart-label">相对水平</text>
            <path d="M105 85 C300 120 500 230 805 320" fill="none" stroke="#526a7a" stroke-width="6"/>
            <path d="M105 315 C340 280 555 155 805 68" fill="none" stroke="#173d2a" stroke-width="7"/>
            <path d="M105 225 C330 220 560 222 805 218" fill="none" stroke="#a9aaa5" stroke-width="5" stroke-dasharray="12 10"/>
            <text x="610" y="302" class="chart-strong" fill="#526a7a">实现成本 ↓</text>
            <text x="600" y="87" class="chart-strong" fill="#173d2a">委托复杂度 ↑</text>
            <text x="606" y="207" class="chart-strong" fill="#777">人类注意力 ≈ 不变</text>
          </svg>
        </div>
        <div style="border-top:1px solid var(--grid)">
          ${[
            ['01', '状态', '多个会话谁在运行、等待或卡住'],
            ['02', '上下文', 'Skills、Hooks、Memory 是否真正生效'],
            ['03', '工程边界', '分支、Worktree、Diff 与冲突'],
            ['04', '证据与成本', '测试是否通过、Token 花在哪里'],
          ]
            .map(
              ([n, title, desc]) =>
                `<div style="display:grid;grid-template-columns:42px 82px 1fr;gap:10px;padding:18px 0;border-bottom:1px solid var(--grid);align-items:start"><span style="font-size:14px;color:#888">${n}</span><b style="font-size:20px">${title}</b><span style="font-size:18px;line-height:1.4;color:var(--muted)">${desc}</span></div>`
            )
            .join('')}
          <div style="margin-top:26px;font-size:23px;line-height:1.45;font-weight:740;color:var(--deep)">Agent 能跑只是执行问题；<br>敢不敢委托，才是工程问题。</div>
        </div>
      </div>
    </section>`,
  },
  {
    filename: '04-slide-delegation-loop.png',
    html: `<section class="slide stone">${miniBrand()}
      <div class="eyebrow">解决方案</div><h2>Yoda 把一次 Agent 执行，变成可审查的交付闭环</h2>
      <p class="sub">停止不等于完成；生成不等于交付</p>
      <div style="position:absolute;left:100px;right:100px;top:310px">
        <div style="display:grid;grid-template-columns:150px repeat(4,1fr);align-items:stretch;border-top:1px solid var(--grid)">
          <div style="padding:28px 18px 0 0;font-size:18px;font-weight:760;color:var(--deep)">HUMAN</div>
          ${['定义意图', '设置约束', '审查证据', '批准交付'].map((x, i) => `<div style="padding:26px 18px;border-left:1px solid var(--grid);font-size:26px;font-weight:730"><span style="display:block;font-size:14px;color:#858985;margin-bottom:10px">H${i + 1}</span>${x}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:150px repeat(4,1fr);align-items:stretch;background:var(--deep);color:white">
          <div style="padding:31px 18px 0 0;font-size:18px;font-weight:760;color:#bce5cc;text-align:right;padding-right:24px">AGENT</div>
          ${['规划', '执行', '测试', '修正'].map((x, i) => `<div style="padding:28px 18px;border-left:1px solid rgba(255,255,255,.2);font-size:27px;font-weight:730"><span style="display:block;font-size:14px;color:#bce5cc;margin-bottom:10px">A${i + 1}</span>${x}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:150px repeat(5,1fr);align-items:center;border-bottom:1px solid var(--grid)">
          <div style="padding:26px 18px 26px 0;font-size:18px;font-weight:760;color:var(--blue)">EVIDENCE</div>
          ${['Diff', 'Test', 'Review', 'PR', 'Release'].map((x) => `<div style="padding:25px 12px;border-left:1px solid var(--grid);font-size:22px;font-weight:700;text-align:center">${x}</div>`).join('')}
        </div>
        <svg viewBox="0 0 1400 110" style="width:100%;height:110px;margin-top:12px"><defs><marker id="arrow4" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#173d2a"/></marker></defs><path d="M1250 18 C1310 18 1310 88 1240 88 L290 88 C220 88 220 36 280 36" fill="none" stroke="#173d2a" stroke-width="3" marker-end="url(#arrow4)"/><text x="650" y="77" class="chart-label">证据不充分 → 返回修正；人工始终保留最终批准权</text></svg>
      </div>
    </section>`,
  },
  {
    filename: '05-slide-task-to-feature.png',
    html: `<section class="slide">${miniBrand()}
      <div class="eyebrow">产品体验</div><h2 style="font-size:52px">从 Task 到 Feature：<br>管理的不再是聊天，而是完整交付主线</h2>
      <p class="sub">Task 保证一次执行稳健，Feature 保证一个需求真正完成</p>
      <div style="position:absolute;left:88px;right:88px;top:290px;bottom:62px;display:grid;grid-template-columns:28% 47% 25%;gap:22px">
        <div>
          <div class="shot" style="height:440px"><img src="${taskScreenshot}" style="object-position:center top" alt="Yoda Task"></div>
          <div class="label" style="margin-top:12px"><b style="color:var(--ink)">Task</b> · 工作目录、分支、会话、状态与 Diff 绑定</div>
        </div>
        <div>
          <div class="shot" style="height:440px"><img src="${featureScreenshot}" style="object-position:center top" alt="Yoda Feature"></div>
          <div class="label" style="margin-top:12px"><b style="color:var(--ink)">Feature</b> · Issue、Task、交付物与 Release 形成主线</div>
        </div>
        <div style="border-top:1px solid var(--grid)">
          ${['问题定义', '产品方案', '技术实现', '验证证据', '发布交付']
            .map(
              (x, i) =>
                `<div style="display:grid;grid-template-columns:36px 1fr 24px;align-items:center;padding:17px 0;border-bottom:1px solid var(--grid)"><span style="font-size:14px;color:#8a8d89">0${i + 1}</span><b style="font-size:20px">${x}</b><span style="width:14px;height:14px;border:${i < 2 ? '4px solid #5dc98f' : '2px solid #a9aaa5'};border-radius:50%"></span></div>`
            )
            .join('')}
          <div style="margin-top:26px;font-size:20px;line-height:1.5;color:var(--deep);font-weight:700">没有交付物、Review 或测试证据，就不能假装进入下一阶段。</div>
        </div>
      </div>
      <div class="foot">真实 Yoda 产品截图，来源于《Agent 时代，我们需要怎样的 IDE》。</div>
    </section>`,
  },
  {
    filename: '06-slide-product-architecture.png',
    html: `<section class="slide stone">${miniBrand()}
      <div class="eyebrow">产品架构</div><h2>五层产品架构，把开放的 Agent 生态变成可控生产系统</h2>
      <div style="position:absolute;left:110px;right:110px;top:250px;bottom:66px;display:grid;grid-template-columns:180px 1fr 250px;grid-template-rows:repeat(5,1fr)">
        ${[
          ['01', 'Runtime', '31 种 Agent CLI · MaaS · 模型', '选择自由'],
          ['02', 'Session Control', '会话 · 状态 · 上下文 · 恢复 · 成本', '过程可见'],
          ['03', 'Harness Assets', 'Skills · Hooks · Memory · Prompts · 原子原则', '经验复用'],
          ['04', 'Delivery System', 'Task · Feature · Worktree · Diff · Stage Gate', '工程稳健'],
          ['05', 'Human Control', '桌面 · 移动端 · 浏览器 · 通知 · 最终批准', '责任在人'],
        ]
          .map(
            ([n, title, items, value], index) =>
              `<div style="grid-column:1;padding:21px 18px 0 0;border-top:1px solid var(--grid);font-size:14px;color:#858985">${n}</div><div style="grid-column:2;padding:17px 28px;border-top:1px solid ${index === 2 ? '#173d2a' : '#d4d5d0'};background:${index === 2 ? '#173d2a' : 'transparent'};color:${index === 2 ? 'white' : '#111'};display:grid;grid-template-columns:220px 1fr;align-items:center"><b style="font-size:24px">${title}</b><span style="font-size:21px;color:${index === 2 ? '#cce7d7' : '#5f655f'}">${items}</span></div><div style="grid-column:3;padding:20px 0 0 30px;border-top:1px solid var(--grid);font-size:20px;font-weight:720;color:${index === 2 ? '#278258' : '#3e443f'}">${value}</div>`
          )
          .join('')}
      </div>
    </section>`,
  },
  {
    filename: '07-slide-system-moat.png',
    html: `<section class="slide">${miniBrand()}
      <div class="eyebrow">系统壁垒</div><h2>Yoda 的壁垒不是一个 Agent，而是一套“自由、稳健、进化”的系统</h2>
      <div style="position:absolute;left:88px;right:88px;top:265px">
        <div style="display:grid;grid-template-columns:190px repeat(3,1fr);border-top:1px solid var(--grid);border-left:1px solid var(--grid)">
          <div style="padding:22px;border-right:1px solid var(--grid);border-bottom:1px solid var(--grid);font-size:17px;color:#777">能力维度</div>
          ${[
            ['自由', '不被单一生态锁定'],
            ['稳健', '可见、可查、可回退'],
            ['进化', '经验持续沉淀'],
          ]
            .map(
              ([a, b], i) =>
                `<div style="padding:18px 24px;border-right:1px solid var(--grid);border-bottom:1px solid var(--grid);background:${i === 1 ? '#173d2a' : 'transparent'};color:${i === 1 ? 'white' : '#111'}"><div style="font-size:29px;font-weight:780">${a}</div><div style="font-size:17px;margin-top:6px;color:${i === 1 ? '#cce7d7' : '#6b706c'}">${b}</div></div>`
            )
            .join('')}
          ${[
            ['选择', 'Agent / 模型 / 渠道', '隔离强度按风险选择', '原子原则按需开关'],
            ['过程', '多种范式与交互入口', '状态 / Context / 成本透明', '动态 Harness'],
            [
              '验证',
              '单 Agent 与多 Agent 均可',
              '交叉 Review / Stage Gate',
              'Skill / Gene 执行反馈',
            ],
            ['资产', '代码与数据归用户', 'Diff / Test / PR 可追溯', 'Library 复用与比较'],
          ]
            .map(
              ([row, a, b, c]) =>
                `<div style="padding:19px 22px;border-right:1px solid var(--grid);border-bottom:1px solid var(--grid);font-size:17px;color:#747874">${row}</div><div style="padding:19px 22px;border-right:1px solid var(--grid);border-bottom:1px solid var(--grid);font-size:20px;font-weight:650">${a}</div><div style="padding:19px 22px;border-right:1px solid var(--grid);border-bottom:1px solid var(--grid);font-size:20px;font-weight:650">${b}</div><div style="padding:19px 22px;border-right:1px solid var(--grid);border-bottom:1px solid var(--grid);font-size:20px;font-weight:650">${c}</div>`
            )
            .join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:32px">
          <div style="font-size:23px;font-weight:720;color:var(--deep)">换模型，不丢自己的工作方式。</div>
          <div style="font-size:23px;font-weight:720;color:var(--deep)">Agent 出错，能看见、定位、回退，也能换人。</div>
        </div>
      </div>
    </section>`,
  },
  {
    filename: '08-slide-why-now.png',
    html: `<section class="slide stone">${miniBrand()}
      <div class="eyebrow">Why Now</div><h2>模型竞争正在下沉为基础能力，Harness 成为新的价值层</h2>
      <div style="position:absolute;left:88px;right:88px;top:275px;bottom:70px;display:grid;grid-template-columns:68% 32%;gap:45px">
        <div class="panel" style="padding:22px 28px 18px;position:relative">
          <div style="position:absolute;right:22px;top:15px;font-size:14px;color:#888">趋势示意 · 非统计预测</div>
          <svg viewBox="0 0 930 470" style="width:100%;height:100%">
            ${[80, 170, 260, 350].map((y) => `<line x1="80" y1="${y}" x2="880" y2="${y}" stroke="#d4d5d0"/>`).join('')}
            <line x1="80" y1="400" x2="890" y2="400" stroke="#858985" stroke-width="2"/><line x1="80" y1="400" x2="80" y2="42" stroke="#858985" stroke-width="2"/>
            <text x="720" y="444" class="chart-label">时间 / 普及程度 →</text>
            <path d="M100 340 C260 305 480 175 855 70" fill="none" stroke="#526a7a" stroke-width="7"/><path d="M100 365 C300 340 530 245 855 115" fill="none" stroke="#173d2a" stroke-width="7"/><path d="M100 255 C360 250 610 250 855 246" fill="none" stroke="#a9aaa5" stroke-width="5" stroke-dasharray="12 10"/>
            <circle cx="855" cy="70" r="7" fill="#526a7a"/><circle cx="855" cy="115" r="7" fill="#173d2a"/><circle cx="855" cy="246" r="7" fill="#a9aaa5"/>
            <text x="600" y="68" class="chart-strong">模型能力与可得性 ↑</text><text x="604" y="134" class="chart-strong">Agent 独立执行时长 ↑</text><text x="604" y="235" class="chart-strong">人类注意力 ≈ 不变</text>
          </svg>
        </div>
        <div style="display:grid;grid-template-rows:1fr 1fr;gap:22px">
          <div style="border-top:4px solid var(--blue);padding-top:25px"><div class="metric">75<span style="font-size:42px">%</span></div><div style="font-size:22px;line-height:1.42;margin-top:15px">创意 AI 已融入或成为工作流必要部分</div></div>
          <div style="border-top:4px solid var(--green);padding-top:25px"><div class="metric green">85<span style="font-size:42px">%</span></div><div style="font-size:22px;line-height:1.42;margin-top:15px">最终创意决策仍应由人完成</div></div>
        </div>
      </div>
      <div class="foot">数据来源：Adobe 2026 Creators’ Toolkit Report。趋势线为概念示意。</div>
    </section>`,
  },
  {
    filename: '09-slide-traction.png',
    html: `<section class="slide">${miniBrand()}
      <div class="eyebrow">Traction</div><h2>两个月完成产品闭环，已有使用信号，商业验证尚未开始</h2>
      <div style="position:absolute;left:90px;right:90px;top:280px">
        <div style="display:grid;grid-template-columns:180px 1fr;align-items:stretch;margin-bottom:18px"><div style="font-size:21px;font-weight:760;padding-top:22px">BUILD</div><div style="height:126px;background:var(--deep);color:white;padding:22px 30px;display:grid;grid-template-columns:repeat(3,1fr)"><div><div class="metric-sm">1,645</div><div style="font-size:17px;color:#cce7d7;margin-top:8px">main 提交</div></div><div><div class="metric-sm">73</div><div style="font-size:17px;color:#cce7d7;margin-top:8px">公开 Release</div></div><div><div class="metric-sm">31</div><div style="font-size:17px;color:#cce7d7;margin-top:8px">Agent Client</div></div></div></div>
        <div style="display:grid;grid-template-columns:180px 75% 1fr;align-items:stretch;margin-bottom:18px"><div style="font-size:21px;font-weight:760;padding-top:22px">USE</div><div style="height:116px;background:#dce8e0;padding:21px 30px;display:grid;grid-template-columns:1fr 1fr"><div><div class="metric-sm">126</div><div class="label" style="margin-top:7px">14 天独立 Cloner</div></div><div><div class="metric-sm">73</div><div class="label" style="margin-top:7px">独立授权用户</div></div></div><div></div></div>
        <div style="display:grid;grid-template-columns:180px 42% 1fr;align-items:stretch"><div style="font-size:21px;font-weight:760;padding-top:22px">PAY</div><div style="height:110px;background:#1b1c1b;color:white;padding:20px 30px;display:grid;grid-template-columns:1fr 1fr"><div><div class="metric-sm">3</div><div style="font-size:17px;color:#bbb;margin-top:7px">Relay 试用</div></div><div><div class="metric-sm">0</div><div style="font-size:17px;color:#bbb;margin-top:7px">付费</div></div></div><div style="padding:24px 0 0 28px;font-size:19px;line-height:1.45;color:var(--muted)">留存、个人付费和机构年约<br>是本轮融资后的核心验证</div></div>
      </div>
      <div class="foot">GitHub 数据截至 2026-07-22；账号与 Relay 数据截至 2026-07-21。不同指标口径不同，不构成转化漏斗。提交数包含合并与协作者贡献。</div>
    </section>`,
  },
  {
    filename: '10-slide-market.png',
    html: `<section class="slide stone">${miniBrand()}
      <div class="eyebrow">市场机会</div><h2>超级开发者是楔子，集成委托环境是更大的市场</h2>
      <p class="sub">从高频 Coding 创作者扩展到 AI 原生个人与小型团队</p>
      <div style="position:absolute;left:88px;right:88px;top:300px;bottom:72px;display:grid;grid-template-columns:48% 52%;align-items:center">
        <div style="position:relative;height:490px">
          <div style="position:absolute;left:40px;top:18px;width:440px;height:440px;border:1px solid #b8bbb6;border-radius:50%"></div>
          <div style="position:absolute;left:104px;top:82px;width:312px;height:312px;border:2px solid #82a991;border-radius:50%"></div>
          <div style="position:absolute;left:174px;top:152px;width:172px;height:172px;background:var(--deep);color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:24px;font-weight:760">超级<br>开发者</div>
          <div style="position:absolute;left:360px;top:94px;color:#477158;font-size:20px">Coding 创作者</div><div style="position:absolute;left:425px;top:25px;color:#6c716d;font-size:20px">AI 原生个人与团队</div>
          <div style="position:absolute;left:67px;bottom:0;font-size:17px;color:#777">切入顺序：高频、高痛点、高传播势能 → 更广泛的创造者</div>
        </div>
        <div style="border-left:1px solid var(--grid);padding-left:64px">
          ${[
            ['TAM', '248 亿美元', '2.07 亿创作者 × 120 美元年费'],
            ['SAM', '24.8 亿美元', '假设 10% 适配率'],
            ['3Y SOM', '240 万美元 ARR', '2 万账户 × 120 美元'],
          ]
            .map(
              ([tag, value, note], i) =>
                `<div style="display:grid;grid-template-columns:90px 1fr;gap:22px;padding:${i === 0 ? '0 0 27px' : '27px 0'};border-bottom:${i === 2 ? '0' : '1px solid var(--grid)'}"><div style="font-size:16px;color:#7a7e7a;padding-top:10px">${tag}</div><div><div style="font-size:48px;font-weight:800;color:${i === 2 ? '#278258' : '#111'}">${value}</div><div class="label" style="margin-top:8px">${note}</div></div></div>`
            )
            .join('')}
        </div>
      </div>
      <div class="foot">来源：Visa 2025 Creator Report。SAM、年费与三年 SOM 为假设或经营目标，不代表当前收入。</div>
    </section>`,
  },
  {
    filename: '11-slide-competition.png',
    html: `<section class="slide">${miniBrand()}
      <div class="eyebrow">竞争定位</div><h2>市场上多数产品优化“执行”，Yoda 优化“可靠委托”</h2>
      <div style="position:absolute;left:90px;right:90px;top:260px;bottom:66px;display:grid;grid-template-columns:76% 24%;gap:34px">
        <div class="panel" style="padding:18px 24px 20px">
          <svg viewBox="0 0 1030 500" style="width:100%;height:100%">
            <defs><marker id="axisArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#777"/></marker></defs>
            <line x1="90" y1="430" x2="980" y2="430" stroke="#878b87" stroke-width="2" marker-end="url(#axisArrow)"/><line x1="90" y1="430" x2="90" y2="40" stroke="#878b87" stroke-width="2" marker-end="url(#axisArrow)"/>
            <line x1="535" y1="55" x2="535" y2="430" stroke="#d4d5d0" stroke-dasharray="9 8"/><line x1="90" y1="235" x2="970" y2="235" stroke="#d4d5d0" stroke-dasharray="9 8"/>
            <text x="92" y="475" class="chart-label">单一生态绑定</text><text x="830" y="475" class="chart-label">供应商中立 →</text><text x="12" y="427" class="chart-label" transform="rotate(-90 12 427)">代码执行工具</text><text x="24" y="170" class="chart-label" transform="rotate(-90 24 170)">委托治理系统 →</text>
            <circle cx="310" cy="350" r="18" fill="#a9aaa5"/><text x="337" y="357" class="chart-strong">VS Code / Cursor</text>
            <circle cx="330" cy="270" r="18" fill="#526a7a"/><text x="357" y="277" class="chart-strong">Codex App</text>
            <circle cx="575" cy="292" r="18" fill="#7c8e82"/><text x="602" y="299" class="chart-strong">Conductor</text>
            <circle cx="690" cy="178" r="18" fill="#6f8a7b"/><text x="717" y="185" class="chart-strong">Agent Team Tools</text>
            <circle cx="855" cy="92" r="31" fill="#173d2a"/><circle cx="855" cy="92" r="8" fill="#5dc98f"/><text x="895" y="100" style="font-size:24px;font-weight:800;fill:#173d2a">Yoda</text>
            <text x="625" y="71" class="chart-label">Harness / 证据 / 治理 / 资产沉淀</text>
          </svg>
        </div>
        <div style="border-top:1px solid var(--grid)">
          ${[
            ['供应商中立', '31 种 Agent Client'],
            ['委托透明', 'Context / Harness / 成本'],
            ['工程证据', 'Task / Feature / Stage Gate'],
            ['资产复用', 'Skills / Memory / Library'],
          ]
            .map(
              ([a, b]) =>
                `<div style="padding:18px 0;border-bottom:1px solid var(--grid)"><div style="font-size:20px;font-weight:740">${a}</div><div class="label" style="margin-top:7px">${b}</div></div>`
            )
            .join('')}
        </div>
      </div>
      <div class="foot">基于公开产品定位与当前功能的定性判断，不代表第三方厂商自我定义；位置随产品迭代可能变化。</div>
    </section>`,
  },
  {
    filename: '12-slide-business-model.png',
    html: `<section class="slide stone">${miniBrand()}
      <div class="eyebrow">商业模式</div><h2>本地核心开源，连续性与协作秩序收费</h2>
      <p class="sub">个人为“离开电脑仍能继续”付费，团队为治理、证据和可追责协作付费</p>
      <div style="position:absolute;left:90px;right:90px;top:315px;height:420px;border-bottom:2px solid #9b9e99">
        ${[
          ['OPEN SOURCE', '本地核心', '工作区 · 数据 · 选择权', '0', 0, 220, '#cfd1cc'],
          ['RELAY', '连接连续性', '跨网络 · 设备状态', '个人', 220, 250, '#b4cbbd'],
          ['CREATOR PRO', '个人效率', '同步 · 自动化 · 备份', '个人', 470, 270, '#83b695'],
          ['EDUCATION / TEAM', '协作秩序', '共享资产 · 权限 · 审计', '机构', 740, 300, '#4f8767'],
          ['ENTERPRISE', '组织治理', '私有化 · SSO · 合规 · SLA', '企业', 1040, 370, '#173d2a'],
        ]
          .map(
            ([tag, title, desc, buyer, left, width, color], i) =>
              `<div style="position:absolute;left:${left}px;bottom:0;width:${width}px;height:${110 + i * 52}px;background:${color};color:${i >= 3 ? 'white' : '#111'};padding:20px 22px;border-right:1px solid rgba(255,255,255,.45)"><div style="font-size:13px;letter-spacing:.1em;color:${i >= 3 ? '#d2e7da' : '#59605b'}">${tag}</div><div style="font-size:24px;font-weight:780;margin-top:12px">${title}</div><div style="font-size:17px;line-height:1.4;margin-top:10px;color:${i >= 3 ? '#e2eee6' : '#4f5551'}">${desc}</div><div style="position:absolute;bottom:18px;left:22px;font-size:16px;font-weight:720">付费者：${buyer}</div></div>`
          )
          .join('')}
      </div>
      <div class="foot">商业化边界：本地能力归用户，联网服务按需付费；个人为连续性付费，团队为协作秩序付费。</div>
    </section>`,
  },
  {
    filename: '13-slide-gtm.png',
    html: `<section class="slide">${miniBrand()}
      <div class="eyebrow">GTM 与里程碑</div><h2>用两个高信号入口，验证 C 端口碑与 B 端年约</h2>
      <div style="position:absolute;left:90px;right:90px;top:260px">
        <div style="display:grid;grid-template-columns:120px repeat(4,1fr);align-items:center;border-top:1px solid var(--grid)">
          <div style="padding:24px 0;font-size:20px;font-weight:760;color:var(--deep)">C 端</div>${['开源社区', '超级开发者', 'Relay / Pro', 'Studio / 生态'].map((x, i) => `<div style="padding:24px 20px;border-left:1px solid var(--grid);font-size:22px;font-weight:700;background:${i === 1 ? '#e3eee7' : 'transparent'}">${x}<span style="float:right;color:#7b817c">${i < 3 ? '→' : ''}</span></div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:120px repeat(4,1fr);align-items:center;border-top:1px solid var(--grid);border-bottom:1px solid var(--grid)">
          <div style="padding:24px 0;font-size:20px;font-weight:760;color:var(--blue)">B 端</div>${['创造营 / 高校', '设计伙伴', '标准产品包', '机构年约'].map((x, i) => `<div style="padding:24px 20px;border-left:1px solid var(--grid);font-size:22px;font-weight:700;background:${i === 1 ? '#e5eaed' : 'transparent'}">${x}<span style="float:right;color:#7b817c">${i < 3 ? '→' : ''}</span></div>`).join('')}
        </div>
        <div style="margin-top:76px;height:3px;background:linear-gradient(90deg,#b4b7b2 0 25%,#86aa94 25% 50%,#5dc98f 50% 75%,#173d2a 75% 100%)"></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:34px;margin-top:24px">
          ${[
            ['0–3 月', '体验与数据', '埋点 + 20 位深访'],
            ['4–6 月', '自然增长', '2–3 家设计伙伴'],
            ['7–12 月', '双轨付费', '个人订阅 + 机构试点'],
            ['13–24 月', '可重复增长', '机构年约 + 渠道 + 英文市场'],
          ]
            .map(
              ([t, a, b]) =>
                `<div><div style="font-size:15px;color:#7d817d">${t}</div><div style="font-size:25px;font-weight:760;margin-top:11px">${a}</div><div class="label" style="margin-top:10px">${b}</div></div>`
            )
            .join('')}
        </div>
      </div>
    </section>`,
  },
  {
    filename: '14-slide-founder.png',
    html: `<section class="slide stone">${miniBrand()}
      <div style="display:grid;grid-template-columns:46% 54%;gap:65px;height:100%;align-items:center">
        <div class="photo" style="height:690px"><img src="${founderPhoto}" style="object-position:center" alt="手工川 AI 分享现场"></div>
        <div>
          <div class="eyebrow">Founder–Product Fit</div><h2 style="font-size:50px">Yoda 是被真实工作流“撞”出来的</h2>
          <p class="sub" style="font-size:24px">创始人同时是第一重度用户、产品经理、开发者与首批渠道</p>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:44px;border-top:1px solid var(--grid);padding-top:28px">
            <div><div class="metric-sm">1,645</div><div class="label" style="margin-top:8px">main 提交</div></div><div><div class="metric-sm">73</div><div class="label" style="margin-top:8px">公开 Release</div></div><div><div class="metric-sm">31</div><div class="label" style="margin-top:8px">Agent Client</div></div>
          </div>
          <div style="margin-top:38px;border-top:1px solid var(--grid)">${['开发工具 × 内容创作 × AI 产品化', '用 Yoda 开发 Yoda，形成高频反馈闭环', '高校、商学院、开发者社区与训练营触点'].map((x) => `<div style="padding:15px 0;border-bottom:1px solid var(--grid);font-size:20px;font-weight:650">${x}</div>`).join('')}</div>
        </div>
      </div>
      <div class="foot" style="left:820px">提交数包含合并与协作者贡献，不等同于个人代码量或产品质量。照片：手工川 AI 分享现场。</div>
    </section>`,
  },
  {
    filename: '15-slide-fundraise.png',
    html: `<section class="slide">${miniBrand()}
      <div class="eyebrow">Financing</div><h2 style="font-size:52px">融资 200 万元，<br>验证“集成委托环境”能否形成可重复增长</h2>
      <p class="sub">或 30 万美元，出让 10% 股权；购买 18–24 个月验证窗口</p>
      <div style="position:absolute;left:90px;right:90px;top:315px;bottom:58px;display:grid;grid-template-columns:35% 65%;gap:70px">
        <div style="border-top:1px solid var(--grid);padding-top:22px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:17px;color:var(--muted)"><span>资金用途</span><span>18–24 个月验证窗口</span></div>
          <div style="display:grid;grid-template-columns:265px 1fr;align-items:center;margin-top:38px">
            <div style="width:248px;height:248px;border-radius:50%;background:conic-gradient(var(--deep) 0 60%,var(--green) 60% 90%,#b6b7b2 90% 100%);position:relative"><div style="position:absolute;inset:48px;border-radius:50%;background:var(--paper);display:flex;flex-direction:column;align-items:center;justify-content:center"><div class="metric-sm" style="font-size:65px">200</div><div style="font-size:20px;font-weight:700">万元</div></div></div>
            <div>${[
              ['60%', '#173d2a', '技术研发与产品体验'],
              ['30%', '#5dc98f', '市场推广'],
              ['10%', '#b6b7b2', '基础设施与运营'],
            ]
              .map(
                ([v, c, l]) =>
                  `<div style="display:grid;grid-template-columns:22px 52px 1fr;gap:8px;align-items:center;margin:22px 0"><span style="width:14px;height:14px;background:${c}"></span><b style="font-size:18px">${v}</b><span style="font-size:17px;line-height:1.35;color:var(--muted)">${l}</span></div>`
              )
              .join('')}</div>
          </div>
          <div style="margin-top:36px;border-top:1px solid var(--grid);padding-top:18px;font-size:18px;line-height:1.45;font-weight:680;color:var(--deep)">目标不是买时间，而是验证一套可重复的增长模型。</div>
        </div>
        <div style="border-top:1px solid var(--grid);padding-top:22px">
          <div style="font-size:17px;color:var(--muted)">本轮资金要回答四个问题</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;margin-top:14px;border-top:1px solid var(--grid)">${[
            ['01', '留存成立', '用户是否持续把真实任务交给 Yoda'],
            ['02', '个人付费成立', 'Relay / Pro 是否形成经常性收入'],
            ['03', '机构年约成立', '教育与团队产品能否标准化交付'],
            ['04', '增长效率可测量', '渠道、CAC、转化与毛利是否可复现'],
          ]
            .map(
              ([n, t, d], i) =>
                `<div style="min-height:100px;padding:${i % 2 === 0 ? '18px 28px 18px 0' : '18px 0 18px 28px'};border-bottom:1px solid var(--grid);${i % 2 === 1 ? 'border-left:1px solid var(--grid);' : ''}"><div style="display:flex;align-items:baseline;gap:14px"><span style="font-size:13px;color:#888">${n}</span><b style="font-size:21px">${t}</b></div><div style="margin:8px 0 0 36px;font-size:16px;line-height:1.35;color:var(--muted)">${d}</div></div>`
            )
            .join('')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:38px;margin-top:28px;padding-top:24px;border-top:1px solid var(--grid)">
            <div style="display:grid;grid-template-columns:150px 1fr;gap:20px;align-items:center">
              <img src="${yodaWebsiteQr}" alt="Yoda 官网二维码" style="display:block;width:150px;height:150px;background:white;border:1px solid var(--grid);padding:6px">
              <div><div style="font-size:21px;font-weight:750">Yoda 官网</div><div style="margin-top:8px;font-size:16px;line-height:1.45;color:var(--muted)">产品、文档与下载<br>yoda.lovstudio.ai</div></div>
            </div>
            <div style="display:grid;grid-template-columns:150px 1fr;gap:20px;align-items:center">
              <img src="${shougongchuanOfficialAccountQr}" alt="手工川公众号二维码" style="display:block;width:150px;height:150px;object-fit:cover;background:white;border:1px solid var(--grid);padding:6px">
              <div><div style="font-size:21px;font-weight:750">手工川公众号</div><div style="margin-top:8px;font-size:16px;line-height:1.45;color:var(--muted)">项目动态、文章<br>与持续联系</div></div>
            </div>
          </div>
        </div>
      </div>
    </section>`,
  },
];

if (slides.length !== 15) throw new Error(`Expected 15 slides, got ${slides.length}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});

for (const [index, slide] of slides.entries()) {
  await page.setContent(doc(slide.html), { waitUntil: 'load' });
  await page.screenshot({ path: path.join(deckDir, slide.filename), type: 'png' });
  stdout.write(`Rendered ${index + 1}/15 ${slide.filename}\n`);
}

await browser.close();
