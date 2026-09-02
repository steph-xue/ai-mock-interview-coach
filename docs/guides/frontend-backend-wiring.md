# Frontend–Backend Wiring Status

> Current-state guide. Last verified: 2026-08-09.

## Hosted Architecture

```text
React/Vite browser on AWS Amplify Hosting
  └─ HTTPS ─> CloudFront API distribution (OAC)
                ├─> private Demo Session Function URL ─> expiring quota/token records
                ├─> private PDF Parser / Analyst / Interviewer / Evaluator Function URLs
                └─> private Voice Session Function URL ─> short-lived signed WSS
                                                        └─ AgentCore relay ─> Nova 2 Sonic

CDK ─> six Lambdas + S3 interview configuration + DynamoDB quota records
```

CDK defines the four pipeline Lambdas, the voice-session signer Lambda, the Demo Session admission Lambda, the S3 configuration bucket, and the expiring DynamoDB quota table. Amplify Hosting serves the React build, while AgentCore runs the voice relay as a separate infrastructure boundary because the persistent bidirectional stream is not a good fit for a Lambda invocation.

The hosted architecture places Amplify, AgentCore, Lambda, S3, and Bedrock access in one AWS account. Account-specific identifiers and generated deployment state do not belong in version control.

AgentCore is serverless infrastructure from the application's perspective: it runs the relay as an AWS-managed container runtime, so this project does not provision or maintain an EC2 server. The relay can hold transient state for each active WebSocket session; durable interview state remains outside it.

## What Exists Today

- The CDK stack defines six private IAM-protected Lambda Function URLs, one CloudFront OAC distribution, an S3 configuration bucket, and a DynamoDB table for expiring quota/session records.
- The Python relay runs locally and on an AgentCore Runtime. Environment-specific runtime state is not tracked in this repository.
- The React frontend, HTTP clients, mock WebSocket path, and interview UI exist.
- Amplify hosts the production React build. Its app identifier, domain, and environment-specific endpoint values are not tracked in this documentation.
- Browsers use the CloudFront API base URL. CloudFront signs origin requests with Origin Access Control; direct Function URL requests require IAM and are rejected for anonymous callers.
- Hosted requests use a short-lived interview token before the pipeline begins. See [Infrastructure Breakdown](infra-breakdown.md#security-and-cost-controls) for the implemented admission, monitoring, budget, and workload controls.
- The frontend/relay wire protocol is aligned, unit-tested, and used by the hosted Nova flow.
- The serialized application workflow deploys the CDK backend before publishing the same `main` revision to Amplify; a separate workflow updates AgentCore. Both reject stale revisions and share one production lock. They assume a restricted AWS role through GitHub OIDC and do not store permanent AWS access keys.

## Runtime Modes

Local mode is the default. It always uses:

```env
http://localhost:8080/api/session
http://localhost:8080/api/pdf-parser
http://localhost:8080/api/analyst
http://localhost:8080/api/interviewer
http://localhost:8080/api/evaluator
ws://localhost:8080/
```

Hosted mode reads one `VITE_API_BASE_URL` from its environment and uses its `/session`, `/pdf-parser`, `/analyst`, `/interviewer`, `/evaluator`, and `/voice-session` routes. Hosted JSON POSTs include a SHA-256 payload hash so CloudFront can sign the private Function URL request. The session route admits the interview and returns its opaque token; the voice-session route returns a fresh five-minute signed AgentCore WebSocket URL for each authorized connection attempt.

### Local development workflow

Prerequisites are Python 3.12, Node.js with npm, AWS CLI v2, and AWS credentials with gpt-oss-120b and Nova 2 Sonic access in `us-east-1`. Model availability and quotas are account-specific.

For a configured AWS profile, export the profile and region. IAM Identity Center profiles also need an active SSO login:

```bash
export AWS_PROFILE="<profile-name>"
export AWS_REGION="us-east-1"
aws sso login --profile "<profile-name>" # IAM Identity Center profiles only
```

Alternatively, export temporary credentials in terminal 1:

```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."
export AWS_REGION="us-east-1"
```

From the repository root, start the backend in terminal 1:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-local.txt
aws sts get-caller-identity
.venv/bin/uvicorn backend.local_server:app --host 127.0.0.1 --port 8080
```

The STS result and the server startup log identify the AWS account that owns local model usage and charges. In terminal 2, start the frontend:

```bash
cd frontend
npm ci
npm run dev
```

PDF parsing and interview configuration remain local; Analyst, Evaluator, and Nova calls use the displayed AWS identity. With `VITE_RUNTIME_MODE=local` (the default), `VITE_API_BASE_URL` is ignored and no deployed endpoint is required. Setting the mode explicitly to `hosted` exercises the hosted services. Hosted-mode browser testing must use `http://localhost:5173`, the exact local origin allowed by hosted CORS; stop another Vite process instead of accepting Vite's fallback to port 5174. Local model calls retain the 8,192-token output budget and local voice has no application-imposed eight-minute limit. The product-wide 5,000-character job-description and 4 MiB PDF limits still apply, as do AWS quotas. Never commit account identifiers or credentials.

The hosted Amplify build requests a short-lived signed WebSocket URL from the voice-session Lambda. Permanent AWS credentials are never Vite variables because `VITE_*` values are bundled into browser code.

## Implemented HTTP Pipeline

The current frontend client is `frontend/src/services/agent1Client.ts`.

### Demo Session Admission

The hosted workflow obtains one short-lived session token before starting the pipeline and keeps it only in memory. Pure local mode receives its local sentinel token from the combined backend. Exact hosted limits and monitoring behavior are documented under [Security and Cost Controls](infra-breakdown.md#security-and-cost-controls).

Hosted mode first sends `{}` to `/session`. The response contains an opaque
`session_token` that expires after two hours and is bound to the trusted
CloudFront viewer address. Pure local mode returns a local sentinel token and
does not apply the hosted counter. Every request below includes that token.

### PDF Parser

Request:

```json
{
  "session_token": "<opaque-token>",
  "resume": {"content": "<base64>", "format": "pdf"},
  "job_posting": {"content": "<text>", "format": "text"}
}
```

Response envelope: `{"status": "success", "data": {...}}` or `{"status": "error", "error": "..."}`.

The frontend and backend both enforce a 4 MiB (4,194,304 bytes) PDF limit so oversized files are rejected before upload.

### Analyst

Request: `{"session_token": "<opaque-token>", "resume_text": "...", "job_posting_text": "..."}`.

Response envelope: `{"status": "success", "data": <analyst_output>}` or an error envelope. The output shape is defined by `schemas/analyst_output.json`.

### Interviewer

Request: `{"session_token": "<opaque-token>", "analyst_output": {...}}`.

Actual response body: `{"success": true, "runtime_context": "..."}` or `{"success": false, "error_message": "..."}`.

The frontend parses this Interviewer-specific envelope and retains the returned runtime context.

### Evaluator

Canonical completed-interview request shape (`schemas/interviewer_output.json`):

```json
{
  "session_token": "<opaque-token>",
  "conversation": [
    {
      "point_id": "point_1",
      "turn_type": "main_question",
      "question": "...",
      "answer": "..."
    }
  ],
  "interview_metadata": {},
  "analyst_output": {}
}
```

The Evaluator returns the feedback object directly through the CloudFront `/evaluator` response body; it does not wrap success as `{status, data}`.

The frontend retains the full Analyst output, pairs the final transcript into question-answer turns, sends this canonical request, and consumes the direct feedback body.

## Voice Integration and Authentication

The implemented backend voice path is:

```text
Browser WebSocket → AgentCore FastAPI relay → Nova 2 Sonic
```

The frontend and relay share application messages shaped as `{type, payload}`. `backend/voice_agent/protocol.py` expands those messages into the Nova event lifecycle, owns Nova identifiers, emits `session_start_ack`, and translates Nova responses back into browser audio/text/tool/interruption events. Focused contract tests cover setup, audio, text, shutdown, transcript stages, output audio, interruption, credential resolution, and the FastAPI endpoint with a fake Nova manager.

In the hosted architecture, the browser requests a short-lived signed AgentCore URL from the voice-session Lambda. AgentCore verifies the Lambda role's SigV4 signature during the WebSocket handshake, and long-lived AWS access keys never belong in the browser.

## Current Frontend Flow

- Upload, waiting-room, interview, microphone/audio, reconnect, and feedback-state components exist.
- The real relay is the default. Set `VITE_USE_MOCK_WEBSOCKET=true` to opt into `MockWebSocketClient`.
- `FeedbackScreen` renders successful Evaluator results through the typed `FeedbackReport` after runtime response validation.
- The submitted PDF/JD and complete Analyst output are retained in active session state for downstream calls.
- Feedback offers **Retry with This Resume**, which preserves the uploaded inputs and analysis, and **Retry with New Resume**, which resets the flow to upload.

The hosted application intentionally has no end-user login. Its CloudFront request path and model-backed operations use the controls documented in [Infrastructure Breakdown](infra-breakdown.md#security-and-cost-controls); the raw Function URLs remain private.

## Verification Checklist

- [x] Frontend and backend both enforce a 4 MiB PDF limit.
- [x] Interviewer response is parsed using `success` and `runtime_context`.
- [x] Full Analyst output remains available through the interview.
- [x] Evaluator request matches `schemas/interviewer_output.json`.
- [x] Evaluator response is treated as the returned object, not `{status, data}`.
- [x] Hosted voice sessions request fresh signed URLs through `VITE_API_BASE_URL/voice-session`.
- [x] Frontend and relay share one WebSocket wire protocol with focused unit coverage.
- [x] Hosted browser flow is wired through Upload → Waiting → Interview → Feedback.
