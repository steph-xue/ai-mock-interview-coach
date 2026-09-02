# Voice Agent Relay

FastAPI WebSocket relay deployed to Amazon Bedrock AgentCore Runtime. It connects each browser WebSocket session to an Amazon Nova 2 Sonic bidirectional stream.

AgentCore Runtime is a serverless managed container runtime. This project supplies the Python container and pays for usage; AWS manages the underlying hosts and scaling. The relay is still backend application code, but there is no EC2 server to provision or administer.

## Files

- `server.py` — FastAPI WebSocket endpoints at `/` and `/ws`, plus `/ping` and `/health`
- `protocol.py` — browser `{type, payload}` to/from Nova event adapter
- `s2s_session_manager.py` — Nova stream lifecycle and audio queue
- `s2s_events.py` — Nova protocol event builders
- `Dockerfile` — Python 3.12 container on port 8080
- `agentcore/` — current AgentCore CLI configuration and generated CDK application

## Runtime

- Region: `us-east-1`
- Model: `amazon.nova-2-sonic-v1:0`
- Input audio: 16 kHz, 16-bit, mono LPCM
- Output audio: 24 kHz, 16-bit, mono LPCM

The browser and relay share the application-level `{type, payload}` contract defined by `frontend/src/services/webSocketClient.ts`. The relay owns Nova prompt/content identifiers, expands `session_start` into the required Nova event sequence, acknowledges setup with `session_start_ack`, routes audio through its bounded queue, and converts Nova audio/text/tool/interruption output back to browser events. For `end_interview`, the relay waits for Nova's TOOL output block to close, returns the result inside a fresh TOOL input block, waits for `completionEnd`, and only then releases the browser-facing `tool_use`; this preserves the required Nova lifecycle and closing audio before shutdown. Focused unit tests cover the adapter, and the signed hosted path is deployed.

The hosted path is:

```text
React/Vite on Amplify Hosting
  └─ CloudFront `/session` route ─> daily admission + opaque token
       └─ CloudFront `/voice-session` route with token (OAC)
       └─ private Voice Session Function URL ─> short-lived signed WSS
                                              └─ AgentCore relay ─> Nova 2 Sonic
```

The browser first obtains an opaque admission token, then calls the CloudFront `/voice-session` route with it; OAC invokes the private Voice Session Function URL, whose resource-scoped role creates a fresh five-minute SigV4-signed AgentCore `wss://` URL. The browser never receives permanent AWS credentials or invokes Nova directly.

## Security and Cost Controls

The application has no end-user login. Hosted tokens last two hours, are bound to the trusted viewer-IP digest, and allow three Voice Session attempts for the initial connection plus two reconnects. Hosted sessions have an eight-minute application limit, and the Voice Session Lambda is covered by alarms and the stack's AWS cost budget. Its optional normal concurrency cap defaults off until the target account quota supports it; the zero-concurrency emergency switch remains available.

## Local Run

The combined local backend resolves credentials through boto3's standard chain. Use a configured AWS profile with access to gpt-oss-120b and Nova 2 Sonic:

```bash
export AWS_PROFILE="<profile-name>"
export AWS_REGION="us-east-1"
aws sso login --profile "<profile-name>" # IAM Identity Center profiles only
```

Alternatively, export access keys in the relay terminal. `AWS_SESSION_TOKEN` is required only for temporary credentials:

```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."
export AWS_REGION="us-east-1"
```

The server prints the active AWS account and ARN during startup. All local model usage is attributed to that credential identity. The hosted AgentCore runtime uses its execution-role identity. AWS credentials belong in backend runtime configuration rather than frontend variables.

Start the complete local application backend from the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-local.txt
aws sts get-caller-identity
.venv/bin/uvicorn backend.local_server:app --host 127.0.0.1 --port 8080
```

The combined server exposes HTTP handlers under `/api`, WebSocket routes at `/` and `/ws`, and health checks at `/api/health`, `/ping`, and `/health`.

Pure local voice sessions bypass hosted daily admission and do not enable the hosted eight-minute application limit. AWS service quotas and credential lifetime still apply.

## Hosted Runtime

The hosted architecture runs this relay on AgentCore and serves the React frontend through Amplify. AgentCore, Amplify, and the CDK backend are deployed as separate infrastructure boundaries. Environment-specific target files, generated runtime state, account IDs, endpoints, and credentials are not committed.

Changes under the voice-relay paths on `main` are tested and published by the AgentCore GitHub Actions workflow. It updates the existing AgentCore target through the pinned CLI and uses temporary AWS credentials from the repository's branch-restricted OIDC role.

## Verification

`tests/unit/test_voice_protocol.py` covers the pure adapter and exercises the WebSocket endpoint with a fake Nova session manager, so it does not invoke paid services. Manual helpers remain under `backend/voice_agent/tools/`: `test_voice_agent.py`, `test_voice_client.html`, and `generate_test_context.py`. Reconnection, interruption, and shutdown edge cases should still receive live regression checks whenever the protocol changes.
