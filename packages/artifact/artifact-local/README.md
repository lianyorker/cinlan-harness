---
description: "Store immutable, scoped artifact objects locally with bounded publication and verified reads."
kind: "package-reference"
---
# @deepseek-ai/dsh-artifact-local

English | [中文](README.zh.md)

## Summary

Store immutable, scoped artifact objects locally with bounded publication and verified reads.

## Table of Contents

- [Use this package](#use-this-package)
- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

`LocalArtifactStore` is the local provider for [`@deepseek-ai/dsh-artifact`](../artifact). It stores immutable objects under `<DSH_HOME>/artifacts/v1/objects` and metadata under a separate directory. Temporary files are created exclusively and hard-linked into place, so a published reference never points at a partial write or a caller path.

The artifact id is an opaque random value. Metadata keeps the authorization scope, including the producer identity, while public references expose only safe provenance and integrity fields. Safe provenance includes the optional deployment-scope reference because durable consumers need it to reconstruct the exact authorization. Publication and metadata loading reject any mismatch between provenance and authorization. Reads authorize every scope field, bound metadata before JSON parsing, require the stored id to match the requested reference, open and verify one stable regular-file handle, enforce the object bound before buffering, reject symlinks and path replacements, and verify the SHA-256 digest and recorded byte length.

On filesystems with POSIX modes, object and metadata directories are restricted to `0700` and files are exclusively created with `0600`; the process umask may further restrict them. Windows does not provide an equivalent owner-only guarantee through Node mode bits, so new directories and files inherit the DACL of the configured root or its nearest existing parent. Deployments that require restricted Windows access must configure `root` below a directory whose DACL already grants only the intended principals.

## Config

| Key | Default | Meaning |
|---|---|---|
| `root` | `<DSH_HOME>/artifacts/v1` | Private artifact root; use an explicit path for tests or deployment storage. |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home used when `root` is omitted. |
| `maxBytes` | 100 MiB | Positive publication and read cap, no greater than the runtime's safe allocation limit. |

Unknown keys and blank explicit `root` or `dshHome` values fail plugin load. A caller may request a read bound above `maxBytes`; the provider applies its smaller deployment cap after validating that the caller bound is a non-negative safe integer.

## Model Experience

### Request context and condition

#### What the model sees

`LocalArtifactStore.publish` and verified reads add no model-visible content. A separate authorized converter must validate the object before producing an attachment or logged text result.

#### Token effect

Zero-direct token effect; a converter owns any bounded result that enters a model request.

#### KV Cache effect

Independent until a converter publishes a model-visible result; that converter owns any request-prefix invalidation.

## Known Limitations and Deferred Work

- Objects are retained until a future reference-aware cleanup consumer runs.
- Export approval, encryption at rest, remote storage, and audit records are deployment or policy work.
- No runtime invariant companion is published because publication, authorization, bounds, and integrity are enforced by each provider operation.

<a id="dev-note"></a>
### Dev Note

The provider must receive execution-host identity from the configured service; callers cannot supply a replacement producer identity.
