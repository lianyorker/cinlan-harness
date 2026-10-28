# 官方 Orca 截图证据

这组文件保存本机官方 Orca 安装实例的视觉基线，不是 CLH 功能通过证据。

| 字段 | 值 |
|---|---|
| 启动入口 | `C:\Users\ASUS\Desktop\Orca.lnk` |
| 实际进程 | `C:\Users\ASUS\AppData\Local\Programs\orca\Orca.exe`，PID `29268` |
| 版本 | `1.4.222` |
| 采集方式 | `orca computer get-app-state --app pid:29268 --window-index 0 --restore-window --json` |
| 窗口尺寸 | `1456x860` |
| 采集时间 | `2026-10-10` |
| SHA-256 | `77e6ec23e0a7e4ed67f2d8ab998e290e5075220ce8e0ba38eadbb558fa9dc3ef` |

截图： [orca-main-2026-10-10-1456x860.png](orca-main-2026-10-10-1456x860.png)

截图保留官方 Orca 当前可见的 Chat、项目列表、会话历史和设置告警状态。采集未启动新 Orca 进程，也未修改官方应用数据。若后续页面状态变化，新增文件需记录版本、窗口尺寸、动作和 hash；不要覆盖本文件代表的基线。
