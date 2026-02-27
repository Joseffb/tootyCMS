Deterministic Test Coverage & Invariant Enforcement Protocol

⸻

Purpose

This document defines the mandatory enforcement protocol for test coverage, invariant validation, and execution discipline in Tooty CMS.

AI assistants (Codex or otherwise) must follow this document when auditing, generating, or modifying tests.

This system is governance-driven. Coverage is not cosmetic. Invariants are mandatory.

⸻

1. Operating Mode

All test generation must operate in:

Deterministic Coverage Completion Mode

The goal is not to increase coverage percentage.
The goal is to eliminate invariant gaps.

⸻

2. Invariants (Non-Negotiable)

The following invariants must be exhaustively tested:

2.1 RBAC
•	No privilege escalation.
•	No bypass of capability resolver.
•	Group-scoped roles must not grant global permissions.
•	Plugin roles must not override core authority.
•	Network admin privileges must be explicitly enforced.

2.2 Tenant Isolation
•	No cross-tenant reads.
•	No cross-tenant writes.
•	No cross-tenant query leakage.
•	No cache contamination across tenants.
•	No scheduler job execution outside tenant context.

2.3 Export / Import Spine
•	Export cannot execute without approval code.
•	Approval code must be one-time use.
•	All export attempts must emit audit event.
•	Removing mother export plugin disables all child export actions.
•	Export artifacts must be scoped to site_id.

2.4 Webhooks
•	All webhook deliveries must be idempotent.
•	Duplicate events must not cause duplicate side effects.
•	Signature validation must reject tampered payloads.
•	ExternalEventId uniqueness must be enforced.

2.5 Scheduler
•	Retry logic must not duplicate execution.
•	Dead-letter flow must capture permanent failure.
•	Scheduler must not execute in invalid lifecycle state.
•	Jobs must respect tenant boundaries.

2.6 Lifecycle & Workflow
•	Illegal transitions must be rejected.
•	UI must derive state from registry, not hardcoded values.
•	Scheduled publish/unpublish must honor RBAC.

2.7 Migration System
•	No partial-state persistence.
•	Migration version must increment deterministically.
•	Migration must fail atomically.
•	Rollback behavior must be tested.

2.8 Signing System
•	Unsigned extensions rejected when enforcement enabled.
•	Tampered signatures rejected.
•	Key rotation must not invalidate valid signatures.

⸻

3. Coverage Audit Procedure

Step 1 — Run Coverage

npm run test -- --coverage

Collect:
•	Statement coverage
•	Branch coverage
•	Function coverage
•	Line coverage
•	Uncovered branches

⸻

Step 2 — Map Uncovered Code to Invariants

For each uncovered branch:
•	Identify related invariant.
•	If no invariant exists → document reasoning.
•	If invariant exists → generate required test.

⸻

Step 3 — Generate Missing Tests

For each uncovered invariant:
•	Add unit test.
•	Add integration test if cross-module.
•	Add negative test (failure path).
•	Add boundary test (invalid input).
•	Add concurrency test where applicable.

Do not modify production code unless invariant violation is discovered.

⸻

4. End-to-End Enforcement (Playwright)

Mandatory E2E flows:
•	Unauthorized user attempting restricted action.
•	Cross-tenant access attempt.
•	Export initiation without approval.
•	Export with expired/used code.
•	Admin approval flow end-to-end.
•	Plugin removal disabling export.
•	Lifecycle invalid transition attempt.

Run:

npx playwright test

E2E tests must be deterministic.
No sleep-based timing hacks allowed.

⸻

5. Build Integrity Checks

Run:

npm run build
npm run lint
npm audit

Add tests that:
•	Fail if build artifacts change unexpectedly.
•	Verify signing enforcement behavior.
•	Validate extension load compatibility.

⸻

6. Mutation Validation (Required)

Temporarily disable:
•	RBAC check
•	Idempotency enforcement
•	Approval code validation

Re-run tests.

Tests must fail.

If tests still pass:
•	Add missing test.
•	Repeat until failure is detected.

Restore original logic.

⸻

7. Completion Criteria

Testing phase is complete only if:
•	Branch coverage ≥ 90%
•	Critical invariants coverage = 100%
•	No uncovered RBAC branches
•	No uncovered tenant filter paths
•	No uncovered lifecycle transitions
•	Mutation validation produces expected failures
•	CI blocks invariant regression

⸻

8. Output Requirements (For AI Execution)

AI must provide:
1.	Coverage report summary.
2.	List of missing invariant tests added.
3.	List of high-risk areas discovered.
4.	Confirmation of mutation validation.
5.	Remaining uncovered non-critical lines (if any).

⸻

9. Prohibited Behavior

AI must NOT:
•	Inflate coverage with meaningless tests.
•	Skip negative cases.
•	Assume invariants implicitly covered.
•	Modify production code to artificially pass tests.
•	Use timing-based hacks in E2E.

⸻

10. Philosophy

Coverage percentage is not the goal.

Invariant enforcement is the goal.

Tooty CMS is governance-first.

All critical paths must be provably defended.
