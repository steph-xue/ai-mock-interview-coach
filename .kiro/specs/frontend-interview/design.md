# Frontend Interview Design

> Maintained design. Last verified: 2026-08-09.

## Overview

The frontend is a React, TypeScript, and Vite single-page application. A candidate uploads a PDF resume, pastes a job description, completes a real-time voice interview with Nova 2 Sonic, and receives structured feedback.

Local development connects to `backend.local_server:app` for the HTTP pipeline and voice relay. The hosted architecture uses AWS Amplify Hosting, Lambda, and a short-lived signed `wss://` connection to AgentCore.

## Architecture

```text
Amplify-hosted React/Vite browser
  └─ HTTPS → CloudFront API distribution (OAC)
               ├─ private Demo Session Function URL → DynamoDB admission table
               ├─ private PDF Parser Function URL
               ├─ private Analyst Function URL (OpenAI gpt-oss-120b)
               ├─ private Interviewer Function URL + S3 configuration
               ├─ private Evaluator Function URL (OpenAI gpt-oss-120b)
               └─ private Voice Session Function URL → signed WSS
                                                       └─ AgentCore relay → Nova 2 Sonic
```

Hosted integration requirements:

- Production builds select the configured CloudFront HTTPS API base URL with `VITE_RUNTIME_MODE=hosted`; the voice-session response supplies a temporary signed WSS URL.
- Amplify Hosting, the Voice Session Lambda, and the signed AgentCore WebSocket flow are deployed; the application intentionally has no end-user login.
- One CloudFront API distribution routes to private `AWS_IAM` Lambda Function URLs using Origin Access Control. The Function URL CORS settings allow the configured Amplify origin plus exactly `http://localhost:5173` for hosted-mode local testing.
- The protocol is unit-tested and has been exercised through the hosted browser/Nova path; real reconnection and session-restoration edge cases remain targeted verification work.

## Security and Cost Controls

- Hosted functions have invocation/error/throttle alarms, an AWS cost budget, and a zero-concurrency emergency switch. Optional normal concurrency caps default off until the target AWS account quota supports them.
- Hosted model calls use bounded text and 4,096-token output limits; hosted voice sessions have an eight-minute application limit.
- Hosted processing begins with an atomic admission request. Defaults are 100 interviews globally and 100 per trusted viewer IP per UTC day. The two-hour opaque token is stored only as a SHA-256 digest, bound to the viewer-IP digest, and used with bounded per-stage attempts.
- A CloudFront viewer-request function rejects unknown API paths and methods other than `POST` or `OPTIONS` before they reach a Lambda origin.
- Pure local mode keeps the pre-existing 8,192-token output budget and has no application-imposed eight-minute voice limit.

## Screen Flow

```text
Upload → Waiting Room → Interview → Feedback
```

1. Upload stores the selected PDF and job description in session state.
2. Waiting Room obtains an interview token, runs the HTTP analysis pipeline with that token, then connects the WebSocket through an authorized Voice Session request.
3. The interview starts only after both the Analyst context and WebSocket session acknowledgment are ready.
4. Final Nova transcripts are accumulated in session state.
5. At interview end, transcript entries are paired into the canonical Evaluator request.
6. Feedback displays loading, error, or result state.

## Component Responsibilities

### UploadScreen

- Accept one `application/pdf` file no larger than the shared 4 MiB (4,194,304 bytes) frontend/backend limit.
- Accept job-description text up to 5,000 characters and display its live count.
- Disable submission when either required input is missing.
- Pass the actual `File` and text to the session reducer.

### WaitingRoom

- Obtain one hosted admission token before invoking any downstream stage; pure local mode receives the local sentinel token.
- Call PDF Parser, Analyst, and Interviewer through `callAgent1`.
- Connect the real WebSocket client by default.
- Use `VITE_USE_MOCK_WEBSOCKET=true` only for intentional development mocking.
- Send `session_start` once both HTTP context and socket connection are ready.
- Transition after `session_start_ack`.
- Retry only the failed side. Enforce a 30-second relay timeout and a 330-second Agent 1 timeout, aborting stale Agent 1 HTTP work before retry.
- Preserve the current admission token during bounded stage retries. Practice Again clears it and requests a new interview admission.

### InterviewScreen

- Capture 16 kHz, 16-bit mono PCM audio.
- Play 24 kHz, 16-bit mono PCM audio.
- Show active-speaker state.
- Require microphone access and show an accessible remediation message when permission is denied.
- Accumulate only `FINAL` transcript events.
- Allow barge-in by stopping queued playback on `interrupted`.
- Keep the manual End button available at all times.
- Warn before page unload during an active interview.

### FeedbackScreen

- Show Evaluator loading and retry states.
- Store the direct Evaluator response object.
- Render successful results through the typed `FeedbackReport` components.
- Keep transcript viewing explicitly pending.
- Offer `Retry with This Resume` to preserve upload/analysis/context and start a fresh voice session.
- Offer `Retry with New Resume` to reset the application to Upload.

## State Model

The reducer owns one in-memory interview session:

```typescript
interface SessionState {
  phase: 'upload' | 'waiting' | 'interview' | 'feedback';
  uploadData: { pdf: File; jdText: string } | null;
  hostedSessionToken: string | null;
  analystOutput: Record<string, unknown> | null;
  novaSonicContext: string;
  transcript: TranscriptEntry[];
  livePartial: { role: 'interviewer' | 'user'; text: string } | null;
  turnState: 'ai_speaking' | 'user_turn' | 'idle' | 'ended';
  inputMode: 'voice' | 'text_only'; // retained legacy reducer state; no text-only UI
  textInputState: 'idle' | 'composing'; // retained protocol/reducer state; no typed-answer UI
  practiceMode: boolean;
  elapsedSeconds: number;
  wsConnectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  agent1Ready: boolean;
  wsReady: boolean;
  error: SessionError | null;
  agent3Loading: boolean;
  feedbackResult: EvaluatorOutput | null;
  endReason: 'auto' | 'manual' | null;
}
```

`RESET` returns every field to `initialState`.

`SESSION_TOKEN_READY` stores the opaque token only in memory. `RETRY_INTERVIEW` clears it so a new hosted interview consumes a new admission slot.

## HTTP Pipeline

### Agent 1 aggregate client

`callAgent1` performs:

1. PDF Parser: session token, PDF base64, and job description.
2. Analyst: session token plus extracted resume and job-posting text.
3. Interviewer: session token plus complete `analyst_output`.

It returns:

```typescript
interface Agent1Response {
  nova_sonic_context: string;
  analyst_output?: Record<string, unknown>;
}
```

The Interviewer uses its own response envelope:

```json
{"success": true, "runtime_context": "..."}
```

### Evaluator

The request matches `schemas/interviewer_output.json`:

```typescript
interface Agent3Request {
  session_token: string;
  conversation: Array<{
    point_id: string;
    turn_type: 'main_question' | 'follow_up';
    question: string;
    answer: string;
  }>;
  interview_metadata: InterviewMetadata;
  analyst_output: Record<string, unknown>;
}
```

Nova is prompted to ask three main questions and one adaptive follow-up after each, but application state does not guarantee that sequence. The mapper accepts the first six completed question-answer pairs, labels them by expected position, marks six pairs `completed`, and marks fewer pairs `ended_early`. An unanswered final closing is not included.

## WebSocket Protocol

Browser input events:

| Event | Purpose |
|---|---|
| `session_start` | Send runtime context and inference settings |
| `audio_chunk` | Send base64 PCM microphone data |
| `text_input` | Supported by the relay protocol, but not exposed by the maintained browser UI |
| `session_end` | Close the interview session |

Relay output events:

| Event | Purpose |
|---|---|
| `session_start_ack` | Confirm Nova session setup |
| `audio_output` | Provide base64 PCM speech |
| `text_output` | Provide user/interviewer transcript text |
| `tool_use` | Signal tools such as `end_interview` |
| `interrupted` | Stop current AI playback for barge-in |
| `content_end` | Mark a content block complete |
| `completion_end` | Mark a response complete |
| `session_invalid` | Report an invalid or expired session |

`backend/voice_agent/protocol.py` owns Nova identifiers and translates this browser contract into the Nova event lifecycle. It configures `end_interview` and sends an initial interactive text event so the interviewer speaks first.

## Audio and Turn Handling

- Microphone frames are captured through an AudioWorklet without blocking the main thread.
- Echo cancellation and noise suppression are requested from the browser.
- Playback uses chained `AudioBufferSourceNode` instances.
- Only final transcript stages are persisted.
- Practice Mode affects presentation only and must never alter backend messages.

## End and Retry Behavior

Automatic end:

1. Nova emits `end_interview`; after Nova closes that TOOL output block, the relay returns the result inside a fresh `contentStart(TOOL)` → `toolResult` → `contentEnd` input block.
2. The relay holds the browser-facing `tool_use` until Nova emits `completionEnd`, preventing early audio shutdown.
3. The browser receives `tool_use`, waits for final audio playback, sends `session_end`, disconnects, and enters Feedback.
4. Invoke the Evaluator.

Manual end:

1. Display confirmation.
2. Stop playback immediately after confirmation.
3. Send `session_end`, disconnect, and enter Feedback.
4. Invoke the Evaluator with completed pairs so far.

Evaluator failure keeps the transcript and Analyst output available for retry.

## Runtime Configuration

Local development uses the combined backend on port 8080 and bypasses hosted admission. Hosted builds receive one CloudFront HTTPS API base URL through the hosting environment; `/session` returns the opaque interview token and `/voice-session` returns the temporary signed WSS URL at runtime. AWS credentials belong to backend runtime identities rather than browser configuration.

## Verification Properties

1. Non-PDF or over-4-MiB uploads are rejected by the current frontend.
2. Submit remains disabled until both inputs exist.
3. Waiting Room times out unless both dependencies become ready.
4. Retry invokes only the failed dependency.
5. Barge-in stops playback immediately.
6. Reconnection attempts remain bounded.
7. Practice Mode changes UI only.
8. Only final transcript events are retained, in order.
9. `session_start` is sent only after context and socket readiness.
10. `end_interview` waits for playback before automatic shutdown.
11. The End button remains enabled throughout the interview.
12. Hosted downstream requests cannot start until admission succeeds, and every stage uses the current in-memory session token.

## Remaining Work

- Implement the FeedbackReport transcript view.
- Verify reconnection with real AgentCore session behavior and history restoration.
- Run a live Nova browser test.
