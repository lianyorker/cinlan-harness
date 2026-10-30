# 原生能力持久化收口：V4→V5 实施记录

## 已核对的前提

当前 writer 为4，已接受基线为4，发布记录为3；均以源码和版本记录为准，未推进发布或finalization记录。`persistence-changes --check --json` 有19个需要版本处理的差异：`agent/inbox/spliced`、`developer/message`、`user/message` 的automation、side-session、tool-browser、tool-browser-element-capture、tool-computer-use、tool-mobile-device的ContextFormed分支，以及title-llm-request.messages[]的传递变化。Auto审计事件是兼容新增，不是这些差异的原因。已接受的checkpoint和schema没有改写。

历史格式记录现支持只标识归档文件字节的snapshotSha256，与tag/PR互斥；完整SHA-256在渲染或`--write`之前校验，仍需正常结构根检查。它不证明源提交、发布、接受状态或迁移正确性。93项格式测试通过，包含变动一个换行仍拒绝、拒绝混合来源、错误摘要和双语不一致；尚未创建v4历史档案或改变writer。

## 下一步实现

1. 当前writer4阶段用所属命令归档V4inventory，以snapshotSha256如实固定本工作区快照，不虚构tag/PR。V4快照要保留物理与逻辑header、所有root和reachable types；不将归档当作accepted baseline。配套双语历史记录随后与writer5原子接入，避免current4校验看到多余v4记录。
2. 新建session-format-v4-to-v5，相邻Stage保留事件JSON、seq、sourceEventSeqs、surfaceOp、嵌入id、时间、来源和context-form字段。只升级header。已知seed cut直接传递；未知cut必须从最后的inherited end-seed marker正确推导，不能默认为0。compact run可直接转发，但必须观察seed marker；若run不保证不含marker，需按需展开。每个artifact独立状态。
3. 重用V4codec，而非复制已发布的行格式。V5物理header先精确验证version5，再临时转为4交给V4codec，恢复decoder header为5；编码反向处理。V4数据不改写。新V5校验不能把旧delivery标记激活：版本4水位保持历史，原生5水位按本代seq和session id校验。也不能接受源V4里已声称5的投递标记，它可能在仅升级header后错误激活；应显式拒绝并测试。
4. V4restorer包含generation4专用delivery校验，不能直接当成V5restorer。可复用其不变结构验证，使用不写回的临时validation view把5映到4、旧4映为历史值；最终返回和写出的必须仍是原始artifact。谨慎审查其他generation相关验证。新增导出或调整V4共享工具时，保持V4默认含义、测试和已接受记录不变。
5. 将writer、迁移catalog、依赖/paths/references、current encoder/restorer、文档与必要current消费者一起更新。保持historical catalog V0-V3专用逻辑及已发布codec版本字面量。至少覆盖V4direct、V3多跳（含子证据）、native5、seededcut、未知required拒绝、unknownignorable保留、delivery拒绝、重复/并行stage及源字节不变。
6. 增加完整version-bump acknowledgement，对ContextFormed传递变化和Auto审计新增分别解释，不更新accepted4记录。基于测试事实生成prose，不伪造验证。按所属场景创建快照后继，不删除或重命名历史代次；TS/Python SDK、publication Worker及JSONL不回退都需要核对。

## 已定位的代码所有者

- [当前迁移catalog](../../packages/session/session-format-catalog/src/generated.ts)由generator维护；current.ts执行installed Session还原，children.ts绑定V3子证据。
- [V4codec](../../packages/session/session-format-v3-to-v4/src/codec.ts)与[校验](../../packages/session/session-format-v3-to-v4/src/validation.ts)保持独立历史语义；delivery函数当前只处理3或4，V4restorer有generation4坐标检查。
- [ContextFormed](../../packages/llm/llm/src/message.ts)新增form引起六个既有kind组传递变化。V4source准入按非空非plugin的kind保留JSON，不验证闭合form列表，因此本边不需要重写模型输入。
- [历史格式记录脚本](../../scripts/persistence-formats.ts)和[来源展示](../../scripts/persistence-format-facts.ts)已接入snapshotSha256；文档和模板已同步。
