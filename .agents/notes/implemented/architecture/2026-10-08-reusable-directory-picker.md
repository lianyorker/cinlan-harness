# Agent Note: Reusable composed directory picker

Status: implemented

English | [中文](2026-10-08-reusable-directory-picker.zh.md)

## Problem

SDK settings needs a folder selection without creating a Workspace. Calling the Host native pick Remote directly cannot open the browse composition and bypasses the Desktop preload bridge.

## Decision

The composed native or browse client registers the root-scoped `directory.picker` Factory declared by `ui-workspace`. Callers supply the existing `DirectoryFlowOwnerProps` and adopt the returned path. The definition is independent of Workspace child declarations and reuses the same picking component and injected callbacks. Exactly one picker definition is active; Cordis effects remove it on plugin disposal.

## Alternatives considered

A parallel settings chooser duplicates directory browsing and platform routing. Adding picker-kind branching to callers couples every consumer to composition details. Reusing the Workspace adoption flow would create unrelated Workspace objects.

## Consequences

SDK settings uses the selected composition without direct native-picker calls. Missing picker composition leaves manual input available. Each render occurrence owns its cancellation and result handling; disposing a native occurrence ignores the eventual OS result rather than closing the OS dialog. Verification covers independent Factory registration, disposal, Desktop bridge routing, browse cancellation and selection, and persisted SDK settings.
