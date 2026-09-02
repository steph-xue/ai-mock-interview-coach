# Evaluator Agent

Evaluates mock interview performance for co-op seeking students.

## Architecture

Receives interview conversation + analyst output, calls Bedrock Mantle Chat Completions for scoring, then aggregates and returns a feedback report. The same handler runs behind the local `/api/evaluator` adapter and in the hosted Lambda architecture.

During local development, `backend.local_server:app` invokes the handler directly. Its Bedrock request uses the AWS identity active in the local SDK credential chain.

In hosted mode, the Evaluator runs behind a private IAM-protected Function URL reached through the CloudFront API distribution and OAC. Local execution invokes the same handler directly.

## Security and Cost Controls

Hosted evaluation requires the two-hour opaque interview token and permits two evaluation attempts per admitted interview. It uses one 55-second Mantle attempt, a 4,096-token output ceiling, a 60,000-character conversation cap, and a 120,000-character Analyst-output cap. Its Lambda is covered by alarms and the stack's AWS cost budget; its optional normal concurrency cap defaults off until the target account quota supports it. Local execution bypasses hosted admission, retains two 120-second attempts and the 8,192-token output budget, and does not apply the hosted text caps.

## Input

See `../../../schemas/interviewer_output.json` for the current input shape.

Required fields:
- `session_token` — opaque hosted admission token; local mode uses its local sentinel value
- `conversation` — array of 1-6 question-answer turn objects
- `interview_metadata` — session metadata (passed through to response)
- `analyst_output` — structured analysis from the Analyst agent

## Output

See `../../../schemas/evaluator_output.json` for the current output shape.

## Environment

- **Runtime**: Python 3.12
- **Region**: us-east-1
- **Model**: openai.gpt-oss-120b
- **Timeout**: hosted Lambda 60 seconds with one 55-second model attempt; local calls retain two 120-second attempts

Hosted backend changes merged to `main` are tested and deployed with the Lambda/S3 CDK stack by GitHub Actions using temporary, branch-restricted OIDC credentials.

## IAM Permissions

The standalone SAM template and CDK stack allow Mantle inference only for gpt-oss-120b, plus the Mantle project lookup actions required by the service:

```json
{
  "Effect": "Allow",
  "Action": ["bedrock-mantle:CreateInference"],
  "Resource": "*",
  "Condition": {
    "StringEquals": {"bedrock-mantle:Model": "openai.gpt-oss-120b"}
  }
}
```

The role also permits `bedrock-mantle:GetProject`, `ListProjects`, and `ListTagsForResource`.

## Local Development

```bash
pip install -r backend/functions/evaluator/requirements.txt
pip install pytest
python3 -m pytest backend/functions/evaluator/tests/ -v
```
