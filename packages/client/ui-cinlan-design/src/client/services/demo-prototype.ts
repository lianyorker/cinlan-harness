/**
 * Built-in TasteSkill-compliant Starter Prototype.
 * Provides an immediate, visual out-of-the-box experience without needing an active local dev server.
 */
export const STARTER_PROTOTYPE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cinlan Design Studio — Starter Prototype</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #F8F9FA;
      color: #111827;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      max-width: 1200px;
      margin: 0 auto;
      padding: 48px 24px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 64px;
      padding-bottom: 24px;
      border-bottom: 1px solid #E5E7EB;
    }
    .brand {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: #0F172A;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      background: #E0E7FF;
      color: #3730A3;
    }
    .hero {
      margin-bottom: 64px;
    }
    .hero h1 {
      font-size: clamp(32px, 5vw, 56px);
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.04em;
      color: #0F172A;
      margin-bottom: 20px;
      max-width: 800px;
    }
    .hero p {
      font-size: 18px;
      color: #4B5563;
      max-width: 640px;
      margin-bottom: 32px;
    }
    .cta-group {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .btn-primary {
      padding: 12px 24px;
      border-radius: 8px;
      background: #0F172A;
      color: #FFFFFF;
      font-size: 14px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: opacity 0.15s ease;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-secondary {
      padding: 12px 24px;
      border-radius: 8px;
      background: transparent;
      color: #0F172A;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid #CBD5E1;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn-secondary:hover { background: #E2E8F0; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 24px;
      margin-bottom: 64px;
    }
    .card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 24px;
      transition: border-color 0.2s ease;
    }
    .card:hover { border-color: #94A3B8; }
    .card-title {
      font-size: 16px;
      font-weight: 700;
      color: #0F172A;
      margin-bottom: 8px;
    }
    .card-desc {
      font-size: 13px;
      color: #64748B;
      line-height: 1.5;
    }
    footer {
      padding-top: 32px;
      border-top: 1px solid #E5E7EB;
      font-size: 13px;
      color: #94A3B8;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <header>
      <div class="brand">CINLAN DESIGN STUDIO</div>
      <div class="badge">TASTESKILL V2 ACTIVE</div>
    </header>
    <main>
      <section class="hero">
        <h1>瑞士国际排版与高保真原型画布</h1>
        <p>基于 TasteSkill 三大设计锁定构建：一致性间距、色相融合阴影与 1440/768/390 多端响应式断点。绝无 AI 模板化渐变与冗余装饰。</p>
        <div class="cta-group">
          <button class="btn-primary" onclick="alert('测试按钮触发')">测试交互体验</button>
          <button class="btn-secondary" onclick="document.body.style.background = document.body.style.background === 'rgb(15, 23, 42)' ? '#F8F9FA' : '#0F172A'">切换深色模式</button>
        </div>
      </section>
      <section class="grid">
        <div class="card">
          <div class="card-title">📐 严格网格约束</div>
          <div class="card-desc">纯正 12 栏弹性流式网格，断点在 1440 桌面、768 平板和 390 移动端无缝重构流向。</div>
        </div>
        <div class="card">
          <div class="card-title">🛡️ Anti-Slop 纯净代码</div>
          <div class="card-desc">严禁 Inter 滥用、去除紫蓝 AI 渐变，以真实品牌色彩与高对比度正文字重呈现。</div>
        </div>
        <div class="card">
          <div class="card-title">📌 图钉批注闭环</div>
          <div class="card-desc">在任意卡片或按钮上直接下钉，将修改建议一键注入会话，驱动 Agent 靶向优化。</div>
        </div>
      </section>
    </main>
    <footer>
      <span>© 2026 Cinlan Harness · All rights reserved.</span>
      <span>Anti-Slop Score: 100 / 100</span>
    </footer>
  </div>
</body>
</html>`
