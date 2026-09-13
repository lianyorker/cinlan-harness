# Agent Note: Windows-safe sidebar runtime and fixtures

Status: implemented

[English](2026-09-12-windows-safe-sidebar-runtime-and-fixtures.md) | 中文

## Problem

侧边栏上传路径通过 rename 把已完成的临时文件提交到目标路径。POSIX 会替换已有目标，但 Windows 在目标已存在时可能拒绝该 rename；因此即使每次上传都有独立临时文件，并发写入同一目标仍可能失败。

侧边栏 Agent PTY 路径通过 node-pty 发送带名称的终止信号。在 Windows 上 node-pty 会延迟执行该调用，并在回调中对带名称的信号抛错，抛出点位于调用方的 try/catch 之外，导致清理阶段出现未处理错误。侧边栏包声明的 node-pty 范围也曾与 subprocess provider 固定的版本不同。

本工作区的 Windows Node 测试运行时可以创建目录 junction，但跟随 junction 时可能返回 UNKNOWN。需要跟随 junction 的目录选择器测试不能把该主机限制转化为生产行为修改。

## Decision

上传提交为每个请求保留唯一临时文件。Windows 遇到冲突目标时先删除目标，再有界重试 rename；POSIX 继续使用原子替换。上传失败时仍只删除自己的临时文件，不替换目标。

Windows 上 Agent PTY 终止使用 node-pty 的默认 kill，因为这是其支持的进程终止路径。POSIX 继续接收请求的带名称信号；带名称调用被拒绝时，同步回退到默认 kill。

侧边栏包及其修复状态契约使用 dsh-subprocess-local 声明的精确 node-pty 版本 1.2.0-beta.15。插件导出测试导入工作区重作用域后的 loader 包 @deepseek-ai/cordis-plugin-loader，并断言带作用域的包身份。

依赖 junction 的目录选择器和工作区注册表测试会探测当前 Windows 进程能否跟随目录 junction；不能跟随时只跳过这些案例。生产目录与工作区行为保留原有 symlink 语义。侧边栏 smoke 与语法加载测试设置 30 秒显式预算，因为仓库扫描和完整语法导入可能与 GUI worker lane 共享资源。

文件 symlink fixture 会单独探测文件链接权限，不把可跟随目录 junction 当作可创建文件链接的证明。Windows 拒绝文件链接时，目录场景继续执行，只跳过必须使用文件链接的场景。文档发布的越界 fixture 跟随指向外部的目录链接，并在清理前 unlink，因此 Windows 无需文件 symlink 权限也能验证相同的 real-path 拒绝行为。

## Alternatives considered

把所有上传串行化可以避开 Windows 的替换竞争，但会无必要地耦合独立请求并降低吞吐，因此采用有界的替换重试。

把 Windows 上带名称的 PTY 信号继续放在同步 try/catch 中无法捕获 node-pty 延迟回调中的异常，因此 Windows 改用默认 kill 路径。

修改生产目录或工作区行为以隐藏或避开 junction 会掩盖测试运行时限制，并改变支持的文件系统行为，因此只有能力探测失败时才跳过依赖 junction 的测试。

保留 semver 范围或旧版 node-pty 会让侧边栏与 subprocess provider 使用不同的原生依赖，因此侧边栏使用 provider 固定的版本。

## Consequences

并发上传不会再仅因 Windows 无法 rename 覆盖已有文件而失败。Windows 目标替换存在短暂的先删除后 rename 间隔；请求仍不会留下部分临时输出，但调用方不能把该替换视为不中断的读事务。

终止行为、包元数据和 loader 身份现在与当前工作区运行时一致。具备能力的主机仍覆盖 junction 跟随路径；受影响的 Windows 运行时会报告跳过，而不是削弱实现。

## Verification

侧边栏和主题的聚焦套件通过，覆盖 PTY 依赖、插件导出、上传、sidechat fixture、chunk artifact、manifest 一致性、corner shape、elevation、scrollbar、smoke 与 code-block 语法测试。工作区注册表套件通过 43 个测试，并因 junction 能力跳过 2 个案例。直接 GUI aggregate 通过，430 个文件共 5,595 个测试；因不支持 junction 跟随而跳过 1 个文件和 12 个测试。必需的 pnpm GUI 与 replay-web 命令在测试执行前仍受阻：pnpm 11 无法读取现有 Windows node-pty junction 的包元数据。
