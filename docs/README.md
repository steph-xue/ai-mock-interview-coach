# Documentation Index

Last verified: 2026-08-09.

## Current Guides

- `guides/frontend-backend-wiring.md` — implemented integration state, deployed Amplify/AgentCore topology, exact HTTP contracts, and local workflow
- `guides/infra-breakdown.md` — CDK resources, hosted architecture boundaries, outputs, and local troubleshooting
- `../backend/voice_agent/README.md` — local Nova relay and hosted AgentCore runtime architecture
- `../backend/functions/evaluator/README.md` — Evaluator input, output, implementation details, and local tests

## Historical Reference

- `guides/frontend-integration-guide.md` — retired Cognito/direct-Bedrock experiment; preserved for architecture context only

## Kiro Documentation Lifecycle

- `.kiro/steering/*.md` is active cross-project guidance.
- `.kiro/specs/**/requirements.md` and `design.md` are maintained requirements/design documents unless their header explicitly marks them as superseded historical reference.
- Task files identify themselves as either active trackers or historical implementation records.
- Generated `*.meta.json` files preserve Kiro execution history and may contain historical wording.

The JSON files in `schemas/` are descriptive cross-component payload shapes, not machine-validatable JSON Schema documents. Runtime validators and handlers define enforced behavior. When documentation disagrees, use current code and `infrastructure/lib/infra-stack.ts` as implementation truth, then update the maintained document and its descriptive schema together.

## Architecture Status

The hosted architecture is a React/Vite frontend on AWS Amplify Hosting. A CloudFront route invokes the private Voice Session Lambda to create five-minute signed browser WebSocket URLs for an Amazon Bedrock AgentCore Runtime voice relay. AgentCore is a serverless managed container runtime; AWS operates and scales the underlying compute while this project owns the Python relay. The relay invokes Nova 2 Sonic. Four pipeline Lambdas provide PDF parsing, resume analysis, interview context construction, and evaluation; a sixth Demo Session Lambda issues quota-bound tokens. S3 stores interview configuration, DynamoDB stores only expiring hashed tokens/counters, and CDK defines the hosted backend.

The browser/relay protocol adapter, Voice Session Lambda, Amplify site, local URL, and opt-in mock are implemented. Path-filtered GitHub Actions workflows publish frontend, Lambda/CDK, and AgentCore changes from `main`; GitHub OIDC supplies short-lived AWS credentials without repository access keys. Pure local development uses the active developer AWS identity. Hosted admission, monitoring, budget, and workload controls are documented in [Infrastructure Breakdown](guides/infra-breakdown.md#security-and-cost-controls).

For local development, one Python process runs the admission route, four pipeline HTTP handlers, and Nova voice relay using the developer's AWS credential chain. The credentials must allow gpt-oss-120b and Nova 2 Sonic, and startup prints the active AWS identity that owns local model usage and charges. See `guides/frontend-backend-wiring.md` for the complete two-terminal workflow. Hosted operation uses the Amplify + AgentCore architecture.
