# Infrastructure Breakdown

How the CDK project works, how it connects to the backend Lambdas and frontend, and how it fits the deployed Amplify/AgentCore architecture.

---

## Folder Structure

```
infrastructure/
├── bin/
│   ├── infra.ts            # Application backend stack entry point
│   └── deployment-automation.ts # GitHub OIDC automation entry point
├── lib/
│   ├── infra-stack.ts      # Six Lambdas, S3 configuration, and quota table
│   └── deployment-automation-stack.ts # GitHub Actions IAM/OIDC resources
├── cdk.json                # CDK CLI configuration (app command, feature flags)
├── package.json            # Node dependencies (aws-cdk-lib, constructs, dev tools)
├── tsconfig.json           # TypeScript compiler settings
└── cdk.out/                # Synthesized CloudFormation output (auto-generated)
```

---

## How CDK Works in This Project

### Entry Point (`bin/infra.ts`)

The CDK app is bootstrapped here. It creates a single stack named `MockInterviewStack` targeting `us-east-1`:

```ts
const app = new cdk.App();
new InfraStack(app, 'MockInterviewStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});
```

`CDK_DEFAULT_ACCOUNT` is resolved from your AWS CLI profile at deploy time.

### Stack Definition (`lib/infra-stack.ts`)

One stack defines the HTTP backend and interview configuration. The AgentCore voice relay is a separate infrastructure boundary.

| Resource | Construct | Purpose |
|----------|-----------|---------|
| S3 Bucket | `InterviewConfigBucket` | Stores interview structure and interview profile JSON configs |
| DynamoDB Table | `HostedInterviewSessions` | Stores expiring hashed session/quota records only |
| Demo Session Lambda | `DemoSessionFunction` | Atomically enforces daily global/viewer limits and issues opaque tokens |
| Analyst Lambda | `AnalystFunction` | Calls Bedrock Mantle (gpt-oss-120b) to analyze the resume against the job description |
| Evaluator Lambda | `EvaluatorFunction` | Calls Bedrock Mantle (gpt-oss-120b) to score the candidate's interview transcript |
| Interviewer Lambda | `InterviewerFunction` | Reads config from S3, builds runtime context for Nova Sonic (no LLM call) |
| PDF Parser Lambda | `PdfParserFunction` | Extracts text from uploaded resumes using pypdf |
| Voice Session Lambda | `VoiceSessionFunction` | Creates five-minute signed AgentCore WebSocket URLs |

Every Lambda gets a private **Function URL** with `AWS_IAM` authentication. A single CloudFront distribution uses Origin Access Control to sign requests to those origins. Local requests reach the same handler logic through `backend.local_server:app`. A viewer-request function rejects unknown paths and methods other than `POST`/`OPTIONS` before origin invocation.

The names above are CDK construct IDs. Because `functionName` is not set, CloudFormation generates the deployed physical Lambda names.

### Key Design Decisions

- **CloudFront without API Gateway.** CloudFront provides path routing and OAC request signing; private Function URLs remain the origins. CORS is configured on the URL resource for the hosted Amplify origin and `http://localhost:5173`, not in Python code.
- **No VPC.** Lambdas run in the default VPC-less mode for simplicity.
- **Docker bundling for pypdf.** The PDF Parser uses CDK's `bundling` option to `pip install pypdf` into the deployment package at synth time.
- **IAM permissions are scoped by responsibility.** Analyst/Evaluator receive model-scoped Bedrock Mantle inference, Interviewer receives `s3:GetObject` through `grantRead`, and Voice Session can invoke only the configured AgentCore runtime and its endpoints.

### Security and Cost Controls

The application intentionally has no end-user login. The hosted stack applies exact browser origins, daily admission, IP-bound session tokens, bounded stage attempts, monitoring, a monthly cost budget, workload limits, an emergency switch, and scoped IAM roles. CORS controls browser access and is not authentication or rate limiting.

- **Hosted admission controls.** An atomic DynamoDB transaction admits at most 100 sessions globally and 100 per trusted CloudFront viewer IP per UTC day by default. Tokens expire after two hours, are stored only as SHA-256 digests, and are bound to the viewer-IP digest. Each token permits at most 2 PDF Parser, 2 Analyst, 2 Interviewer, 2 Evaluator, and 3 Voice Session attempts. Both daily values are deployment parameters; pure local mode bypasses them.
- **Hosted cost controls.** Invocation alarms trigger above 10 Analyst/Evaluator/Voice Session or 25 Demo Session/Interviewer/PDF Parser calls in five minutes; error alarms trigger at three errors in five minutes; throttle alarms trigger at the first throttle. They publish to an email-backed SNS topic. The default $25 account-wide AWS monthly budget alerts at 50%, 80%, and 100%; the recipient must confirm the SNS subscription. These notifications do not automatically stop usage and AWS Budgets reporting can lag.
- **Emergency and optional concurrency controls.** The emergency stack switch sets all six functions to zero concurrency. Optional normal caps are 2 Analyst, 2 Evaluator, 4 Interviewer, 4 PDF Parser, 2 Voice Session, and 2 Demo Session, but default off because AWS requires sufficient account concurrency quota before nonzero reserved concurrency can be assigned.
- **Model/session caps.** Every mode accepts at most 5,000 job-description characters. Hosted Analyst and Evaluator calls use a 4,096-token output ceiling; hosted Analyst resume text is capped at 60,000 characters; hosted Evaluator input is capped at 60,000 conversation and 120,000 Analyst-output characters. AgentCore voice sessions have an eight-minute application limit. The local server disables these additional hosted-only caps.

---

## How Infra Connects to the Backend

The CDK stack references each Lambda's source code relative to the `infrastructure/` folder:

```
backend/functions/analyst/       → Analyst Lambda asset
backend/functions/evaluator/     → Evaluator Lambda asset
backend/functions/interviewer/   → Interviewer Lambda asset
backend/functions/pdf_parser/    → PDF Parser Lambda asset
backend/functions/voice_session/ → Voice Session Lambda asset
backend/functions/demo_session/  → Demo Session Lambda asset
backend/functions/shared/        → Session guard Lambda layer asset
```

CDK creates filtered assets rather than blindly zipping each folder. Analyst and Interviewer exclude tests, `.env*`, caches, bytecode, and test events; Evaluator also excludes its README and standalone SAM files. PDF Parser builds a fresh asset containing installed `pypdf` plus its top-level Python modules. The `handler` property tells Lambda which Python function to invoke:

| Lambda | Handler Path | Meaning |
|--------|-------------|---------|
| Analyst | `handler.lambda_handler` | `backend/functions/analyst/handler.py` |
| Evaluator | `lambda_handler.handler` | `backend/functions/evaluator/lambda_handler.py` |
| Interviewer | `handler.lambda_handler` | `backend/functions/interviewer/handler.py` |
| PDF Parser | `handler.lambda_handler` | `backend/functions/pdf_parser/handler.py` |
| Voice Session | `handler.lambda_handler` | `backend/functions/voice_session/handler.py` |
| Demo Session | `handler.lambda_handler` | `backend/functions/demo_session/handler.py` |

### Environment Variables

The Interviewer Lambda receives `S3_BUCKET`, `INTERVIEW_STRUCTURE_KEY`, and
`INTERVIEW_PROFILE_KEY`. CDK uploads the JSON files from `backend/config/` to
that bucket during deployment.

The Voice Session Lambda receives the AgentCore runtime ARN and returns a fresh five-minute signed WebSocket URL. The ARN is infrastructure configuration, not a browser credential.

All six functions receive the hosted session-table name and daily-limit parameters. The shared Lambda layer verifies the hashed token, trusted viewer address, expiry, and stage-attempt count before each hosted handler performs work.

---

## How Infra Connects to the Frontend

The stack exposes hosted endpoint and configuration-bucket outputs. Local mode sends the same `POST` payloads to the adapter under `http://localhost:8080/api`.

Do not store secrets or permanent AWS credentials in `VITE_*` variables. Vite embeds those values into the browser bundle.

## Infrastructure Boundaries

The complete target is intentionally split across managed services:

| Concern | Deployment target | Repository status |
|---------|-------------------|-------------------|
| React/Vite frontend | AWS Amplify Hosting | Deployed after the same-revision application CDK update completes |
| Browser identity | No end-user login | Signed, short-lived service sessions |
| PDF/Analyst/Interviewer/Evaluator HTTP backend | CloudFront OAC + private Lambda Function URLs + S3 | Deployed; direct Function URL access requires IAM |
| Signed voice-session broker | Voice Session Lambda | Deployed; signs five-minute AgentCore URLs |
| Demo admission | Demo Session Lambda + DynamoDB | Deployed; enforces configurable daily global/viewer limits |
| Real-time Python voice relay | Amazon Bedrock AgentCore Runtime | Deployed; runtime-specific state remains outside version control |
| Speech-to-speech model | Amazon Nova 2 Sonic through the relay | Active hosted and local integration |

AgentCore Runtime is a serverless managed container runtime, not a server that this project administers. It is used because the voice path needs a persistent WebSocket and bidirectional model stream. The browser obtains a short-lived signed `wss://` URL from Voice Session rather than receiving permanent AWS credentials.

## Automated Updates

Two automatic release paths respond to matching changes on `main`:

| Change area | Automated result |
|-------------|------------------|
| Frontend, Lambda functions, configuration, schemas, or application infrastructure | Frontend/backend checks run, `MockInterviewStack` is updated, then the same revision is built in hosted mode and published to Amplify |
| Voice relay runtime code | Relay tests run, then the existing AgentCore target is updated |

The workflows obtain short-lived AWS credentials through GitHub OIDC. Application releases share one concurrency group, reject stale revisions, and deploy the backend before publishing the matching frontend. The deployment role trust is restricted to this repository's `main` branch, and permanent AWS access keys are not stored in repository configuration.

The application workflow requires repository variables for the deployment-role ARN, Amplify app ID, and cost-alert email. Optional hosted-limit variables supply the values described under Security and Cost Controls, and workflow validation enforces the source-level ceilings. Changes to the separate deployment-automation IAM/OIDC stack are intentionally excluded from the application workflow and require an explicit deployment of that bootstrap stack.

---

## Local Development Gotchas

| Issue | Fix |
|-------|-----|
| Missing AWS identity at startup | Configure an AWS profile or temporary environment credentials, then confirm with `aws sts get-caller-identity`. |
| Model access error | Confirm the active AWS identity can invoke gpt-oss-120b and Nova 2 Sonic in `us-east-1`. |
| Python import error | Install `backend/requirements-local.txt` in the active virtual environment. |
| Port 8080 is already in use | Run `lsof -nP -iTCP:8080 -sTCP:LISTEN`, stop the previous local backend, and retry. The backend uses port 8080; Vite normally uses port 5173. |
| Hosted-mode CORS failure from local Vite | Use exactly `http://localhost:5173`; stop the existing Vite listener rather than allowing a fallback to port 5174. |
| Upload rejected | The frontend and backend both enforce the 4 MiB (4,194,304 bytes) PDF limit. |
