# Project Summary

> Active product and implementation summary. Last verified: 2026-08-09.

Build a voice-based résumé deep-dive mock interview app for students and internship candidates.

The user uploads a résumé, pastes a target job description, completes a spoken interview, and receives student-appropriate feedback.

The Analyst accepts internships, coursework, academic projects, personal projects, hackathons, student clubs, research, volunteering, and work experience. Common model synonyms are normalized to these stable categories, while unfamiliar non-empty labels become `other` so category wording cannot fail an otherwise valid analysis. The app should not expect senior-level system design, large-scale production ownership, formal management experience, or many years of professional work.

## Interview Format

Nova is instructed to aim for:

- 3 main questions
- 1 adaptive follow-up after each main question
- up to 6 spoken answers
- an option to end the interview early
- a Practice Mode UI with interviewer-only captions plus Key Competencies and Experiences to Prepare

The three interview areas are:

1. Project overview and personal contribution
2. Technical problem-solving and decision-making
3. Learning, collaboration, and role alignment

Each follow-up should be based on what the candidate actually said.

## Main Components

### Analyst Agent

The Analyst receives the full résumé and job description.

It returns only personalized candidate and role information, including:

- candidate background and level
- relevant skills
- target role requirements
- résumé-to-job alignment
- strongest experiences
- measurable claims
- areas worth clarifying
- analysis warnings

The Analyst does not control interview length, follow-up rules, tone, or difficulty.

### Amazon Nova 2 Sonic Interviewer

Nova Sonic conducts the spoken interview.

It receives:

- personalized candidate data from the Analyst
- the interview structure
- the student interview profile

Nova Sonic should:

- generate and speak the three main questions
- understand the candidate's spoken responses
- generate one adaptive follow-up per main question
- base each follow-up on the candidate's actual answer
- ask one concise question at a time
- remain supportive and professional
- accept student-level experiences
- provide both interviewer and candidate transcripts

The Nova system context defines the expected three-question/three-follow-up sequence. Explicit application-side tracking of the current point, main/follow-up stage, follow-up usage, and completion remains planned rather than implemented.

### Evaluator Agent

The Evaluator contract requires:

- the full question-and-answer transcript
- candidate level
- target role
- completion status
- number of completed main questions
- number of completed follow-ups
- whether the interview ended early

When invoked with a valid request, it generates:

- a score for each question across concrete example, STAR structure, link to job, and quantifiable outcome
- four aggregated dimension scores and an overall score
- a readiness label
- strengths
- improvements
- keywords covered and not covered
- contextual advice
- interview metadata passed through from the request

## Configuration Files in S3

### Interview Structure

The interview structure defines what the interview covers.

It should include:

- three interview points
- the objective of each point
- the type of experience to prioritize
- what Nova should listen for
- useful follow-up topics
- the maximum of one follow-up per point
- whether early stopping is allowed

### Student Interview Profile

The student profile defines how Nova should behave.

It should specify:

- supportive and professional tone
- clear and concise wording
- one question at a time
- low challenge frequency
- gentle requests for evidence
- no advanced constraints
- valid student experience types
- no expectation of senior-level experience
- no feedback during the interview
- no invented résumé details
- no multiple questions in one turn

Later, additional profiles can be added for standard and challenging interviews without changing the Analyst output or core interview structure.

## Interview Flow

The sequence is:

- main question
- main answer
- one adaptive follow-up
- follow-up answer
- move to the next interview point

Nova is instructed to end after the third follow-up answer by calling `end_interview`. The frontend maps final transcript entries to `schemas/interviewer_output.json` and invokes the Evaluator.

The implemented handoff marks an early-ended interview accordingly and scores only completed question-answer pairs, without penalizing omitted areas. The three-main-question/three-follow-up sequence is still directed by Nova's context rather than guaranteed by application-side state tracking.

## AWS Services

The agreed deployment architecture uses one AWS account:

- AWS Amplify Hosting serves the React/Vite frontend.
- The browser obtains a five-minute signed `wss://` URL from the voice-session Lambda and opens Amazon Bedrock AgentCore Runtime. The browser does not invoke Bedrock directly or contain permanent AWS credentials.
- AgentCore runs the FastAPI/Python voice relay as a serverless managed container runtime. The relay owns only connection-scoped state and proxies the bidirectional stream to Amazon Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`).
- Four AWS Lambda functions handle PDF parsing, résumé analysis, Interviewer context building, and evaluation. A fifth signs short-lived AgentCore connection URLs, and a sixth atomically admits hosted interviews. Analyst and Evaluator invoke OpenAI gpt-oss-120b through Amazon Bedrock Mantle; the Interviewer Lambda builds context from configuration without making a model call.
- Amazon S3 stores the interview structure and student interview profile configuration.
- An on-demand DynamoDB table stores only expiring hashed admission tokens/viewer identifiers, UTC-day counters, and bounded per-stage attempt counts; it does not store résumé, job-description, transcript, or feedback content.
- AWS CDK defines the Lambda functions, their endpoints, permissions, S3 configuration resources, and admission table. AgentCore remains a separate hosted container boundary.

The frontend defaults to strict local mode, using the combined local HTTP/WebSocket server on port 8080, and the adapter has focused unit coverage. Hosted mode reads one CloudFront API base URL from environment configuration; CloudFront OAC signs requests to private Function URL origins.

## Security and Cost Controls

Before hosted processing, Demo Session atomically reserves a daily slot and issues a two-hour opaque token bound to the trusted viewer address. Defaults are 100 interviews globally and 100 per viewer IP per UTC day, with bounded attempts for every downstream stage and an edge path/method allowlist. The no-login hosted design also uses exact browser origins, one 55-second model attempt, invocation/error/throttle alarms, an email-backed AWS cost budget, hosted text/output/session limits, and an emergency function switch. Optional normal concurrency caps default off until the target account quota supports them. Pure local mode bypasses hosted admission and leaves the hosted timeout/retry/workload limits disabled while retaining AWS account quotas and the shared 4 MiB PDF limit.

The Amplify frontend, CDK backend, and AgentCore relay are deployed. The application workflow serializes each matching `main` revision: it tests and deploys the CDK backend, then builds and publishes that same revision through the Amplify manual deployment API. Voice-relay changes use a separate AgentCore workflow; both release paths reject stale revisions and share one production lock. The workflows use short-lived AWS credentials from a GitHub OIDC role restricted to the immutable repository identity and the `main` branch.

No interview-content database or permanent interview history is implemented. Practice Mode presentation is available in both local and hosted builds; cross-session history is not.
