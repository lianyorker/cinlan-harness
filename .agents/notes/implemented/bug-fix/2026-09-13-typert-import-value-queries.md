# Agent Note: Typert import value queries

Status: implemented

English | [中文](2026-09-13-typert-import-value-queries.zh.md)

## Problem

Qualified typeof import expressions can name variables or functions. Treating their symbols as class/interface declarations sends a declaration without members into the type member collector and crashes catalog analysis.

## Decision

Import value queries retain their module, qualifier, attributes, and type arguments without creating a named type-declaration target. Ordinary import type references continue through declaration analysis. The renderer reproduces the retained query.

## Alternatives considered

**Substitute an empty member array.** This fabricates a class/interface for a value and hides the classification error. Keeping the authored value query preserves its semantics without inventing a type declaration.

## Consequences

The regression test covers both imported constants and generic functions. Existing type-model, renderer, and schema-emitter tests remain unchanged. This does not waive missing documentation classifications or make the complete doc-sync corpus valid.

The [compiler-independent model decision](../architecture/2026-07-27-compiler-independent-typert-model.md) remains active; this fix preserves its distinction between retained type expressions and named declarations.
