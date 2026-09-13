# Browser 原生迁移续批验收

日期：2026-09-13

## 结论

本批交付原生 Browser 的主页/搜索、Cookie JSON 导入、文件上传下载、页面访问记录、网络元数据，以及命名 profile 隔离。运行链路不调用 Orca。不是所有迁移项均已完成，也不等于 Browser 与 Orca 功能完全一致。

## 功能与代码位置

| 能力 | 原生实现 | 验收与限制 |
|---|---|---|
| 偏好保存 | browser-playwright + BrowserPreferencesForm | 保存/重启生效；非法主页拒绝并保留草稿，不把恢复读取误报为保存成功 |
| 主页/搜索 | resolveNavigation + browser_home/browser_search + Browser Remote | 实际 Chromium 导航；搜索响应由测试拦截为确定内容 |
| profile | profileName + Harness 专用子目录 | 同目录 Cookie 跨重启保留，另一 profile 中不存在；暂无清单、重命名、删除或逐 Tab 切换 |
| Cookie | api/browser-controller + Playwright addCookies | 只导入用户选择的 JSON 文件，最多 256 KiB；错误/回执不含 Cookie 值，不扫描其他浏览器数据库 |
| 访问记录 | BrowserAutomationProvider.history/back/forward | 当前打开页面的有界记录，不是跨重启的持久浏览历史 |
| 网络检查 | Playwright request/response/requestfailed | 有界 metadata，去除 URL 凭据、查询和片段；不含 headers/body，不是 HAR |
| 上传 | BrowserTransferProvider.upload + browser_upload + Web 文件选择 | 新鲜 observation 绑定 input；Agent 只读取 Session 工作区文件。页面事件可能发送数据 |
| 下载 | downloads/readDownload + browser_save_download + Web Blob | 页面所属 id、清理后的文件名、有界流式读取；实际附件与下载文件字节已比对 |
| 插件组合 | bundle/cinlan-browser、api/remotes、app-boot browser template | 普通 web 不自动加载 Browser；新增工具受既有 observe/navigate/interact guard 约束 |

主要文件：

- `packages/browser/browser/src/types.ts`、`src/index.ts`
- `packages/browser/browser-playwright/src/index.ts`、`src/transfers.ts`
- `packages/browser/tool-browser/src/index.ts`
- `packages/browser/browser-permission-policy/src/index.ts`
- `packages/api/browser-controller/src/index.ts`、`src/types.ts`
- `packages/client/ui-settings-security/src/client/BrowserPreferencesForm.tsx`、`BrowserControls.tsx`、`BrowserTransfersPanel.tsx`
- `apps/web/tests/native-browser-settings.e2e.ts`

## 实际验证

所有日志：`.artifacts/browser-native-20260913/`。

| 检查 | 结果 | 日志 |
|---|---|---|
| pnpm run build | 通过，248 Client artifacts；使用 NODE_OPTIONS=--max-old-space-size=8192 | build-last.log |
| Host/Client tsc project build | 通过 | 终端实际执行 |
| Browser/Remote/UI/profile 聚焦测试 | 19 文件，255 测试通过 | final-focused-verified.log |
| pnpm run test:gui | 437 文件，5641 通过，7 跳过 | gui.log |
| Web replay：Browser、Work Items、安全证据 | 3 文件，10 测试通过 | web-verified.log |
| pnpm run hygiene | 16/16 通过 | hygiene-final-2.log |
| 局部 lint、i18n、tsconfig aliases、README gates、命名双语配对 | 通过 | lint-final-2.log 及终端执行 |
| verify-md-links | 1737 文件通过 | links-final.log |

Web 断言覆盖偏好恢复、非法配置拒绝、真实主页/搜索、后退/前进、记录脱敏、Cookie 同 profile 重启与隔离、文件输入结果、Attachment 字节和 Web 下载字节。1680/1000/600px 检查偏好与展开传输面板的内容宽度及控件命中。

完整 doc-sync 实际执行为 23/34 通过、11 项失败。之后修复了本批 README 锚点并单独通过链接检查；未再次运行得到全绿。剩余包括 Typert packageExportName 的 undefined flags、类型/服务归属、源码 JSDoc、生成目录与既有 docs/dev/暂存文档债务，未批量豁免检查。

## 剩余迁移

1. Browser：profile 清单/重命名/删除、逐 Tab 切换、其他浏览器数据库直接导入、持久浏览历史、HAR、文本输入与滚动。
2. Security Research：scope 编辑、报告下载 UI、全部 shell/network/browser Consumer 授权强制和 Skill 安装更新。认证 Web Remote 不是 assessment scope 授权。
3. 原生 Windows Computer Use、Android ADB/AVD、iOS Provider。
4. Design Studio、Voice、SSH、TUI 正式 profile 接入。
5. 完整 doc-sync、模型对话录制、跨平台安装及 GitHub 分发验收。

传输读取预算不限制浏览器网络流量或临时下载磁盘占用。未调用真实模型或操作真实设备。安全范围 Provider 的探索草稿未接入正式 packages/profile，隔离保存在 `.artifacts/browser-native-20260913/unadapted-scope-draft`。

## 保留与知识增量

sourceDeletionAllowed: false。三个旧目录全部保留；未 push、tag、release 或发布包。

新增 `2026-09-13-native-browser-operations` Agent Note；基础浏览器/安全证据决策仍有效，不归档。可复用经验已写入 runtime reverse-skill KB 的 `harness-native-capability-migration.md`；项目没有 KB 镜像目录，未新增第二运行时来源。
