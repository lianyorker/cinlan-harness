# Agent Note: Live full-text search admission

Status: implemented

English | [中文](2026-10-19-content-search-admission.zh.md)

## Problem

Full-text search observes Session contents and owns a derived index. Users need to stop those requests without disabling exact history reads or destroying the index, and an old queued request must not return results after the user closes admission.

## Decision

The [SQLite query service](../../../../packages/session-query/session-query-sqlite/README.md) owns live `searchEnabled` configuration, enabled by default. Deployment `openAt: never` remains authoritative. Admission checks before normalization, before queued work, after opening, and after reconciliation reject disabled or superseded requests. A revision changes when the live field commits, so immediately re-enabling cannot admit old requests. Existing reconciliation may finish; no index or Session data is deleted. Exact reads, filters, and traces keep their existing behavior.

General settings uses the existing accepted-value, revision-fenced form and a shared boolean presentation with automatic titles. Namespace withdrawal removes its control and search anchor. There is no Session event, schema-version bump, or new model tool.

## Alternatives considered

Changing `openAt` live mixes lifecycle with admission. Removing the whole query service breaks exact reads. Closing or deleting the index on every toggle introduces resource ownership and data-loss effects that are not required. Checking only at submission lets queued requests return after disable.

## Consequences

This is not data erasure or caller authorization. Synchronous SQLite statements cannot be interrupted. Owner tests cover no index opening while disabled, unchanged service lifetime, deployment precedence, both queued search scopes, rapid disable/re-enable, profile persistence and cold restart, accepted UI readback, read-only input, failures, and index retention. They do not establish browser visual or cross-platform acceptance.
