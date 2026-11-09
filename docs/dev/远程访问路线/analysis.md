# 远程访问路线分析（Remote Access Roadmap）

分析对象：cinlan-harness fork 的 Remote 调用面与非 owner 访问路线。截至本次核对，全部结论基于工作区源码与已生成契约。

## 1. 现状分层

| 层 | 位置 | 职责 |
|---|---|---|
| 契约生成 | `scripts/build-remote-contracts.ts` → `packages/typert/generator` | 扫描 `@Remote`/`@RemoteScope` 注解，生成 `lib/typert.remote-client` 类型化客户端与 TypertRemoteMap |
| 网关 | `packages/api/gateway`（`typertGateway`） | 解析调用涉及的资源，校验参数 Typert 类型，再向 remote-access 询问放行 |
| 访问决策 | `packages/api/remote-access`（`ctx.remoteAccess`） | 角色/绑定/条件策略模型；owner（`{ kind: 'owner' }`）永不被检查 |
| 观众分类 | `packages/experimental/liveshare/src/endpoint-classification.ts` | `VIEWER_ENDPOINT_CLASSES` 逐端点声明 share viewer 可达性，编译期完备性闸门 |

## 2. 访问模型要点

- **默认拒绝**：share-viewer 策略只绑定 `reader-*` 类动作；`owner-only` 永不暴露；`plugin-offered` 仅经插件运行期声明和 owner 选择可达。
- **资源维度**：调用未指名资源时只触碰 `global`；`allows()` 每次调用重读绑定，不做跨决策缓存。
- **快照一致性**：`snapshotFor(principal)` 生成 `global`/资源授权清单，通过 `remoteAccess/follow` 流下发 baseline/upsert/remove；webServer 向每个渲染页注入 `__DSH_REMOTE_ACCESS__` 全局行。
- **编译期证明**：`liveshare/src/client/endpoint-classification.ts` 用 `AssertNever` 证明分类表与生成的 `RemoteEndpoint` 互相覆盖——新增端点未分类即编译失败。

## 3. fork 当前使用面

- `securityResearch/*` 全部归为 `owner-only`（含本轮新增的 `securityResearch/reaStatus`、`securityResearch/reaDoctor`）。
- LiveShare 位于 `packages/experimental/`，属评估能力，无产品级承诺。
- REA 设置页的 Remote 只读状态/工具探测，未引入任何非 owner 通道。

## 4. remote-access README 记录的既有局限（路线候选）

- Exact Connection Fetch 路由不经过网关，对非 owner Peer 一律 403，需要逐路由声明访问规则。
- 快照与列表过滤决策不带调用参数，`args` 细化的条件可能出现“快照可见但调用被拒”。
- `session/attachment` 是对整个附件店的授权，跨会话图片隔离要靠分 Host/分 `DSH_HOME`。
- 已授权 Session 的 cwd/工具路径会暴露 owner 绝对路径（含 `home`），网关不单独隐藏。
- Interaction 参与（应答转发的 waterfall）owner-only；非 owner `$events` 只收允许的事件帧。
- `api-session/added` 携带完整 `SessionSummary`（含 `parentSessionId`）；`workspace/follow` 仅在下次变化时才反映已撤销的可见性。

## 5. 路线建议

1. **保持现状安全边界**：`securityResearch` 与 REA 相关端点维持 `owner-only`。逆向分析（REA/Ghidra/Frida）对宿主文件系统与进程能力影响大，开放给 share viewer 没有正当需求。
2. **若开放非 owner 读取**：先补 `reader-*` 类端点的资源声明，再评估 session/attachment、Fetch 路由两条已知泄露面；不要直接改 `always-allowed`。
3. **新增端点纪律**：任何 `@Remote` 必须同时给 LiveShare 分类；生成契约由 `build-remote-contracts` 产出，分类完备性由编译期闸门兜底。
4. **实验转产品**：LiveShare 转正需要解决 interaction 参与 owner-only 与 `home` 路径泄露两项，再评估把 `securityResearch` 的只读状态（describe/reaStatus）开放为 `reader-global-read`。
