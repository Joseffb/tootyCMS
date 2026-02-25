# Security CI Guardrails

Tooty enforces secret scanning before commit, build, and deploy.

## Local hooks

- `pre-commit` runs `npm run scan:secrets:staged`
- `pre-push` runs:
  - `npm run scan:secrets`
  - `npm run test`
  - `npm run test:integration`

Install hooks:

```bash
npm run hooks:install
```

## CI gates

Workflow: `.github/workflows/core-ci.yml`

- `secret-scan` job runs first on PR/push.
- `build-and-test` runs only after scan passes.
- `deploy-guard` reruns secret scan on main/master pushes before deploy-stage continuation.

## Scanner commands

- Full repo scan: `npm run scan:secrets`
- Staged-only scan: `npm run scan:secrets:staged`

## Detection scope

Current scanner blocks on:

- Private key blocks
- AWS access keys
- GitHub tokens
- Slack tokens
- Generic secret/token/password assignments
- Bearer token patterns

The scanner skips binary/build artifacts and allows obvious placeholder values in docs/examples.
