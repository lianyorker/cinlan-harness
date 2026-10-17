# Agent Note: Harness M3 validation

Status: implemented

English | [中文](2026-10-13-harness-m3-validation.zh.md)

## Problem

Electron initializes local configuration, logging, session, and tool objects, while its Web Host uses separate Cordis services. Successful initialization does not establish a conversation or execution path between those objects and the Host. The milestone plan mixes local-module integration with application-level acceptance.

## Decision

M3 evidence distinguishes two paths. A real-file child-process fixture verifies the [local modules](../../../../apps/desktop/src/harness/README.md). A [shipped Web composition test](../../../../apps/web/tests/harness-closed-loop.e2e.ts) drives browser submission through the existing Agent loop and platform shell, observes the tool result in the next model request, and verifies the reply and Session events. Only the external model adapter is deterministic.

The local Session state events distinguish idle, error, and completed; active entries from paused record resumed. These events belong to the process-local implementation, not the released Cordis Session format.

## Alternatives considered

**Introduce parallel LLM, MCP, or IPC services under the local Harness tree.** Rejected for this validation work: the Host already owns those services, and a second implementation would not establish integration with the shipped application.

**Treat terminal or startup smoke tests as full acceptance.** Rejected: they omit browser submission, model-tool scheduling, the following request, and durable events.

**Refresh failing historical snapshots.** Rejected when the recorded bash call is unavailable in the Windows preset or controls have drifted: refreshing the expected output would preserve a failed execution instead of validating the intended effect.

## Consequences

The local fixture is both a runnable example and an integration regression, without becoming another application entrypoint. The Web test validates real downstream execution without provider credentials, but cannot qualify live-model behavior. Host-process tests exercise process IPC with a fixture child; they do not qualify an Electron window. Historical replay failures remain separate evidence, and no existing Session generation is rewritten.
