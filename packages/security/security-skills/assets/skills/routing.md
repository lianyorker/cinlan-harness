# Reverse Engineering Skill Routing Matrix

Route tasks to the most appropriate skill module by target type, user intent, and toolchain.

## Routing Protocol

1. Classify from the target type, user intent, and available toolchain evidence.
2. Read one primary module's `SKILL.md` before acting.
3. Add another module only when the task actually crosses module boundaries.
4. If no route matches, state the gap and follow the current task's analysis/execution boundary; do not force-fit.

## By Target Type

| Target Type                                      | Recommended Entry                                                                 | Alternative                                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| APK / Android app                                | `apk-reverse/` — jadx decompile + apktool unpack                                  | If core is in .so → `ida-reverse/` or `radare2/`                                                                   |
| Binary exe/dll/so/elf                            | `ida-reverse/` — IDA Pro decompile                                                | `radare2/` — CLI analysis, or `reverse-engineering/tools.md` — GDB/Unicorn                                         |
| JavaScript / Web frontend                        | `js-reverse/` — 5-stage workflow                                                  | anything-analyzer MCP browser tools, or jshookmcp CDP/Hook                                                         |
| HTTP capture / browser sampling / request replay | `browser-automation/`                                                             | `js-reverse/`, `api-security/`, or an available capture MCP                                                        |
| Firmware / IoT                                   | `reverse-engineering/platforms.md` — binwalk/ARM/MIPS                             | `reverse-engineering/tools.md` — Ghidra headless                                                                   |
| WASM / Python bytecode / .NET                    | `reverse-engineering/languages.md`                                                | Check specific language section                                                                                    |
| macOS / iOS                                      | `reverse-engineering/platforms.md` — Mach-O/ObjC/Swift                            | `mobile-reverse/` for iOS-specific                                                                                 |
| Game (Unity/Unreal)                              | `reverse-engineering/` — engine and native-code triage                            | `mobile-reverse/` for mobile or `ida-reverse/` for native code                                                     |
| Memory dump / PCAP                               | `reverse-engineering/platforms.md`                                                | `reverse-engineering/patterns*.md`                                                                                 |
| Malware / virus sample                           | `malware-analysis/` — triage, IOC, YARA/Sigma, sandbox                            | `ida-reverse/` for deep code analysis                                                                              |
| Cryptography / encryption algorithms             | `reverse-engineering/patterns*.md` — crypto patterns                              | `js-reverse/` (if frontend crypto)                                                                                 |
| Protocol reverse / custom protocol               | `reverse-engineering/platforms.md` — network protocols                            | `js-reverse/` (if WebSocket/HTTP)                                                                                  |
| Go / Rust binary                                 | `reverse-engineering/languages-compiled.md` + `reverse-engineering/go-reverse.md` | `ida-reverse/` or `radare2/`                                                                                       |
| LLM / AI application                             | `llm-security/` — OWASP LLM Top 10 + ASI Top 10                                   | Prompt injection, Agent security                                                                                   |
| API / REST / GraphQL                             | `api-security/` — BOLA/BFLA/JWT/OAuth                                             | `pentest-tools/` for scanning                                                                                      |
| Supply chain / SBOM / CI-CD                      | `supply-chain-security/` — Trivy/Syft/Gitleaks                                    | —                                                                                                                  |
| iOS app (IPA)                                    | `mobile-reverse/` — class-dump/Hopper/Frida iOS                                   | `reverse-engineering/platforms.md`                                                                                 |
| **CTF competition**                              | Route by dominant evidence to an existing module                                  | `pentest-tools/`, `reverse-engineering/`, `pwn-chain/`, `llm-security/`, `mobile-reverse/`, or `firmware-pentest/` |
| Web runtime / API                                | `api-security/`                                                                   | `pentest-tools/` or `browser-automation/`                                                                          |
| Cloud / Container / K8s                          | `attack-chain/` for path planning                                                 | `supply-chain-security/` for image and pipeline risk                                                               |
| Windows / AD / Identity                          | `pentest-tools/`                                                                  | `attack-chain/` for multi-stage planning                                                                           |
| Forensics / PCAP                                 | `malware-analysis/` or `pentest-tools/` by evidence                               | Unmatched steganography tasks should be reported as a coverage gap                                                 |
| Prompt injection / Agent                         | `llm-security/`                                                                   | —                                                                                                                  |
| Mobile (Android/iOS)                             | `mobile-reverse/`                                                                 | `apk-reverse/` for Android static work                                                                             |
| Firmware / Malware sample                        | `firmware-pentest/` or `malware-analysis/`                                        | `reverse-engineering/`                                                                                             |

## By User Intent

| User Says                                       | Route To                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| "decompile / IDA analyze"                       | `ida-reverse/SKILL.md` — IDA MCP workflow                                                                |
| "recover source / disassemble"                  | `reverse-engineering/SKILL.md` + `ida-reverse/`                                                          |
| "Frida hook / dynamic inject"                   | `reverse-engineering/tools-dynamic.md` — Frida section                                                   |
| "radare2 / r2 analyze"                          | `radare2/SKILL.md` — CLI workflow                                                                        |
| "find frontend signature / encrypted params"    | `js-reverse/SKILL.md` — Observe→Capture→Rebuild                                                          |
| "jshookmcp / JS hook / CDP debug"               | `js-reverse/SKILL.md` — same JS/Web chain                                                                |
| "APK unpack / repack / modify smali"            | `apk-reverse/SKILL.md` — decode→rebuild-sign-install                                                     |
| "bypass anti-debug / anti-detection"            | `reverse-engineering/anti-analysis.md`                                                                   |
| "what obfuscation / VM is this"                 | `reverse-engineering/patterns*.md` — match by pattern                                                    |
| "Go/Rust/Swift reverse"                         | `reverse-engineering/languages-compiled.md` + `reverse-engineering/go-reverse.md`                        |
| "kernel driver / Rootkit / LKM"                 | `reverse-engineering/kernel-driver-reverse.md`                                                           |
| "Python bytecode / pyc"                         | `reverse-engineering/languages.md` — Python section                                                      |
| "symbol execution / angr"                       | `reverse-engineering/tools-dynamic.md` — angr section                                                    |
| "patch environment / Node reproduce"            | `js-reverse/references/env-patching.md`                                                                  |
| "CTF challenge / competition reverse"           | `reverse-engineering/patterns-ctf*.md`                                                                   |
| "write report / documentation"                  | `docs-generator/` — technical documentation                                                              |
| "write writeup"                                 | `docs-generator/` — CTF writeup template                                                                 |
| "open webpage / browser automation / fill form" | `browser-automation/SKILL.md` — Playwright                                                               |
| "crawl page / screenshot / auto login"          | `browser-automation/SKILL.md`                                                                            |
| "desktop automation / Windows automation"       | `browser-automation/SKILL.md` — OpenReverse                                                              |
| "game reverse / anti-cheat / hack analysis"     | `reverse-engineering/SKILL.md` + `ida-reverse/SKILL.md` for native code                                  |
| "Unity / IL2CPP / Mono"                         | `mobile-reverse/SKILL.md` on mobile, otherwise `reverse-engineering/SKILL.md`                            |
| "Unreal Engine / UE reverse"                    | `reverse-engineering/SKILL.md` + `ida-reverse/SKILL.md`                                                  |
| "Cheat Engine / memory scan"                    | `reverse-engineering/tools-dynamic.md`                                                                   |
| "symbol migration / cross-version compare"      | `binary-diff/SKILL.md` — LLM batch migration                                                             |
| "missing PDB / old version symbols"             | `binary-diff/SKILL.md` — cross-version symbol migration                                                  |
| "bindiff / function offset migration"           | `binary-diff/SKILL.md` — binary diff                                                                     |
| "N-day / patch diff / CVE reproduction / 1-day weaponization" | `patch-diff-exploit/SKILL.md` — patch to PoC to pre-patch target                                        |
| "Patch Tuesday / MSRC / Microsoft Update Catalog" | `patch-diff-exploit/references/patch-tuesday-workflow.md`                                               |
| "ghidriff / Diaphora / DeepDiff (offensive)"    | `patch-diff-exploit/references/diff-tools-comparison.md`                                                |
| "port scan / Nmap"                              | `pentest-tools/SKILL.md` — information gathering                                                         |
| "vulnerability scan / Nuclei"                   | `pentest-tools/SKILL.md` — vulnerability detection                                                       |
| "SQL injection / SQLMap"                        | `pentest-tools/SKILL.md` — web pentest                                                                   |
| "directory brute force / FFUF / Gobuster"       | `pentest-tools/SKILL.md` — web pentest                                                                   |
| "password cracking / Hashcat"                   | `pentest-tools/SKILL.md` — password cracking                                                             |
| "penetration testing / active scan"             | `pentest-tools/SKILL.md` — pentest toolchain                                                             |
| "SRC hunting / Bug Bounty"                      | `pentest-tools/src-hunter/SKILL.md` — 19 playbooks + H1 cases                                            |
| "WAF bypass"                                    | `pentest-tools/src-hunter/references/payloader/` — 263 bypass steps                                      |
| "draw diagram / flowchart / architecture"       | `diagram-generator/SKILL.md`                                                                             |
| "attack path diagram / sequence diagram"        | `diagram-generator/SKILL.md` — Mermaid/Graphviz/PlantUML                                                 |
| "malware / virus analysis / sample analysis"    | `reverse-engineering/SKILL.md` + YARA/sandbox                                                            |
| "firmware / IoT / binwalk / ARM"                | `reverse-engineering/platforms-hardware.md`                                                              |
| "cryptography / AES / RSA"                      | `reverse-engineering/patterns*.md` — crypto pattern recognition                                          |
| "protocol reverse / Protobuf / custom protocol" | `reverse-engineering/platforms.md`                                                                       |
| "cloud security / container escape / K8s"       | `attack-chain/SKILL.md` for path planning + `supply-chain-security/SKILL.md` for image/pipeline analysis |
| "Prompt injection / AI security"                | `llm-security/SKILL.md` — OWASP LLM + ASI Top 10                                                         |
| "internal network / lateral movement"           | `pentest-tools/SKILL.md` + `pentest-tools/references/network-attack-defense.md`                          |
| "privilege escalation"                          | `pentest-tools/references/network-attack-defense.md` — escalation section                                |
| "Mimikatz / credential extraction / PtH"        | `pentest-tools/references/network-attack-defense.md`                                                     |
| "Kerberos / domain pentest / AD"                | `pentest-tools/references/network-attack-defense.md`                                                     |
| "C2 / persistence / remote control"             | `pentest-tools/references/network-attack-defense.md`                                                     |
| "blue team / detection / defense / IR"          | `pentest-tools/references/network-attack-defense.md`                                                     |
| "APK security testing / mobile security"        | `apk-reverse/references/apk-security-checklist.md` — OWASP MASTG                                         |
| "SSTI / template injection"                     | `pentest-tools/SKILL.md` — SSTImap                                                                       |
| "XSS scan / cross-site scripting"               | `pentest-tools/SKILL.md` — XSStrike                                                                      |
| "WordPress pentest / WP enumeration"            | `pentest-tools/SKILL.md` — WPProbe                                                                       |
| "C2 framework / adversary simulation"           | `pentest-tools/SKILL.md` — AdaptixC2                                                                     |
| "WiFi attack / wireless pentest"                | `pentest-tools/SKILL.md` — Fluxion + aircrack-ng                                                         |
| "NTLM relay / auth coercion"                    | `pentest-tools/SKILL.md` — Coercer                                                                       |
| "NetExec / CrackMapExec / nxc"                  | `pentest-tools/SKILL.md` — network service enumeration                                                   |
| "AI auto pentest / MCP security"                | `pentest-tools/SKILL.md` — HexStrike AI / MetasploitMCP                                                  |
| "Swarm / swarm pentest / autonomous scan"       | `pentest-tools/SKILL.md` — Pentest Swarm AI                                                              |
| "red team / HW / attack exercise"               | `attack-chain/SKILL.md` — full attack chain orchestration                                                |
| "initial breach / boundary breach"              | `attack-chain/SKILL.md` — boundary breach phase                                                          |
| "close-range pentest / BadUSB / WiFi phishing"  | `attack-chain/SKILL.md` — close-range section                                                            |
| "EDR bypass / AV bypass / defense implementation research" | `edr-bypass-re/SKILL.md` — reverse defensive implementation, then select a bypass                 |
| "direct syscall / indirect syscall / Hell's Gate / SysWhispers" | `edr-bypass-re/references/unhook-techniques.md`                                             |
| "ETW patch / AMSI patch / telemetry blinding"   | `edr-bypass-re/references/telemetry-blinding.md`                                                         |
| "ntdll hook / pe-sieve / EDR hook table"        | `edr-bypass-re/references/hook-survey.md`                                                               |
| "payload delivery / operational EDR bypass / shellcode loader" | `attack-chain/SKILL.md` — EDR/AV evasion in the delivery phase                               |
| "phishing / social engineering"                 | `attack-chain/SKILL.md` — phishing section                                                               |
| "supply chain attack"                           | `attack-chain/SKILL.md` — supply chain section                                                           |
| "trace cleanup / anti-forensics"                | `attack-chain/SKILL.md` — cleanup section                                                                |
| "full pentest / end-to-end"                     | `attack-chain/SKILL.md` — full chain planning                                                            |
| "from external to domain controller"            | `attack-chain/SKILL.md` — cross-phase path orchestration                                                 |
| "attack surface assessment / path planning"     | `attack-chain/SKILL.md` — path planning decision tree                                                    |
| "got shell, what next / post-exploitation"      | `attack-chain/SKILL.md` — plan from current foothold                                                     |
| "BurpSuite / Burp proxy / intercept"            | `pentest-tools/SKILL.md` + `pentest-tools/references/burpsuite-mcp-guide.md`                             |
| "Burp MCP / proxy history analysis"             | `pentest-tools/references/burpsuite-mcp-guide.md` — 63 tools                                             |
| "Intruder brute force / Repeater replay"        | `pentest-tools/references/burpsuite-mcp-guide.md`                                                        |
| "Collaborator / OOB testing"                    | `pentest-tools/references/burpsuite-mcp-guide.md`                                                        |
| "API security / GraphQL / JWT attack"           | `api-security/SKILL.md` — REST/GraphQL/JWT/OAuth                                                         |
| "supply chain security / SBOM / SCA"            | `supply-chain-security/SKILL.md` — Trivy/Syft/Gitleaks                                                   |
| "iOS reverse / IPA / Mach-O"                    | `mobile-reverse/SKILL.md` — class-dump/Hopper/Frida iOS                                                  |
| "Objection / SSL Pinning bypass"                | `mobile-reverse/SKILL.md` — dynamic instrumentation                                                      |
| "YARA / malware detection rules"                | `malware-analysis/SKILL.md` — YARA/Sigma/IOC                                                             |
| "pwn / stack overflow / ROP / ret2libc"         | `reverse-engineering/patterns-ctf*.md` + pwntools                                                        |
| "Agent not working / AI lazy / skip steps"      | `llm-security/references/agent-obedience-engineering.md`                                                 |
| "MSF stuck / orphan process / MSF protocol"     | `pentest-tools/references/msf-protocol.md`                                                               |
| "CLI flag hallucination / payload quoting / OOB callback port" | `pentest-tools/references/cli-discipline.md` — argument discipline + foreground/background + OOB ports |
| "task decomposition / subtask planning / delegation / pivot"   | `attack-chain/references/engagement-planning.md` — 10/30/30/30 split + delegation and pivot rules      |
| "engagement state modeling / vuln confirmation tiers / episodic memory" | `attack-chain/references/engagement-knowledge-graph.md` — entity/edge taxonomy + retrieval modes |
| "anonymize / placeholder / writeup desensitize" | `templates/security-report-templates.md` — report placeholders and evidence redaction                                  |
| "Hydra / online brute force"                    | `pentest-tools/SKILL.md` — online password attack                                                        |
| "Metasploit / msfconsole / exploit"             | `pentest-tools/SKILL.md` — exploitation framework                                                        |
| "Wireshark / packet analysis / PCAP"            | `pentest-tools/SKILL.md` + `reverse-engineering/platforms.md`                                            |
| "BurpSuite / web proxy / intercept"             | `pentest-tools/SKILL.md` — web proxy                                                                     |
| "ProxyCat / proxy pool / IP rotation"           | `pentest-tools/SKILL.md` — proxy management                                                              |

## By Toolchain

| Tool                                       | Related Module                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| IDA Pro (idapro\_\*)                       | `ida-reverse/` — MCP HTTP server + 72 tools                                                       |
| radare2 (r2/rabin2/rasm2)                  | `radare2/` — CLI + recon.ps1                                                                      |
| jadx / apktool                             | `apk-reverse/` — decode.ps1 / manifest-summary.ps1                                                |
| Frida                                      | `reverse-engineering/tools-dynamic.md`                                                            |
| GDB / GEF / pwndbg / rr                    | `reverse-engineering/tools.md`                                                                    |
| Ghidra (headless)                          | `reverse-engineering/tools.md` + Ghidra MCP                                                       |
| angr / Qiling / Unicorn                    | `reverse-engineering/tools-dynamic.md`                                                            |
| BinDiff / Diaphora                         | `reverse-engineering/tools-advanced.md`                                                           |
| anything-analyzer MCP                      | Port 23816 MCP server (browser + HTTP capture + AI analysis)                                      |
| jshookmcp                                  | `js-reverse/` enhancement MCP for browser/CDP/Hook/Network/SourceMap/AST                          |
| agent-browser / Playwright                 | `browser-automation/` — browser automation                                                        |
| OpenReverse (UIA/CUA)                      | `browser-automation/` — Windows desktop automation                                                |
| Cheat Engine / x64dbg / ReClass            | `reverse-engineering/tools-dynamic.md` — memory analysis                                          |
| IL2CPP Dumper / dnSpy                      | `mobile-reverse/` or `reverse-engineering/` — Unity/Mono reverse                                  |
| LLM symbol migration / BinDiff alternative | `binary-diff/` — cross-version batch migration                                                    |
| BinDiff / Diaphora / ghidriff / DeepDiff (offensive) | `patch-diff-exploit/` — locate a patched vulnerability and weaponize it                      |
| SysWhispers3 / Hell's Gate / pe-sieve / API Monitor | `edr-bypass-re/` — EDR bypass research and implementation                                    |
| Nmap / Masscan                             | `pentest-tools/` — port scan, service identification                                              |
| Nuclei / ZAP / Nikto                       | `pentest-tools/` — vulnerability scanning                                                         |
| SQLMap / FFUF / Gobuster                   | `pentest-tools/` — web pentest (injection/brute force)                                            |
| SSTImap                                    | `pentest-tools/` — SSTI auto-detection                                                            |
| XSStrike                                   | `pentest-tools/` — advanced XSS scanning                                                          |
| Hashcat / John / Hydra                     | `pentest-tools/` — password cracking                                                              |
| Metasploit / Impacket                      | `pentest-tools/` — exploitation framework                                                         |
| BurpSuite                                  | `pentest-tools/` — web proxy, interception, vulnerability scanning                                |
| BurpSuite MCP                              | `pentest-tools/` — 63-tool AI full control, see `pentest-tools/references/burpsuite-mcp-guide.md` |
| ProxyCat                                   | `pentest-tools/` — proxy pool management & IP rotation                                            |
| Cobalt Strike / Sliver / Havoc             | `attack-chain/` — C2 framework                                                                    |
| pentestMCP (Docker)                        | `pentest-tools/` — 20+ tools one-click MCP                                                        |
| Mermaid / Graphviz / PlantUML              | `diagram-generator/` — diagram generation                                                         |
| garak / PyRIT / promptfoo                  | `llm-security/` — LLM red team testing                                                            |
| Trivy / Syft / Gitleaks / OSV-Scanner      | `supply-chain-security/` — supply chain scanning                                                  |
| Objection / Frida iOS / class-dump         | `mobile-reverse/` — iOS dynamic analysis                                                          |

If `tool-index.md` exists, use it as a cache and verify critical tools directly. If it does not exist, probe with real commands; never guess paths.

---

## Route Not Matched — Handling

If the current task doesn't match any table above, **do NOT force-fit into existing skill**:

1. Check if it's an edge case of an existing skill (can extend coverage)
2. If truly new type, report the coverage gap and optionally propose a new skill:
   - Suggested skill name and coverage
   - Required toolchain
   - Relationship to existing skills
3. Create or modify a skill only after execution authorization, following `CONTRIBUTING.md`
4. After creation, update this routing matrix

Route failure is evidence to report, not permission to edit files or install dependencies.

## Path Crossing (Cross-Module Scenarios)

Some tasks span multiple modules. Common crossings:

```
APK Reverse Path:
  apk-reverse/decode.ps1 → Java layer analysis
  ↓ If core is in .so
  ida-reverse/ or radare2/ → .so analysis
  ↓ If dynamic verification needed
  apk-reverse/frida-run.ps1 → Frida Hook

Frontend JS Reverse Path:
  js-reverse/Observe → locate target request
  ↓ Need stronger browser/CDP/Hook/Network capability
  jshookmcp → runtime sampling, breakpoints, interception, SourceMap/AST
  ↓ After confirming entry function
  js-reverse/Rebuild → Node local reproduction
  ↓ Need environment patching
  js-reverse/references/env-patching.md

Binary Reverse Path:
  radare2/recon.ps1 → quick reconnaissance
  ↓ Deep analysis
  ida-reverse/ → IDA decompile
  ↓ Dynamic verification
  reverse-engineering/tools-dynamic.md → Frida/GDB

CTF Competition Path:
  classify dominant evidence (web / binary / pwn / mobile / firmware / LLM)
  ↓
  api-security or pentest-tools / reverse-engineering / pwn-chain /
  mobile-reverse / firmware-pentest / llm-security
  ↓
  if no module matches, report the coverage gap

N-day Weaponization Path:
  patch-diff-exploit/references/patch-tuesday-workflow.md → acquire binaries from before and after the patch
  ↓ Align symbols
  patch-diff-exploit/references/diff-tools-comparison.md → select BinDiff, ghidriff, or Diaphora
  ↓ Locate the change
  patch-diff-exploit/references/root-cause-and-poc.md → establish root cause and build a PoC
  ↓ Weaponize
  pwn-chain/SKILL.md for a stable exploit + pentest-tools/references/msf-protocol.md for a Metasploit module

Red Team Delivery Path:
  attack-chain/SKILL.md → select the delivery stage
  ↓ Need to bypass EDR
  edr-bypass-re/references/hook-survey.md → identify the target EDR's hooks
  ↓ Select a bypass technique
  edr-bypass-re/references/unhook-techniques.md → direct syscall or Hell's Gate
  edr-bypass-re/references/telemetry-blinding.md → ETW or AMSI patching
  ↓ Verify locally
  pe-sieve / API Monitor → verify hooks were removed
  ↓ Deliver
  return to the attack-chain post-exploitation stage

Web Pentest + BurpSuite MCP Path:
  browser-automation/ → auto-browse target with Burp proxy
  ↓ Traffic captured
  burpsuite MCP proxy_history → AI analyzes all requests
  ↓ Suspicious endpoints found
  burpsuite MCP intruder_attack → automated enumeration
  ↓ Vulnerability confirmed
  docs-generator/ → generate pentest report
```
