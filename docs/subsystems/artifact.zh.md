# Artifact

[English](artifact.md) | 中文

## 概述

本参考列出 `packages/artifact` 包族声明的 Cordis API。[Artifact Service Definition](../../packages/artifact/artifact/README.zh.md)负责不可变引用元数据、发布与描述请求、调用方授权和 Provider 职责；[本地存储](../../packages/artifact/artifact-local/README.zh.md)负责字节持久化与有界访问。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxartifacts--artifactservice-abstract-seam"></a>

### `ctx.artifacts` — `ArtifactService` (abstract seam)

Artifact service: typed metadata store for evidence, reports, and recordings. Providers implement session-scoped in-memory or durable storage.

```ts cordis-catalog
/**
 * Describe one artifact by its identity.
 * @param request - artifact id and authorization.
 * @returns canonical artifact reference.
 * @throws when artifact does not exist or authorization is insufficient.
 */
abstract describe(request: ArtifactDescribeRequest): Promise<ArtifactRef>

/**
 * Publish one artifact with its metadata.
 * @param request - artifact data, metadata, and authorization.
 * @returns published artifact reference.
 */
abstract publish(request: ArtifactPublishRequest): Promise<ArtifactRef>
```

Source: [`packages/artifact/artifact/src/index.ts`](../../packages/artifact/artifact/src/index.ts)
<!-- END GENERATED cordis-surface -->
