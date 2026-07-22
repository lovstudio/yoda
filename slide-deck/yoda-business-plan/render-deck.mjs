import fs from 'node:fs';
import path from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const deckDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(deckDir, '../..');

function dataUri(filePath, mime) {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

const logo = dataUri(path.join(repoRoot, 'docs/public/yoda-mark.svg'), 'image/svg+xml');
const productLaunch = dataUri('/Users/mark/lovstudio/products/yoda/demo.png', 'image/png');
const educationPhoto = dataUri(
  '/Users/mark/lovstudio/vault/profile/album/work/2026-05-22-手工川 AI 创造营 EP03.JPG',
  'image/jpeg'
);
const founderPhoto = dataUri(
  '/Users/mark/lovstudio/vault/profile/album/work/2026-04-26-手工川是如何使用AI的.jpg',
  'image/jpeg'
);

const css = `
  :root { --paper:#f7f6f2; --pale:#efeee9; --ink:#111111; --muted:#62645f; --line:#d7d6d0; --green:#5dc98f; --deep:#173d2a; }
  * { box-sizing:border-box; }
  html,body { margin:0; width:1600px; height:900px; overflow:hidden; background:var(--paper); }
  body { font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Microsoft YaHei",sans-serif; color:var(--ink); }
  .slide { position:relative; width:1600px; height:900px; overflow:hidden; padding:70px 90px 64px; background:var(--paper); }
  .slide.pale { background:var(--pale); }
  h1,h2,p { margin:0; }
  h1 { font-size:78px; line-height:1.06; letter-spacing:-.045em; font-weight:780; }
  h2 { max-width:1320px; font-size:58px; line-height:1.12; letter-spacing:-.035em; font-weight:760; }
  .sub { margin-top:18px; max-width:1180px; color:#454743; font-size:27px; line-height:1.45; font-weight:500; }
  .eyebrow { margin-bottom:18px; color:var(--deep); font-size:17px; font-weight:760; letter-spacing:.15em; text-transform:uppercase; }
  .brand { display:flex; align-items:center; gap:14px; color:#526057; font-size:20px; font-weight:760; letter-spacing:.16em; }
  .brand img { width:30px; height:30px; }
  .muted { color:var(--muted); }
  .accent { color:#277b52; }
  .hairline { height:1px; background:var(--line); }
  .vline { width:1px; background:var(--line); align-self:stretch; }
  .metric { font-size:82px; line-height:.95; font-weight:820; letter-spacing:-.055em; }
  .metric-label { margin-top:14px; color:var(--muted); font-size:22px; line-height:1.35; }
  .body { color:#30322f; font-size:27px; line-height:1.55; }
  .note { color:#777872; font-size:16px; line-height:1.45; }
  .foot { position:absolute; left:90px; right:90px; bottom:28px; color:#777872; font-size:15px; line-height:1.4; }
  .screen { overflow:hidden; border:1px solid #c9c8c2; border-radius:14px; background:#111; box-shadow:0 20px 45px rgba(18,22,19,.08); }
  .screen img,.photo img { width:100%; height:100%; display:block; object-fit:cover; }
  .photo { overflow:hidden; background:#ddd; }
  .stage { font-size:25px; font-weight:720; }
  .stage-small { margin-top:12px; color:var(--muted); font-size:20px; line-height:1.42; }
`;

function doc(content) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${content}</body></html>`;
}

function mark(size = 56) {
  return `<img src="${logo}" style="width:${size}px;height:${size}px" alt="Yoda">`;
}

const slides = [
  {
    filename: '01-slide-cover.png',
    html: `<section class="slide">
      <div class="brand">${mark(34)} YODA</div>
      <div style="position:absolute;left:90px;top:220px;width:980px">
        <h1>超级开发者的<br><span style="color:var(--deep)">AI Harness 工作台</span></h1>
        <p class="sub" style="margin-top:30px;font-size:31px">统一 Agent、上下文与交付，让 AI 真正进入持续创造</p>
      </div>
      <div style="position:absolute;right:92px;top:210px;width:270px;height:460px;border-left:1px solid var(--line);padding-left:34px;display:flex;flex-direction:column;justify-content:space-between">
        <div><div class="note">01</div><div style="font-size:28px;font-weight:700;margin-top:10px">想法</div></div>
        <div><div class="note">02</div><div style="font-size:28px;font-weight:700;margin-top:10px;color:#277b52">驾驭 AI</div></div>
        <div><div class="note">03</div><div style="font-size:28px;font-weight:700;margin-top:10px">真实作品</div></div>
      </div>
      <div style="position:absolute;left:90px;bottom:58px;color:#777872;font-size:17px">融资版 BP · 2026.07</div>
    </section>`,
  },
  {
    filename: '02-slide-problem.png',
    html: `<section class="slide pale">
      <div class="eyebrow">用户问题</div><h2>AI 能写代码，但创造过程仍被工具切碎</h2>
      <p class="sub">同一项任务，需要在 Agent、终端、文件、Git 和发布页面之间反复切换</p>
      <div style="position:absolute;left:90px;right:90px;top:350px">
        <div style="display:grid;grid-template-columns:repeat(5,1fr);align-items:center">
          ${['Agent', '终端 / IDE', '文件与上下文', 'Git / Review', 'CI / 发布']
            .map(
              (label, index) =>
                `<div style="position:relative;border-top:2px solid ${index === 2 ? '#173d2a' : '#b9b8b2'};padding-top:24px;font-size:25px;font-weight:700"><span style="position:absolute;top:-7px;left:0;width:12px;height:12px;border-radius:50%;background:${index === 2 ? '#173d2a' : '#b9b8b2'}"></span>${label}</div>`
            )
            .join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:48px;margin-top:110px">
          <div style="border-left:1px solid var(--line);padding-left:24px"><div class="stage">上下文反复重述</div><div class="stage-small">每次切换都要重新解释目标和状态</div></div>
          <div style="border-left:1px solid var(--line);padding-left:24px"><div class="stage">过程难以干预</div><div class="stage-small">人仍需盯守，但缺少友好的控制面</div></div>
          <div style="border-left:1px solid var(--line);padding-left:24px"><div class="stage">经验无法复用</div><div class="stage-small">Prompt、Skills 与工作流散落各处</div></div>
        </div>
      </div>
      <div style="position:absolute;left:90px;bottom:55px;font-size:27px;font-weight:740;color:var(--deep)">不是 AI 不够强，是工作流没有跟上。</div>
    </section>`,
  },
  {
    filename: '03-slide-solution.png',
    html: `<section class="slide">
      <div class="eyebrow">解决方案</div><h2>Yoda 把整个 AI 创造过程放进一个工作台</h2>
      <p class="sub">从目标、执行到 Review 与发布，用户始终掌握上下文和方向</p>
      <div style="position:absolute;left:110px;right:110px;top:410px">
        <div style="height:3px;background:var(--deep)"></div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);margin-top:-11px">
          ${['目标', '会话', '干预', 'Review', '交付']
            .map(
              (label, index) =>
                `<div style="text-align:${index === 0 ? 'left' : index === 4 ? 'right' : 'center'}"><span style="display:inline-block;width:19px;height:19px;border-radius:50%;background:${index === 4 ? '#5dc98f' : '#173d2a'};border:4px solid var(--paper)"></span><div style="font-size:30px;font-weight:760;margin-top:28px">${label}</div></div>`
            )
            .join('')}
        </div>
        <div style="margin-top:100px;border-top:1px solid var(--line);padding-top:26px;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:26px;font-weight:760;color:var(--deep)">Yoda Harness Workspace</div>
          <div style="font-size:22px;color:var(--muted)">同一上下文 · 连续观察 · 随时修正 · 可验收结果</div>
        </div>
      </div>
    </section>`,
  },
  {
    filename: '04-slide-product-experience.png',
    html: `<section class="slide">
      <div style="display:grid;grid-template-columns:39% 61%;gap:70px;height:100%;align-items:center">
        <div>
          <div class="eyebrow">核心体验</div><h2 style="font-size:55px">一个入口，完成一次可控的 AI 交付</h2>
          <div style="margin-top:48px;border-top:1px solid var(--line)">
            ${['启动任务', '观察过程', '修正方向', '验收结果']
              .map(
                (label, index) =>
                  `<div style="display:grid;grid-template-columns:48px 1fr;align-items:center;border-bottom:1px solid var(--line);padding:18px 0"><span class="note">0${index + 1}</span><span style="font-size:27px;font-weight:700">${label}</span></div>`
              )
              .join('')}
          </div>
          <div style="margin-top:30px;font-size:22px;color:var(--deep);font-weight:680">单 Agent 与多 Agent 都适用</div>
        </div>
        <div>
          <div class="screen" style="height:460px"><img src="${productLaunch}" alt="Yoda 实际启动画面"></div>
          <div class="note" style="margin-top:16px">Yoda 实际启动画面。当前工作区需要账户授权，因此本页不使用虚构主界面。</div>
        </div>
      </div>
    </section>`,
  },
  {
    filename: '05-slide-harness.png',
    html: `<section class="slide pale">
      <div class="eyebrow">产品核心</div><h2>Harness 让 AI 的工作过程可控、可复用、可迁移</h2>
      <p class="sub">31 种 Agent Client 之上，Yoda 统一会话、能力、上下文与交付</p>
      <div style="position:absolute;left:120px;right:120px;top:360px">
        <div style="display:flex;justify-content:space-between;padding:0 18px 24px;color:#3d403c;font-size:22px;font-weight:680"><span>Claude Code</span><span>Codex</span><span>Gemini</span><span>OpenCode</span><span>+27 Clients</span></div>
        <div style="height:118px;background:var(--deep);color:white;display:flex;align-items:center;justify-content:space-around;padding:0 40px">
          <span style="font-size:19px;letter-spacing:.12em;color:#bde8ce">YODA HARNESS</span><span style="font-size:24px;font-weight:700">Session</span><span style="font-size:24px;font-weight:700">Skills</span><span style="font-size:24px;font-weight:700">Hooks</span><span style="font-size:24px;font-weight:700">Memory</span><span style="font-size:24px;font-weight:700">Review</span><span style="font-size:24px;font-weight:700">CI/CD</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:26px 70px 0;color:#3d403c;font-size:23px;font-weight:700"><span>Diff</span><span>Test</span><span>Release</span><span>可继续迭代的作品</span></div>
      </div>
      <div class="foot">31 种 Agent Client：按 Yoda 仓库截至 2026-07-22 的统计口径。</div>
    </section>`,
  },
  {
    filename: '06-slide-why-now.png',
    html: `<section class="slide">
      <div class="eyebrow">Why Now</div><h2>AI 执行能力正在商品化，驾驭能力成为新的价值层</h2>
      <div style="position:absolute;left:90px;right:90px;top:340px;bottom:130px;display:grid;grid-template-columns:1fr 1px 1fr;gap:72px;align-items:center">
        <div><div class="metric" style="font-size:132px">75<span style="font-size:58px">%</span></div><div style="font-size:28px;line-height:1.4;font-weight:650;margin-top:26px">创意 AI 已融入或成为<br>工作流必要部分</div></div>
        <div class="vline"></div>
        <div><div class="metric accent" style="font-size:132px">85<span style="font-size:58px">%</span></div><div style="font-size:28px;line-height:1.4;font-weight:650;margin-top:26px">最终创意决策<br>仍应由人完成</div></div>
      </div>
      <div style="position:absolute;left:90px;bottom:56px;font-size:27px;font-weight:740;color:var(--deep)">AI 执行，人负责方向、判断与品味。</div>
      <div class="foot" style="left:auto;right:90px;text-align:right">来源：Adobe 2026 Creators’ Toolkit Report。</div>
    </section>`,
  },
  {
    filename: '07-slide-traction.png',
    html: `<section class="slide pale">
      <div class="eyebrow">真实验证</div><h2>已有真实使用信号，付费验证仍在起点</h2>
      <p class="sub">当前数据证明有人下载、Clone 和授权，但不能替代留存与收入</p>
      <div style="position:absolute;left:90px;right:90px;top:360px;display:grid;grid-template-columns:repeat(4,1fr) 1.08fr;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
        ${[
          ['126', '14 天独立 Cloner'],
          ['73', '独立授权用户'],
          ['73', '公开 Release'],
          ['3', 'Relay 试用账户'],
        ]
          .map(
            ([value, label]) =>
              `<div style="padding:42px 24px 45px 0"><div class="metric">${value}</div><div class="metric-label">${label}</div></div>`
          )
          .join('')}
        <div style="background:#171817;color:white;padding:40px 30px"><div class="metric">0</div><div style="font-size:24px;margin-top:14px">付费用户</div><div style="font-size:18px;line-height:1.45;color:#bcbdb9;margin-top:22px">下一阶段核心验证：<br>留存、个人付费、机构年约</div></div>
      </div>
      <div class="foot">GitHub 数据截至 2026-07-22；账号与 Relay 数据截至 2026-07-21。Clone、授权与 Release 均不是去重活跃用户。</div>
    </section>`,
  },
  {
    filename: '08-slide-business-model.png',
    html: `<section class="slide">
      <div style="display:grid;grid-template-columns:54% 46%;gap:60px;height:100%;align-items:center">
        <div>
          <div class="eyebrow">商业模式</div><h2 style="font-size:52px">C 端验证产品，<br>B 端教育放大客单价</h2>
          <p class="sub" style="font-size:25px">个人订阅与机构年约共享同一套 Harness 底座</p>
          <div style="margin-top:52px;border-top:1px solid var(--line)">
            <div style="display:grid;grid-template-columns:150px 1fr;padding:25px 0;border-bottom:1px solid var(--line)"><b style="font-size:22px;color:var(--deep)">C 端</b><div style="font-size:24px;font-weight:680">Desktop → Relay / Creator Pro → Studio</div></div>
            <div style="display:grid;grid-template-columns:150px 1fr;padding:25px 0;border-bottom:1px solid var(--line)"><b style="font-size:22px;color:var(--deep)">B 端</b><div style="font-size:24px;font-weight:680">付费试点 → Education 产品包 → 机构年约</div></div>
          </div>
          <div class="note" style="margin-top:24px">收费来自产品化、部署治理、课程培训与持续服务，而不是“允许二开”。</div>
        </div>
        <div>
          <div class="photo" style="height:560px"><img src="${educationPhoto}" style="object-position:center 18%" alt="手工川 AI 创造营现场"></div>
          <div class="note" style="margin-top:14px">手工川 AI 创造营 EP03：仅证明培训场景与渠道触点，不是 Yoda 客户案例。</div>
        </div>
      </div>
    </section>`,
  },
  {
    filename: '09-slide-market.png',
    html: `<section class="slide pale">
      <div class="eyebrow">市场与切入</div><h2>从超级开发者切入一个 248 亿美元创作者工具市场</h2>
      <p class="sub">先服务高频 Coding 创作者，再扩展到 AI 原生个人与团队</p>
      <div style="position:absolute;left:90px;right:90px;top:330px;bottom:90px;display:grid;grid-template-columns:46% 54%;align-items:center">
        <div style="position:relative;height:450px">
          <div style="position:absolute;width:420px;height:420px;border-radius:50%;border:1px solid #bfc0ba;left:55px;top:15px"></div>
          <div style="position:absolute;width:300px;height:300px;border-radius:50%;border:1px solid #8cae9a;left:115px;top:75px"></div>
          <div style="position:absolute;width:178px;height:178px;border-radius:50%;background:var(--deep);color:white;left:176px;top:136px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:25px;font-weight:760">超级<br>开发者</div>
          <div style="position:absolute;left:362px;top:92px;font-size:20px;color:#456653">Coding 创作者</div>
          <div style="position:absolute;left:432px;top:22px;font-size:20px;color:var(--muted)">AI 原生个人与团队</div>
        </div>
        <div style="border-left:1px solid var(--line);padding-left:70px">
          ${[
            ['248 亿美元', 'TAM · 2.07 亿创作者 × 120 美元年费'],
            ['24.8 亿美元', 'SAM · 假设 10% 适配率'],
            ['240 万美元', '三年 SOM · 2 万账户 × 120 美元 ARR'],
          ]
            .map(
              ([value, label], index) =>
                `<div style="padding:${index === 0 ? '0 0 27px' : '27px 0'};border-bottom:${index === 2 ? '0' : '1px solid var(--line)'}"><div style="font-size:49px;font-weight:790;color:${index === 2 ? '#277b52' : '#111'}">${value}</div><div class="note" style="font-size:17px;margin-top:8px">${label}</div></div>`
            )
            .join('')}
        </div>
      </div>
      <div class="foot">来源：Visa 2025 Creator Report。SAM、年费与三年 SOM 为待验证假设或经营目标，不代表当前收入。</div>
    </section>`,
  },
  {
    filename: '10-slide-differentiation.png',
    html: `<section class="slide">
      <div class="eyebrow">竞争与差异化</div><h2>Yoda 不卷模型，也不把 Agent 团队当产品终局</h2>
      <p class="sub">Yoda 占据跨客户端组织工作、沉淀资产与完成交付的 Harness 层</p>
      <div style="position:absolute;left:100px;right:100px;top:350px;display:grid;grid-template-columns:55% 45%;gap:80px">
        <div>
          <div style="height:94px;border:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 30px;font-size:23px"><b>模型与算力</b><span class="muted">GPT · Claude · MaaS</span></div>
          <div style="height:94px;border-left:1px solid var(--line);border-right:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 30px;font-size:23px"><b>Agent 执行方式</b><span class="muted">CLI · IDE · 团队</span></div>
          <div style="height:112px;background:var(--deep);color:white;display:flex;align-items:center;justify-content:space-between;padding:0 30px;font-size:25px"><b>Yoda Harness</b><span style="color:#c5e6d2">上下文 · 治理 · 交付</span></div>
        </div>
        <div style="border-top:1px solid var(--line)">
          ${[
            ['31 种 Agent Client', '供应商中立'],
            ['Skills · Memory · 工作流', '资产持续沉淀'],
            ['Review · Test · Release', '交付形成闭环'],
          ]
            .map(
              ([main, sub]) =>
                `<div style="padding:22px 0;border-bottom:1px solid var(--line)"><div style="font-size:25px;font-weight:720">${main}</div><div class="note" style="font-size:18px;margin-top:7px">${sub}</div></div>`
            )
            .join('')}
        </div>
      </div>
    </section>`,
  },
  {
    filename: '11-slide-growth.png',
    html: `<section class="slide pale">
      <div class="eyebrow">增长计划</div><h2>下一阶段只验证一件事：可重复增长</h2>
      <p class="sub">先做实体验与数据，再验证个人付费和机构年约</p>
      <div style="position:absolute;left:90px;right:90px;top:400px">
        <div style="height:3px;background:linear-gradient(90deg,#b7b8b2 0 25%,#7fa58d 25% 50%,#5dc98f 50% 75%,#173d2a 75% 100%)"></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:34px;margin-top:28px">
          ${[
            ['0–3 月', '体验与数据', '埋点 + 20 位深访'],
            ['4–6 月', '自然增长', '2–3 家设计伙伴'],
            ['7–12 月', '双轨付费', '个人订阅 + 机构试点'],
            ['13–24 月', '可重复增长', '机构年约 + 渠道 + 英文市场'],
          ]
            .map(
              ([time, title, proof]) =>
                `<div><div class="note" style="font-size:18px">${time}</div><div style="font-size:29px;font-weight:760;margin-top:14px">${title}</div><div style="font-size:21px;line-height:1.45;color:var(--muted);margin-top:14px">${proof}</div></div>`
            )
            .join('')}
        </div>
      </div>
      <div style="position:absolute;left:90px;bottom:62px;font-size:25px;font-weight:720;color:var(--deep)">产品成立 → 商业成立 → 规模成立</div>
    </section>`,
  },
  {
    filename: '12-slide-team.png',
    html: `<section class="slide">
      <div style="display:grid;grid-template-columns:47% 53%;gap:66px;height:100%;align-items:center">
        <div class="photo" style="height:680px"><img src="${founderPhoto}" alt="手工川 AI 分享现场"></div>
        <div>
          <div class="eyebrow">Founder–Product Fit</div><h2 style="font-size:52px">Yoda 用 Yoda 开发自己，迭代速度就是第一份背书</h2>
          <p class="sub" style="font-size:25px">创始人长期横跨开发工具、内容创作与 AI 产品化</p>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:52px;border-top:1px solid var(--line);padding-top:32px">
            <div><div class="metric" style="font-size:55px">1,645</div><div class="metric-label" style="font-size:18px">main 提交</div></div>
            <div><div class="metric" style="font-size:55px">73</div><div class="metric-label" style="font-size:18px">公开 Release</div></div>
            <div><div class="metric" style="font-size:55px">31</div><div class="metric-label" style="font-size:18px">Agent Client</div></div>
          </div>
        </div>
      </div>
      <div class="foot" style="left:850px">提交数包含合并与协作者贡献，不等同于个人代码量或产品质量。照片：手工川 AI 分享现场。</div>
    </section>`,
  },
  {
    filename: '13-slide-fundraise.png',
    html: `<section class="slide">
      <div class="brand">${mark(30)} YODA · FINANCING</div>
      <div style="position:absolute;left:90px;right:90px;top:210px;display:grid;grid-template-columns:48% 52%;gap:80px">
        <div>
          <div class="note" style="font-size:21px">本轮融资</div>
          <div class="metric" style="font-size:152px;margin-top:25px">200<span style="font-size:52px"> 万元</span></div>
          <div style="font-size:28px;font-weight:700;margin-top:28px">或 30 万美元 · 出让 10% 股权</div>
        </div>
        <div>
          <h2 style="font-size:48px">购买 18–24 个月的验证窗口</h2>
          <p class="sub" style="font-size:24px">验证留存、个人付费与机构年约能否形成可重复增长</p>
          <div style="margin-top:46px;border-top:1px solid var(--line)">
            ${[
              ['60%', '技术研发与产品体验', '100%'],
              ['30%', '市场推广', '50%'],
              ['10%', '基础设施与运营', '17%'],
            ]
              .map(
                ([value, label, width]) =>
                  `<div style="display:grid;grid-template-columns:75px 210px 1fr;gap:18px;align-items:center;padding:16px 0"><b style="font-size:23px">${value}</b><span style="font-size:20px;color:var(--muted)">${label}</span><div style="height:10px;background:#e2e1dc"><div style="height:10px;width:${width};background:${value === '60%' ? '#173d2a' : value === '30%' ? '#5dc98f' : '#aaa9a3'}"></div></div></div>`
              )
              .join('')}
          </div>
        </div>
      </div>
      <div style="position:absolute;left:90px;bottom:62px;font-size:18px;font-weight:750;letter-spacing:.1em">YODA.LOVSTUDIO.AI</div>
    </section>`,
  },
];

if (slides.length !== 13) throw new Error(`Expected 13 slides, got ${slides.length}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});

for (const [index, slide] of slides.entries()) {
  await page.setContent(doc(slide.html), { waitUntil: 'load' });
  await page.screenshot({ path: path.join(deckDir, slide.filename), type: 'png' });
  stdout.write(`Rendered ${index + 1}/13 ${slide.filename}\n`);
}

await browser.close();
