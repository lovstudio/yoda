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
  :root { --bg:#f7f5f0; --surface:#e9e9e6; --ink:#111111; --muted:#71717a; --green:#5dc98f; --deep:#1a3b2a; }
  * { box-sizing:border-box; }
  html, body { margin:0; width:1600px; height:900px; overflow:hidden; background:var(--bg); }
  body { font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Microsoft YaHei",sans-serif; color:var(--ink); }
  .slide { width:1600px; height:900px; position:relative; padding:76px 92px 70px; overflow:hidden; background:var(--bg); }
  .slide.gray { background:#efede8; }
  .brand { position:absolute; left:92px; top:62px; display:flex; gap:14px; align-items:center; color:#536057; font-size:19px; font-weight:700; letter-spacing:.14em; }
  .brand img { width:28px; height:28px; }
  .kicker { color:var(--deep); text-transform:uppercase; font-size:18px; font-weight:750; letter-spacing:.16em; margin-bottom:18px; }
  h1,h2,p { margin:0; }
  h1 { font-size:76px; line-height:1.06; letter-spacing:-.045em; max-width:1260px; font-weight:760; }
  h2 { font-size:54px; line-height:1.12; letter-spacing:-.035em; max-width:1320px; font-weight:760; }
  .sub { margin-top:20px; color:#444447; font-size:28px; line-height:1.45; max-width:1100px; font-weight:480; }
  .source { position:absolute; left:92px; right:92px; bottom:34px; color:#777772; font-size:17px; line-height:1.4; }
  .green { color:var(--deep); }
  .accent { color:#2d8f5f; }
  .dot { width:12px; height:12px; background:var(--green); border-radius:50%; display:inline-block; }
  .surface { background:var(--surface); border-radius:26px; }
  .line { height:2px; background:#c8c8c2; }
  .tag { display:inline-flex; align-items:center; min-height:38px; padding:6px 16px; border-radius:999px; background:#e2e1dc; color:#333; font-size:19px; font-weight:650; }
  .tag.green { background:#d9f0e2; color:#205a3d; }
  .arrow { color:#2d8f5f; font-size:36px; font-weight:800; }
  .big-number { font-size:118px; line-height:.9; font-weight:820; letter-spacing:-.065em; }
  .caption { color:var(--muted); font-size:20px; line-height:1.4; }
  .body-copy { font-size:28px; line-height:1.55; color:#333335; }
  .hero-center { height:100%; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; }
  .screen { overflow:hidden; border-radius:24px; border:1px solid #c9c9c3; background:#111; box-shadow:0 24px 60px rgba(17,17,17,.11); }
  .screen img { width:100%; height:100%; object-fit:cover; display:block; }
  .photo { overflow:hidden; border-radius:24px; background:#ddd; }
  .photo img { width:100%; height:100%; object-fit:cover; display:block; }
  .node { min-width:150px; min-height:66px; padding:17px 22px; border-radius:18px; background:#e7e6e1; display:flex; justify-content:center; align-items:center; text-align:center; font-size:24px; line-height:1.28; font-weight:650; }
  .node.active { background:var(--deep); color:white; }
  .node.highlight { background:#d9f0e2; color:#1d5539; }
  .quote { font-size:36px; line-height:1.4; font-weight:650; }
`;

function doc(content) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${content}</body></html>`;
}

function logoMark(size = 56) {
  return `<img src="${logo}" style="width:${size}px;height:${size}px" alt="Yoda">`;
}

const slides = [
  {
    filename: '01-slide-cover.png',
    html: `<section class="slide">
      <div class="hero-center" style="padding-bottom:30px">
        <div style="display:flex;align-items:center;gap:24px;margin-bottom:42px">${logoMark(72)}<span style="font-size:24px;font-weight:750;letter-spacing:.18em;color:#4f5f55">YODA</span></div>
        <h1 style="font-size:82px;max-width:1180px">超级开发者的<br><span class="green">AI Harness 工作台</span></h1>
        <p class="sub" style="font-size:32px;margin-top:30px">统一 Agent、上下文与交付，让 AI 真正进入持续创造</p>
        <div style="margin-top:78px;display:flex;align-items:center;gap:20px">
          <span class="tag">想法</span><span class="arrow">→</span><span class="tag green">驾驭 AI</span><span class="arrow">→</span><span class="tag">真实作品</span>
        </div>
      </div>
      <div style="position:absolute;right:92px;bottom:72px;text-align:right;color:#6f746f;font-size:18px;line-height:1.6">Your Orchestra of Delegated Agents<br>融资版 BP · 2026.07</div>
    </section>`,
  },
  {
    filename: '02-slide-ai-needs-harness.png',
    html: `<section class="slide">
      <div class="kicker">范式变化</div><h2>AI 已经会干活，<br>但人还缺一套<span class="accent">驾驭系统</span></h2>
      <p class="sub">从“与 AI 对话”到“让 AI 持续完成工作”，人的角色正在改变</p>
      <div style="position:absolute;left:92px;right:92px;bottom:118px;display:grid;grid-template-columns:1fr 90px 1fr 90px 1fr;align-items:center">
        <div class="surface" style="padding:38px"><div style="font-size:23px;color:#777;margin-bottom:16px">过去</div><div style="font-size:38px;font-weight:750">问一个问题</div><div class="caption" style="margin-top:14px">模型返回一次结果</div></div>
        <div class="arrow" style="text-align:center">→</div>
        <div class="surface" style="padding:38px"><div style="font-size:23px;color:#777;margin-bottom:16px">现在</div><div style="font-size:38px;font-weight:750">交付一个目标</div><div class="caption" style="margin-top:14px">Agent 持续执行任务</div></div>
        <div class="arrow" style="text-align:center">→</div>
        <div style="padding:38px;background:var(--deep);border-radius:26px;color:#fff"><div style="font-size:23px;color:#bfe7cf;margin-bottom:16px">下一步</div><div style="font-size:38px;font-weight:750">驾驭全过程</div><div style="color:#d8e9df;font-size:20px;margin-top:14px">目标 · 干预 · 审查 · 验收</div></div>
      </div>
    </section>`,
  },
  {
    filename: '03-slide-fragmented-work.png',
    html: `<section class="slide gray">
      <div class="kicker">用户问题</div><h2>工具越强，创作过程反而越碎片化</h2>
      <p class="sub">用户不是缺少 AI，而是在多个客户端、终端、文件与交付页面之间反复轮询</p>
      <div style="position:absolute;left:92px;right:92px;bottom:98px;height:420px">
        <div class="surface" style="position:absolute;left:0;top:14px;width:320px;height:150px;padding:28px"><div class="caption">Agent Client</div><div style="font-size:31px;font-weight:750;margin-top:15px">会话与 Prompt</div></div>
        <div class="surface" style="position:absolute;left:120px;bottom:0;width:330px;height:150px;padding:28px"><div class="caption">Terminal / IDE</div><div style="font-size:31px;font-weight:750;margin-top:15px">执行与文件</div></div>
        <div class="surface" style="position:absolute;right:120px;top:0;width:330px;height:150px;padding:28px"><div class="caption">Git / Diff</div><div style="font-size:31px;font-weight:750;margin-top:15px">变更与审查</div></div>
        <div class="surface" style="position:absolute;right:0;bottom:10px;width:320px;height:150px;padding:28px"><div class="caption">CI / Release</div><div style="font-size:31px;font-weight:750;margin-top:15px">验证与发布</div></div>
        <svg viewBox="0 0 1416 420" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"><path d="M310 90 C560 20 840 380 1120 80 M430 340 C700 160 950 250 1120 345" fill="none" stroke="#aaa9a3" stroke-width="3" stroke-dasharray="12 12"/></svg>
        <div style="position:absolute;left:548px;top:132px;width:320px;height:174px;border-radius:90px;background:#111;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center"><div style="font-size:38px;font-weight:760">创作者</div><div style="font-size:20px;color:#bbb;margin-top:10px">不停切换 · 重述 · 等待</div></div>
      </div>
    </section>`,
  },
  {
    filename: '04-slide-unified-workspace.png',
    html: `<section class="slide">
      <div style="display:grid;grid-template-columns:42% 58%;gap:58px;height:100%;align-items:center">
        <div><div class="kicker">产品是什么</div><h2 style="font-size:52px">Yoda 把 Agent、上下文与交付统一进一个工作台</h2><p class="sub">启动任务、观察过程、干预方向、Review 结果并继续迭代</p><div style="margin-top:36px" class="tag green">单 Agent 与多 Agent 都适用</div></div>
        <div>
          <div class="screen" style="height:440px"><img src="${productLaunch}" style="object-position:center" alt="Yoda 实际启动画面"></div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px"><div class="node">任务 / 会话</div><div class="node highlight">Harness 状态</div><div class="node">Diff / Review</div></div>
          <div class="caption" style="margin-top:12px">Yoda 实际启动画面 + 当前产品结构示意；未使用虚构客户界面</div>
        </div>
      </div>
    </section>`,
  },
  {
    filename: '05-slide-one-goal-many-modes.png',
    html: `<section class="slide gray">
      <div class="kicker">使用方式</div><h2>用户只需选择目标，不必管理 Agent 的技术复杂度</h2>
      <p class="sub">单 Agent、多 Agent 与 Agent 团队只是按任务选择的工作方式</p>
      <div style="position:absolute;left:92px;right:92px;bottom:130px;display:flex;align-items:center;justify-content:space-between;gap:20px">
        <div class="node active" style="width:210px;height:120px;font-size:31px">创作目标</div><div class="arrow">→</div>
        <div style="display:grid;grid-template-columns:repeat(2,190px);gap:16px"><div class="node">单 Agent</div><div class="node">Vibe Coding</div><div class="node">Build</div><div class="node">Agent 团队</div></div>
        <div class="arrow">→</div><div class="node highlight" style="width:230px;height:120px;font-size:31px">可验收作品</div>
      </div>
      <div style="position:absolute;left:525px;bottom:74px;color:#696965;font-size:22px">Yoda 的类别是 Harness 工作台，不是 Agent 团队产品</div>
    </section>`,
  },
  {
    filename: '06-slide-before-after.png',
    html: `<section class="slide">
      <div class="kicker">用户价值</div><h2>从多个窗口轮询，到一个可控的交付闭环</h2>
      <p class="sub">同一项任务，从启动、观察、干预到 Review 与发布保持连续</p>
      <div style="position:absolute;left:92px;right:92px;bottom:92px;display:grid;grid-template-columns:1fr 90px 1fr;align-items:center">
        <div class="surface" style="height:390px;padding:38px"><div style="font-size:23px;color:#777;margin-bottom:24px">BEFORE</div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px"><div class="node">终端</div><div class="node">IDE</div><div class="node">Agent</div><div class="node">Git / CI</div></div><div style="font-size:27px;font-weight:700;margin-top:30px">切换、重述、等待、手工拼接</div></div>
        <div class="arrow" style="text-align:center">→</div>
        <div style="height:390px;padding:38px;border-radius:26px;background:var(--deep);color:white"><div style="font-size:23px;color:#bfe7cf;margin-bottom:24px">AFTER</div><div style="display:flex;gap:8px;align-items:center;margin-top:65px"><span class="tag">目标</span><span>→</span><span class="tag">会话</span><span>→</span><span class="tag">Review</span><span>→</span><span class="tag">发布</span></div><div style="font-size:29px;font-weight:700;margin-top:48px">一个工作区，连续掌握全过程</div></div>
      </div>
    </section>`,
  },
  {
    filename: '07-slide-harness-core.png',
    html: `<section class="slide gray">
      <div class="kicker">产品核心</div><h2>Harness 才是 Yoda 的产品核心</h2>
      <p class="sub">让 AI 的目标、能力、上下文、过程和结果都可以被人理解、控制与复用</p>
      <div style="position:absolute;left:140px;right:140px;bottom:90px;display:grid;gap:18px">
        <div style="height:96px;border-radius:22px;background:#111;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 44px"><span style="font-size:30px;font-weight:720">人的目标与判断</span><span style="font-size:22px;color:#bbb">方向 · 品味 · 验收</span></div>
        <div style="height:150px;border-radius:22px;background:#d9f0e2;padding:28px 34px"><div style="font-size:20px;font-weight:750;color:#246244;margin-bottom:18px">YODA HARNESS</div><div style="display:flex;justify-content:space-between;font-size:25px;font-weight:670"><span>Session</span><span>Skills</span><span>Hooks</span><span>Memory</span><span>Review</span><span>CI/CD</span></div></div>
        <div style="height:96px;border-radius:22px;background:#deddd8;display:flex;align-items:center;justify-content:space-between;padding:0 44px"><span style="font-size:28px;font-weight:720">Agent 执行</span><span class="arrow">→</span><span style="font-size:28px;font-weight:720">可继续迭代的作品</span></div>
      </div>
    </section>`,
  },
  {
    filename: '08-slide-provider-neutral.png',
    html: `<section class="slide">
      <div class="kicker">技术壁垒</div><h2>31 种 Agent Client，让 Yoda 成为供应商中立的控制层</h2>
      <p class="sub">用户可以更换模型和客户端，但持续保留自己的工作方式与 Harness 资产</p>
      <div style="position:absolute;left:120px;right:120px;bottom:88px;display:grid;gap:16px;text-align:center">
        <div style="display:flex;justify-content:center;gap:18px"><div class="node">Claude Code</div><div class="node">Codex</div><div class="node">Gemini</div><div class="node">OpenCode</div><div class="node">+27</div></div>
        <div class="arrow">↓</div>
        <div style="height:108px;border-radius:22px;background:var(--deep);color:white;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:780">Yoda Harness · 统一命令、事件、会话与状态</div>
        <div class="arrow">↓</div>
        <div style="display:flex;justify-content:center;gap:18px"><div class="node highlight">Diff</div><div class="node highlight">Test</div><div class="node highlight">CI/CD</div><div class="node highlight">Release</div></div>
      </div>
      <div class="source">31 种 Agent Client：按 Yoda 仓库截至 2026-07-22 的当前统计口径。</div>
    </section>`,
  },
  {
    filename: '09-slide-why-now.png',
    html: `<section class="slide gray">
      <div class="kicker">Why Now</div><h2>模型商品化与创作者扩张，让 Harness 迎来窗口期</h2>
      <div style="position:absolute;left:92px;right:92px;top:300px;bottom:110px;display:grid;grid-template-columns:1fr 1px 1fr;gap:58px;align-items:center">
        <div><div class="big-number">75<span style="font-size:58px">%</span></div><div class="quote" style="margin-top:24px">创意 AI 已融入或成为工作流必要部分</div></div>
        <div style="height:300px;background:#c7c6c0"></div>
        <div><div class="big-number accent">85<span style="font-size:58px">%</span></div><div class="quote" style="margin-top:24px">最终创意决策仍应由人完成</div></div>
      </div>
      <div class="source">来源：Adobe 2026 Creators’ Toolkit Report。结论：AI 执行，人负责驾驭与品味。</div>
    </section>`,
  },
  {
    filename: '10-slide-market-entry.png',
    html: `<section class="slide">
      <div style="display:grid;grid-template-columns:48% 52%;height:100%;align-items:center">
        <div><div class="kicker">目标市场</div><h2>超级开发者是入口，所有 AI 原生创作者是终局</h2><p class="sub">市场边界不由“会不会编程”决定，而由“是否持续驾驭 AI 完成真实成果”决定</p></div>
        <div style="position:relative;height:650px">
          <div style="position:absolute;width:590px;height:590px;border-radius:50%;background:#e7e5df;right:5px;top:30px;display:flex;justify-content:center;align-items:flex-start;padding-top:70px;font-size:27px;font-weight:720">AI 原生创造者与组织</div>
          <div style="position:absolute;width:410px;height:410px;border-radius:50%;background:#d9f0e2;right:95px;top:120px;display:flex;justify-content:center;align-items:flex-start;padding-top:66px;font-size:26px;font-weight:720;color:#245d40">创作者 · Coding 用户 · 团队</div>
          <div style="position:absolute;width:230px;height:230px;border-radius:50%;background:var(--deep);right:185px;top:210px;color:white;display:flex;justify-content:center;align-items:center;text-align:center;font-size:30px;font-weight:780">超级<br>开发者</div>
        </div>
      </div>
    </section>`,
  },
  {
    filename: '11-slide-market-size.png',
    html: `<section class="slide gray">
      <div class="kicker">市场规模</div><h2>创作者工具市场提供 248 亿美元理论 TAM</h2>
      <p class="sub">先从 AI 原生创作者切入，再用真实付费持续校准市场边界</p>
      <div style="position:absolute;left:92px;right:92px;top:340px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
        <div class="surface" style="padding:36px;height:330px"><div class="caption">理论上限 · TAM</div><div style="font-size:64px;font-weight:820;margin-top:28px">248 亿美元</div><div class="body-copy" style="font-size:23px;margin-top:28px">2.07 亿创作者 × 120 美元年费</div></div>
        <div class="surface" style="padding:36px;height:330px"><div class="caption">近期适配 · SAM</div><div style="font-size:64px;font-weight:820;margin-top:28px">24.8 亿美元</div><div class="body-copy" style="font-size:23px;margin-top:28px">TAM × 10% 适配率</div></div>
        <div style="padding:36px;height:330px;border-radius:26px;background:var(--deep);color:#fff"><div style="font-size:20px;color:#bfe7cf">三年目标 · SOM</div><div style="font-size:64px;font-weight:820;margin-top:28px">240 万美元</div><div style="font-size:23px;margin-top:28px;color:#dce9e1">2 万付费账户 × 120 美元 ARR</div></div>
      </div>
      <div class="source">来源：Visa 2025 Creator Report。10% 适配率、120 美元年费与三年 SOM 均为待验证假设或经营目标，不代表当前收入。</div>
    </section>`,
  },
  {
    filename: '12-slide-competition.png',
    html: `<section class="slide">
      <div class="kicker">竞争边界</div><h2>Yoda 不与模型或 Agent 团队正面竞争</h2>
      <p class="sub">模型和 Agent 是执行能力，Yoda 是跨工具组织工作与积累资产的 Harness 层</p>
      <div style="position:absolute;left:170px;right:170px;bottom:92px;display:grid;gap:18px">
        <div style="height:118px;background:var(--deep);color:#fff;border-radius:24px;padding:26px 38px;display:flex;align-items:center;justify-content:space-between"><span style="font-size:34px;font-weight:780">Yoda Harness</span><span style="font-size:24px;color:#c9e9d6">上下文 · 流程 · 治理 · 交付</span></div>
        <div style="height:118px;background:#deddd8;border-radius:24px;padding:26px 38px;display:flex;align-items:center;justify-content:space-between"><span style="font-size:31px;font-weight:760">执行方式</span><span style="font-size:24px">Agent IDE / CLI · 云端 Agent · Agent 团队</span></div>
        <div style="height:118px;background:#eceae5;border-radius:24px;padding:26px 38px;display:flex;align-items:center;justify-content:space-between"><span style="font-size:31px;font-weight:760">模型与算力</span><span style="font-size:24px">GPT · Claude · Codex · MaaS</span></div>
      </div>
    </section>`,
  },
  {
    filename: '13-slide-dual-business-model.png',
    html: `<section class="slide gray">
      <div class="kicker">商业模式</div><h2>C 端口碑与 B 端年约，共用同一套 Harness 底座</h2>
      <p class="sub">个人用户提供反馈与传播，机构客户提供更高客单价与稳定年度收入</p>
      <div style="position:absolute;left:92px;right:92px;top:320px;display:grid;grid-template-columns:1fr 1fr;gap:26px">
        <div class="surface" style="height:350px;padding:38px"><div style="font-size:25px;color:#555">C 端 / 团队</div><div style="font-size:36px;font-weight:780;margin-top:16px">开源口碑 → 经常性订阅</div><div class="body-copy" style="margin-top:34px">Desktop<br><span class="accent">↓</span> Relay / Creator Pro<br><span class="accent">↓</span> Studio / Marketplace</div></div>
        <div style="height:350px;padding:38px;border-radius:26px;background:var(--deep);color:#fff"><div style="font-size:25px;color:#bfe7cf">B 端 / 机构</div><div style="font-size:36px;font-weight:780;margin-top:16px">付费试点 → 机构年约</div><div style="font-size:28px;line-height:1.55;margin-top:34px">Education / Organization<br>↓ 部署 · 培训 · 维护<br>↓ 年度合同与 SLA</div></div>
      </div>
      <div class="source">Apache-2.0 下，收费点不是“允许二开”，而是官方产品化、部署治理、课程培训与持续服务。</div>
    </section>`,
  },
  {
    filename: '14-slide-education-wedge.png',
    html: `<section class="slide">
      <div style="display:grid;grid-template-columns:44% 56%;height:100%;gap:56px;align-items:center">
        <div class="photo" style="height:690px"><img src="${educationPhoto}" style="object-position:center 18%" alt="手工川 AI 创造营现场"></div>
        <div><div class="kicker">B 端切口</div><h2 style="font-size:52px">高校教育是最清晰的 B 端切口</h2><p class="sub">统一实践环境、课程资产、治理边界与持续支持</p>
          <div style="display:flex;align-items:center;gap:12px;margin-top:54px"><div class="node">付费试点</div><div class="arrow">→</div><div class="node highlight">标准产品包</div><div class="arrow">→</div><div class="node active">机构年约</div></div>
          <div class="body-copy" style="font-size:24px;margin-top:42px">一门课程 / 一个实验室 / 一期训练营起步<br>Yoda Education：桌面端 + 配置 + 课程模板 + 培训</div>
          <div class="caption" style="margin-top:28px">照片：手工川 AI 创造营 EP03。仅作培训场景与渠道证明，不是 Yoda 客户案例。</div>
        </div>
      </div>
    </section>`,
  },
  {
    filename: '15-slide-early-traction.png',
    html: `<section class="slide gray">
      <div class="kicker">早期进展</div><h2>产品已获得早期使用，付费验证仍在起点</h2>
      <p class="sub">当前数据证明有人下载、Clone 和授权，但尚不能证明留存与商业模式成立</p>
      <div style="position:absolute;left:92px;right:92px;top:330px;display:grid;grid-template-columns:62% 38%;gap:24px">
        <div class="surface" style="padding:34px;height:380px"><div class="caption">使用信号</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:34px"><div><div style="font-size:58px;font-weight:820">50</div><div class="caption">Stars</div></div><div><div style="font-size:58px;font-weight:820">73</div><div class="caption">公开 Release</div></div><div><div style="font-size:58px;font-weight:820">126</div><div class="caption">14 天独立 Cloner</div></div></div><div style="margin-top:50px;font-size:25px;font-weight:680">73 个独立授权用户 · 426 次 Clone</div></div>
        <div style="padding:34px;height:380px;border-radius:26px;background:#111;color:white"><div style="font-size:20px;color:#aaa">商业验证</div><div style="font-size:92px;font-weight:840;margin-top:22px">0<span style="font-size:28px;color:#bbb"> 付费</span></div><div style="font-size:27px;line-height:1.6;margin-top:20px">Relay：3 个试用账户<br>D7/D30 留存：待补<br>作品完成率：待补</div></div>
      </div>
      <div class="source">GitHub 数据截至 2026-07-22；账号与 Relay 数据截至 2026-07-21。Release 资产请求、Clone 与授权均不是去重活跃用户。</div>
    </section>`,
  },
  {
    filename: '16-slide-founder-product-fit.png',
    html: `<section class="slide">
      <div style="display:grid;grid-template-columns:45% 55%;height:100%;gap:58px;align-items:center">
        <div class="photo" style="height:650px"><img src="${founderPhoto}" style="object-position:center" alt="手工川 AI 分享现场"></div>
        <div><div class="kicker">Founder–Product Fit</div><h2 style="font-size:50px">Yoda 用 Yoda 开发自己，迭代速度就是第一份背书</h2><p class="sub">手工川长期横跨内容创作、开发工具与 AI 产品化</p>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:44px"><div class="surface" style="padding:24px"><div style="font-size:44px;font-weight:820">1,645</div><div class="caption">main 提交</div></div><div class="surface" style="padding:24px"><div style="font-size:44px;font-weight:820">73</div><div class="caption">公开 Release</div></div><div class="surface" style="padding:24px"><div style="font-size:44px;font-weight:820">31</div><div class="caption">Agent Client</div></div></div>
          <div class="body-copy" style="font-size:24px;margin-top:34px">第一重度用户 · 第一产品经理 · 第一增长渠道<br>高校、商学院、开发者社区与孵化器触点</div>
        </div>
      </div>
      <div class="source">提交数包含合并和协作者贡献，不等同于个人代码量或产品质量。照片：手工川 AI 创造营分享现场。</div>
    </section>`,
  },
  {
    filename: '17-slide-milestones.png',
    html: `<section class="slide gray">
      <div class="kicker">18–24 个月</div><h2>只做一件事：验证可重复增长</h2>
      <p class="sub">前三个月先把体验和数据做实，再逐步增加推广、付费与机构交付</p>
      <div style="position:absolute;left:72px;right:72px;top:330px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
        ${[
          ['0–3 月', '体验与埋点', '20 位用户访谈'],
          ['4–6 月', '自然增长', '2–3 家设计伙伴'],
          ['7–9 月', '双轨付费', '机构付费试点'],
          ['10–12 月', '聚焦场景', '产品化机构共性'],
          ['13–15 月', '商业闭环', 'Studio 与机构年约'],
          ['16–18 月', '扩大渠道', '英文市场验证'],
          ['19–21 月', 'Harness 生态', '可复制交付伙伴'],
          ['22–24 月', '规模证明', '增长效率与毛利'],
        ]
          .map(
            ([m, t, d], i) =>
              `<div style="height:150px;padding:22px;border-radius:22px;background:${i === 3 || i === 7 ? '#1a3b2a' : '#e5e3de'};color:${i === 3 || i === 7 ? 'white' : '#111'}"><div style="font-size:18px;color:${i === 3 || i === 7 ? '#bfe7cf' : '#777'}">${m}</div><div style="font-size:28px;font-weight:780;margin-top:13px">${t}</div><div style="font-size:19px;margin-top:10px;color:${i === 3 || i === 7 ? '#dce9e1' : '#666'}">${d}</div></div>`
          )
          .join('')}
      </div>
      <div style="position:absolute;left:92px;right:92px;bottom:84px;display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center;font-size:23px;font-weight:720"><div style="border-top:5px solid #b9b8b2;padding-top:18px">产品成立</div><div style="border-top:5px solid var(--green);padding-top:18px">商业成立</div><div style="border-top:5px solid var(--deep);padding-top:18px">规模成立</div></div>
    </section>`,
  },
  {
    filename: '18-slide-back-cover.png',
    html: `<section class="slide">
      <div class="brand">${logoMark(30)} YODA · FINANCING</div>
      <div style="display:grid;grid-template-columns:48% 52%;height:100%;align-items:center;gap:50px">
        <div><div class="caption" style="font-size:24px;margin-bottom:24px">本轮融资</div><div class="big-number" style="font-size:152px">200<span style="font-size:54px"> 万元</span></div><div style="font-size:30px;font-weight:680;margin-top:26px">或 30 万美元 · 出让 10% 股权</div></div>
        <div><h2 style="font-size:50px">购买 18–24 个月的验证窗口</h2><p class="sub" style="font-size:26px">验证留存、个人付费与机构年约能否形成可重复增长</p><div style="margin-top:52px;display:grid;gap:16px"><div style="display:grid;grid-template-columns:90px 1fr;gap:16px;align-items:center"><b style="font-size:26px">60%</b><div style="height:20px;border-radius:10px;background:var(--deep)"></div></div><div style="display:grid;grid-template-columns:90px 1fr;gap:16px;align-items:center"><b style="font-size:26px">30%</b><div style="height:20px;width:50%;border-radius:10px;background:var(--green)"></div></div><div style="display:grid;grid-template-columns:90px 1fr;gap:16px;align-items:center"><b style="font-size:26px">10%</b><div style="height:20px;width:17%;border-radius:10px;background:#b9b8b2"></div></div></div><div class="caption" style="margin-top:18px">技术研发与体验 · 市场推广 · 基础设施与运营</div></div>
      </div>
      <div style="position:absolute;left:92px;bottom:62px;font-size:21px;font-weight:700;letter-spacing:.08em">YODA.LOVSTUDIO.AI</div>
    </section>`,
  },
];

if (slides.length !== 18) throw new Error(`Expected 18 slides, got ${slides.length}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});

for (const [index, slide] of slides.entries()) {
  await page.setContent(doc(slide.html), { waitUntil: 'load' });
  await page.screenshot({ path: path.join(deckDir, slide.filename), type: 'png' });
  stdout.write(`Rendered ${index + 1}/18 ${slide.filename}\n`);
}

await browser.close();
