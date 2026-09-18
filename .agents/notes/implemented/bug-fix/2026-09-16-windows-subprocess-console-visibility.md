# Agent Note: Hide Windows subprocess console windows at creation

Status: implemented

English | [中文](2026-09-16-windows-subprocess-console-visibility.zh.md)

## Problem

A GUI host can start shell commands without an attached console. The private Windows Job runner and its native target each create a process, so either launch can open a visible console and cause a short-lived window to flash during background work.

## Decision

The private Node Job runner uses `windowsHide: true`. Shared ordinary and restricted-token process creation supplies `STARTF_USESHOWWINDOW` and `SW_HIDE` alongside standard handles before target code runs, including the anonymous-pipe path. Console inheritance, Job assignment before resume, and stdin/output ownership remain intact. No operation hides an existing parent console or suppresses windows explicitly opened by the command.

This adapts the visibility changes from official DeepSeek Harness commit [`f8b1309fe55ad29d54451886049d0c541be94d5a`](https://github.com/deepseek-ai/deepseek-harness/commit/f8b1309fe55ad29d54451886049d0c541be94d5a). The local eager Koffi structures and existing runner protocol remain the implementation owners; the adaptation does not add upstream control descriptors or change binding initialization.

The [ACL sandbox decision](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md) retains restricted-token policy and console-isolation limits. The [native containment decision](../architecture/2026-08-28-subprocess-native-containment.md) retains process and Job ownership. Neither decision is superseded by the initial visibility setting.

## Alternatives considered

**Hide only the outer runner.** Native target creation is independent of Node's launch options, so it also needs an explicit initial visibility setting.

**Remove consoles from every process.** Restricted-token creation with `CREATE_NO_WINDOW` or `CREATE_NEW_CONSOLE` has a recorded DLL initialization failure. Startup visibility preserves console attachment and inherited standard handles.

**Hide the window after the shell starts.** A window can become visible before the script executes. Creation-time settings avoid that interval.

## Verification

Startup-parameter tests pin the runner option and native startup fields for ordinary, inherited restricted-token, and piped launches while retaining creation flags and handle cleanup checks. The native descendant regression starts a private source-launched host that detaches only its own console. A descendant with ordinary inherited stdio must retain a console and report it hidden through `GetConsoleWindow` and `IsWindowVisible`. This isolation prevents an already-hidden test host console from masking the defect: the test reports `visible: true` without the fix. The fixture uses the existing ESM source launcher across supported Node versions and waits for Job settlement before exit.

The native ACL runner suite exercises both file modes, PowerShell initialization, inherited descendant stdio, and named-pipe denial with the visibility flags enabled. The C++ ABI probe checks both visibility constants against Windows headers. Session recordings cannot observe native console windows, and transcripts are unchanged; native Windows evidence owns this regression.

## Consequences

Ordinary background commands suppress incidental console windows while preserving descendant console attachment and process cleanup. Window visibility remains an initial request, not a policy against commands that deliberately create or show windows. Console isolation under restricted tokens remains outside this change.
