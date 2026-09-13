# Cinlan 安全知识 Candidate

[English](knowledge-candidate.md) | 中文

> 状态：待审核
> 日期：YYYY-MM-DD
> 路由 Skill：`<skill-name>`
> 建议产品位置：`kb/<topic>.md`、`<skill>/references/<topic>.md` 或 `<skill>/SKILL.md`

仅当本次任务产生了匹配 KB 尚未覆盖、已经验证且可跨任务复用的增量时，才创建该记录。实例化模板时不复制上方语言切换行。初始路径为 `<workspace>/.agents/field-journal/cyber-security/YYYY-MM-DD_<slug>.md`；该路径已存在时，先追加采用 UTC 的 `_HHmmssZ`，仍冲突则追加最小未使用序号。绝不替换已有 candidate。不得把 credential、cookie、个人信息、真实目标标识、私有源码、原始请求或响应、专有二进制及其他敏感证据复制到该文件。

## 可复用信号

<!-- 说明新的可观察信号，以及它为何能泛化到其他任务。 -->

## 前置条件和已测版本

<!-- 记录相关 OS、runtime、工具、目标格式和版本限制。 -->

## 已验证方法

<!-- 给出最小可复现过程，区分必需步骤和可选诊断。 -->

## 证据

<!-- 引用已脱敏命令、稳定错误码、公开 fixture 或 artifact hash。私有证据只说明其保留位置，不嵌入正文。 -->

## 失败模式和限制

<!-- 说明反例、不支持的变体、置信度和未验证内容。 -->

## 现有内容检查

- 已检查的随包 KB 或 reference 文件：
- 现有指导不足之处：
- 已检查的相关 workspace candidate：

## 脱敏与合入检查

敏感值 MUST 替换为保留利用上下文的描述性占位符：

| 敏感值 | 占位符 |
| --- | --- |
| 目标/受害机 IP | `{target_ip}`、`{victim_ip}`、`{remote_host}` |
| 域名 | `{target_domain}`、`{callback_domain}` |
| 凭据 | `{username}`、`{password}`、`{hash}` |
| 令牌/密钥 | `{token}`、`{api_key}` |
| 非标准端口 | `{port}`（80/443 等标准端口保留原值） |
| 端点/回调 URL | `{api_endpoint}`、`{callback_url}` |
| 路径 | `{install_dir}`、`{config_path}` |

- [ ] 方法已经实际执行成功，不是未经测试的方案推断。
- [ ] 记录不包含 credential、个人信息、真实目标标识、私有源码或原始敏感证据。
- [ ] 环境和版本限制已经明确。
- [ ] 已检查产品现有指导和 workspace candidate，避免重复。
- [ ] 已写明建议产品位置和剩余审核工作。

## 维护者审核

<!-- 维护者在此记录验证、去重、修改和最终产品路径。Candidate 本身不会修改已安装 bundle。 -->
