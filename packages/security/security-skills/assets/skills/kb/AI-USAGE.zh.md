# Knowledge Base AI Usage

[English](AI-USAGE.md) | 中文

`kb/` 是随产品发布、经过审核且只读的战术知识库，不是单个 case 的证据目录；任务执行期间不得修改已安装 bundle。

## 读取规则

- 只读取与当前任务证据信号匹配的文件，不把整个 KB 注入模型上下文。
- 用 KB 条目指导可复现命令、脚本、模板和验证，不把文档描述本身当作证据。
- 目标特定证据保存在任务的 `notes/`、`reports/` 或其他已授权输出目录。

## 学习 Candidate

安全执行任务完成后，仅当增量已经验证、可跨任务复用、匹配 KB 尚未覆盖，并且当前意图允许写 workspace 时，才创建 candidate。实例化 `../templates/knowledge-candidate.zh.md` 的章节，但不复制语言切换行；初始路径为 `<workspace>/.agents/field-journal/cyber-security/YYYY-MM-DD_<slug>.md`。该路径已存在时，先追加采用 UTC 的 `_HHmmssZ`，仍冲突则追加最小未使用序号。绝不替换已有 candidate。

Candidate 必须记录前置条件与已测版本、可复现方法、脱敏证据、失败模式、限制、已检查的现有内容和建议产品位置。不得记录普通任务流水、未经验证的想法、credential、个人信息、真实目标标识、私有源码、原始请求或响应、专有二进制及其他敏感证据。没有有效增量时不创建文件；workspace 不可写时，在任务结果中给出 candidate 或 `KB gap: [signal]`。

## 产品合入

用户可以手工复制或归档 `.agents/field-journal/cyber-security/`，交给产品侧复核。维护者完成复现、脱敏、去重和编辑后，在本 package 源码中合入有效 candidate 并重新构建。Candidate 本身不会修改已安装 bundle。

## 当前重点

- Web CTF：`kb/ctf-website/README.md`
- APK 逆向：`kb/apk-reverse/README.md`
- PE 逆向：`kb/pe-reverse/README.md`
- 通用安全：`kb/general/README.md`
- CVE 关联网：`kb/ctf-website/techniques/09-cve/cve-correlation-graph.md`
