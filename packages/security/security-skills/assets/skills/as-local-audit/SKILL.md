---
name: as-local-audit
description: 本机红队环境与暴露面自检：评估工具链健康度与本机遗留风险盘点。当开始一次红队评估前检查本机工具就绪度、或评估结束后清理本机痕迹（监听器、临时凭据、shell 历史、落盘载荷）时使用。
---

# 本机红队环境与暴露面自检

红队工作机本身就是暴露面：评估中打开的监听器、落盘的凭据、历史里的命令行密码都会留存。本技能分两个时点使用——评估前检查工具链就绪，评估后做遗留清理。

## 评估前：工具链就绪度

逐项 `Get-Command` / `where.exe` / `--version` 确认；缺失项记录到 campaign 台账而不是临时跳过。

```powershell
# 网络与扫描
nmap --version; naabu -version; masscan --version
# Web 探测与漏洞
httpx -version; nuclei -version; ffuf -V; katana -version
# 目录与子域
subfinder -version; gau -version
# 域内
bloodhound-python --version; impacket-ntlmrelayx --version 2>$null; certipy --version
# 凭据
hashcat --version; john --list-build-info
# 云 CLI
aws --version; az version; gcloud --version; aliyun version; tccli --version; hcloud version
```

工具二进制存在但版本行为不明确的，用 `--help | Select-String <flag>` 确认关键参数仍然存在（CLI 大版本变更常改旗标）。

## 评估后：本机遗留盘点

### 监听器与隧道残留

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 4444,8000,1080,7000 } | Format-Table -Auto
# 进程级确认
Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess |
  ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; "{0} {1} {2}" -f $_.LocalPort, $_.OwningProcess, $p.ProcessName }
```

评估中开过的 `nc`/`ncat`/`chisel`/`frps`/`frpc`/`responder` 监听窗口逐个 `exit`；确认无孤儿进程（`Get-Process | Where-Object { $_.ProcessName -match 'chisel|frp|ncat|responder' }`）。

### 凭据与载荷残留

```powershell
# 本次评估的临时凭据文件（按实际路径核对）
Get-ChildItem $env:TEMP -Recurse -Include "*.txt","*.json" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-2) -and $_.Name -match "cred|key|token|pass" }
# GCP 临时 service-account 文件（tool-gcp 用后即删，核对无残留）
Get-ChildItem $env:TEMP -Filter "tool-gcp-*" -ErrorAction SilentlyContinue
# 落地载荷与 webshell agent
Get-ChildItem $env:TEMP -Recurse -Include "agent.*","*.jsp","*.php" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-2) }
```

### Shell 历史与台账

- 检查本次评估是否把密码/密钥写进了命令行：`Get-Content (Get-PSReadlineOption).HistorySavePath | Select-String "pass|secret|key="` ——命中的行说明凭据进了历史文件；后续同类操作一律走 `credential_ref`，命令行不落值
- 本机 `~/.aws/credentials`、`~/.azure`、`~/.aliyun/config.json` 里的凭据是否因本次评估新增（az login 会写 `~/.azure`）；评估用凭据走 env/credential_ref，不落本机配置链
- campaign 台账的收尾核对：所有监听端口/隧道/落盘文件都应有对应步骤记录；有记录无清理的项现在补

## 输出

自检结论以清单形式给出：就绪项 / 缺失项（评估前）或 清理完成项 / 残留告警（评估后），并写入 campaign_upsert 的一条步骤。
