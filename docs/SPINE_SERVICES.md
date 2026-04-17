# Spine Services

This document defines the architectural meaning of a Spine Service in Tooty CMS.

## Definition

A Spine Service is a governed core subsystem that owns canonical semantics, normalization, routing, and dispatch for a capability class while allowing one or more replaceable providers to implement delivery or persistence through stable plugin contracts.

Key implications:

- Core may provide first-party default providers for a Spine Service.
- Plugins may register alternate providers through governed extension contracts.
- Themes remain provider-agnostic and consume only stable DTOs, slots, or query outputs.
- Spine compliance is determined by replaceability and the absence of bypass paths, not by requiring core to be an empty orchestrator.

## Why This Exists

Some capability classes must remain platform-governed even when providers are replaceable.

Examples:

- analytics
- ai
- comments
- communications
- webcallbacks

For these systems, core must retain authority over:

- canonical payload or record semantics
- normalization and validation
- lifecycle and audit boundaries
- routing and dispatch entrypoints
- permission and tenant enforcement before provider execution

Providers are interchangeable implementations behind that governed surface.

## Canonical Spine Inventory (Pre-v1)

The following subsystems are formally recognized as Spine Services:

### 1. Media Spine

Authoritative contract:

- See the Media Spine system documentation and related media contracts.

Core owns:

- transport
- indexing
- URL resolution
- cleanup

Providers are storage adapters only.

### 2. Analytics Spine

Core owns:

- canonical event names
- canonical event envelope and versioning
- consent gate
- dispatch entrypoint (`domain:event`)
- query and script adapter surfaces
- tenant enforcement before dispatch

Analytics plugins:

- are transport adapters only
- may forward events
- may implement query adapters
- may implement script adapters
- must not redefine canonical event semantics

Invariant:

- raw HTTP requests may originate externally
- canonical analytics events do not bypass core normalization and dispatch

### 3. Comments Spine

Core owns:

- canonical comment model semantics
- provider registry
- lifecycle and moderation normalization
- tenant enforcement
- write entrypoint
- metadata structure
- audit boundaries

Comment providers:

- must register through the governed provider registry
- may use core adapter helpers (for example `createTableBackedProvider()`)
- may be fully external implementations
- must not write directly to comment tables outside the spine

Invariant:

- no comment write may bypass provider resolution
- disabling the active provider disables comment writes

### 4. AI Spine

Core owns:

- canonical AI request/response semantics
- explicit scope normalization (`site` or `network`)
- RBAC and quota enforcement before provider execution
- provider resolution and dispatch
- output validation and guard decisions (`allow`, `modify`, `reject`)
- trace boundaries and returned `traceId`

AI providers:

- register through the governed provider registry
- receive normalized execution input only
- return normalized execution output only
- are pure adapters and must not perform policy, RBAC, tenant, or side-effect work

Invariant:

- all AI execution must flow through the AI spine
- providers must be replaceable without changing plugin behavior
- AI execution returns suggestions only and must not perform writes, publishing, scheduling, or external side effects

## Spine Integrity Enforcement (Required)

For any declared Spine Service:

- No alternate legacy route may bypass the governed entrypoint.
- Themes must remain presentation-only.
- Plugins must not directly mutate spine-owned tables.
- Provider resolution must be mandatory.
- Tenant boundary must be enforced before persistence or dispatch.
- Trace logging must exist at entry, success, and failure boundaries.

If any of the above are violated, the subsystem is not spine-compliant.

## Spine Classification Rule

A subsystem may be promoted to Spine status only if:

1. It governs a cross-cutting capability class.
2. It requires platform-level normalization.
3. It requires tenant boundary enforcement.
4. Providers must be replaceable without altering theme contracts.
5. Bypass paths can be structurally eliminated.

Spine designation is architectural, not cosmetic.

## Spine Audit Checklist

A subsystem qualifies as a Spine Service when:

1. Canonical semantics are defined and owned by core.
2. All writes or dispatches funnel through a single governed entrypoint.
3. Provider resolution is mandatory and deterministic.
4. Disabling the provider disables the capability class for that surface.
5. No alternate runtime path bypasses normalization or dispatch.
6. Themes have no side-effect authority over the subsystem.
7. Plugins interact only through declared extension contracts.
8. Tenant isolation is enforced before persistence or provider delivery.
9. Trace or audit logging exists at success and failure boundaries.

## What A Spine Service Is Not

A Spine Service does not require:

- core to be a zero-implementation orchestrator
- every first-party capability to live outside core
- themes to understand provider-specific internals

The requirement is that providers remain replaceable without changing core contracts or theme contracts.

## Current Interpretation In Tooty

For a governed subsystem:

- core owns the spine
- first-party plugins may package or activate default providers
- third-party plugins may replace those providers through the same registry

Examples:

- a native comments provider may use Tooty's own comment infrastructure
- a third-party comments provider may register against the same comments spine and avoid Tooty's comment tables entirely
- analytics requests may originate externally, but canonical analytics event emission still normalizes and dispatches through core

If the provider can be replaced through the same contract without introducing bypass routes, the subsystem remains spine-compliant.
