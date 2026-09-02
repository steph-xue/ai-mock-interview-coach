<h1 align="center">AI Mock Interview Coach</h1>
<h2 align="center">(Cloud Innovation Centre Hackathon)</h2>

<h4 align="center">
  A personalized, student-first, multi-agent AI mock interview coach<br>
  providing real-time speech-to-speech practice.
</h4>

<p align="center">
  🏆 1st Place Winner
</p>

<p align="center">
  <img src="docs/images/mock-interview-coach-logo.png" alt="AI Mock Interview Coach logo" width="450"/>
</p>

<p align="center">
  <a href="https://main.dvppliwnm6u9g.amplifyapp.com/">Live Demo</a>
</p>

<br>

## Table of Contents

- [Contributors](#contributors)
- [Problem Statement](#problem-statement)
- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [How It Works](#how-it-works)
- [Technical Challenges](#technical-challenges)
- [Achievements](#achievements)
- [What We Learned](#what-we-learned)
- [Future Improvements](#future-improvements)
- [Getting Started](#getting-started)

<br>

## Contributors

- Hoonji Choi
- Jade Lee
- Jena Chang
- Jianding Bai
- Stephanie Xue

<br>

## Problem Statement

Preparing for internship and co-op interviews can be especially difficult for students with limited interview experience. Many mock interview resources use generic questions or assume that candidates have substantial professional experience. Students often need to draw from coursework, personal projects, hackathons, student clubs, research, volunteering, and early work experience, yet existing tools rarely help them connect those experiences to the requirements of a specific role.

Practice resources also tend to offer limited support during and after an interview. They may present questions or return a general score, but often do not help students identify which experiences to discuss, understand what competencies an interviewer is evaluating, or recognize how each response could be improved. For someone with limited interview experience, this makes it difficult to know what to practise and whether that practice is leading to stronger answers.

Many digital mock interviews also rely on text chat or stop-and-start recordings, which do not recreate the pace and spontaneity of a live conversation. Without realistic back-and-forth dialogue, students have fewer opportunities to practise listening, responding naturally, and adapting when an interviewer asks an unexpected follow-up question.

<br>

## Overview

AI Mock Interview Coach is a full-stack, multi-agent AI web application that gives students a personalized resume deep-dive interview for internship and co-op preparation. Students upload a PDF resume and paste a target job description, which are used to identify the experiences and skills most relevant to the role. Both modes provide live, hands-free, conversational speech-to-speech interviews with natural responses and possible follow-up questions. Practice Mode adds supportive, role-specific guidance and personalized hints based on the student's background, while Live Mode simulates a realistic virtual interview. After the interview, students receive a thorough report with an overall assessment, dimension scores, question-specific strengths and improvements, keyword coverage, and focused next steps.

The application was built with React, TypeScript, CSS, and Vite on the frontend and FastAPI and Python on the backend. The application uses AWS Lambda for the PDF Parser, Analyst Agent, Voice Session, Interviewer Agent, Evaluator Agent, and Demo Session admission controller. The Analyst and Evaluator Agents use OpenAI gpt-oss-120b through Amazon Bedrock, while the Interviewer Agent runs on Amazon Bedrock AgentCore and uses WebSocket-based bidirectional streaming with Amazon Nova 2 Sonic. Amazon S3 stores the interview configuration, AWS CDK defines the backend cloud infrastructure, and Docker containerizes the AgentCore voice relay. Amazon CloudFront routes hosted API traffic, and AWS Amplify serves the deployed application. Amazon DynamoDB stores hosted session and usage-limit records, while Amazon CloudWatch Alarms, Amazon SNS, and AWS Budgets provide monitoring and cost controls.

<br>

## Features

### Resume and Job Description Upload

Students begin by uploading a PDF resume and pasting the job description for the internship or co-op position they want to practise for. The form validates both inputs, shows the job description's character count, and keeps submission disabled until the required information is ready.

<table align="center">
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/upload-screen-empty.png" alt="Empty resume and job description upload screen" width="100%"><br>
      <em>Start with a resume and target role.</em>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/upload-screen-filled.png" alt="Completed resume and job description upload screen" width="100%"><br>
      <em>Application details ready for analysis.</em>
    </td>
  </tr>
</table>

<br>

### Personalized Resume Analysis

The application extracts the resume text, compares it with the target job description, and identifies the student's most relevant experiences, skills, measurable claims, and areas worth clarifying. This analysis becomes shared context for both the interview and final evaluation rather than producing a generic set of questions.

<p align="center">
  <img src="docs/screenshots/resume-processing.png" alt="Resume analysis and interview preparation screen" width="525"/><br>
  <em>Resume analysis builds personalized interview context.</em>
</p>

<br>

### Interview: Practice Mode

Practice Mode combines a natural, hands-free speech-to-speech interview with personalized support. During the conversation, a guidance panel highlights role-relevant competencies and resume experiences that may provide useful evidence. Each suggestion includes skills to highlight, an angle to consider, and a part of the STAR structure to emphasize, helping students strengthen their answers without supplying scripted responses.

<p align="center">
  <img src="docs/screenshots/interview-practice-mode.png" alt="Interview Practice Mode with personalized guidance" width="525"/><br>
  <em>Practice Mode combines live interviewing with personalized guidance.</em>
</p>

<br>

### Interview: Live Mode

Live Mode keeps the same continuous, hands-free conversational experience while removing the guidance and hints to simulate a realistic virtual interview. Students listen and respond naturally, adapt to the questions being asked, and may receive follow-up questions based on their answers, allowing them to rehearse independently under interview-like conditions.

<p align="center">
  <img src="docs/screenshots/interview-live-mode.png" alt="Interview Live Mode" width="525"/><br>
  <em>Live Mode provides a focused, hands-free interview experience.</em>
</p>

<br>

### Personalized Feedback Report

After the interview, the Evaluator Agent turns the completed conversation into a structured report. Students receive an overall score, scores for concrete examples, STAR structure, connection to the job, and quantifiable outcomes, plus a focused priority to improve. The report also provides question-specific strengths and improvements, with each original response available to review by expanding the section, as well as overall strengths, keyword coverage, contextual guidance, and practical next steps. Students can practise again with the same resume and analysis or begin a new interview with different application materials.

<table align="center">
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/feedback-report.png" alt="Interview report overview and score dimensions" width="100%"><br>
      <em>Overall performance and scoring dimensions.</em>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/feedback-summary.png" alt="Interview feedback summary" width="100%"><br>
      <em>Summary with job-specific keyword coverage.</em>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/feedback-questions.png" alt="Question-specific interview feedback" width="100%"><br>
      <em>Strengths and improvements for each response.</em>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/feedback-next-steps.png" alt="Interview feedback next steps" width="100%"><br>
      <em>Personalized advice for the next interview.</em>
    </td>
  </tr>
</table>

<br>
<p align="center">
  <img src="docs/screenshots/demo-feedback-each-question.gif"
       alt="Expandable question feedback showing the original response and scoring breakdown"
       width="90%">
  <br>
  <em>Expandable per-question feedback with original answers and STAR-based scoring details.</em>
</p>
<br>

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, CSS, Vite |
| Backend | FastAPI, Python |
| PDF Parser | AWS Lambda, pypdf |
| Analyst Agent | AWS Lambda, OpenAI gpt-oss-120b through Amazon Bedrock |
| Voice Session | AWS Lambda |
| Interviewer Agent | AWS Lambda, Amazon Nova 2 Sonic through Amazon Bedrock, WebSocket-based bidirectional voice relay on Amazon Bedrock AgentCore |
| Evaluator Agent | AWS Lambda, OpenAI gpt-oss-120b through Amazon Bedrock |
| Interview Configuration | Amazon S3 |
| Development Workflow | Kiro, spec-driven development
| Backend Cloud Infrastructure | AWS CDK |
| Containerization | Docker |
| Deployment | Amazon CloudFront, AWS Amplify Hosting |
| Demo Session | AWS Lambda, Amazon DynamoDB |
| Security and Cost Controls | AWS IAM, Amazon CloudWatch Alarms, Amazon SNS, AWS Budgets |

<br>

## How It Works

### Multi-Agent Workflow

The application uses three specialized agents connected through structured JSON contracts:

1. **Analyst Agent:** Examines the resume and target job description, identifies role alignment, and selects useful evidence for the interview.
2. **Interviewer Agent:** Combines the personalized analysis with the interview structure and student profile, then conducts the spoken interview through Nova 2 Sonic.
3. **Evaluator Agent:** Reviews the completed question-and-answer pairs together with the original analysis and generates the final feedback report.

The browser orchestrates the workflow and retains the active interview content. Amazon S3 stores interview configuration rather than uploaded documents.

### Architecture Diagram

[![AWS Architecture Diagram](docs/Architecture/aws-architecture-diagram-v2.png)](docs/Architecture/aws-architecture-diagram-v2.png)

### Resume and Job Analysis

The browser first sends the PDF resume and job-description text to the PDF Parser. The parser extracts the resume text with pypdf and returns both documents in a normalized response. The Analyst Agent receives that content, builds a role-aware prompt, and calls gpt-oss-120b through Amazon Bedrock with a forced structured-output function. The resulting Analyst output includes the student's background, relevant skills, target-role requirements, strongest experiences, measurable claims, alignment evidence, and analysis warnings.

### Personalized Interview Context

The Interviewer Agent receives the complete Analyst output and combines it with two configuration files stored in Amazon S3: the interview structure and the student interview profile. Together, these define the intended interview areas, supportive tone, student-appropriate expectations, follow-up guidance, and information Nova should listen for. The resulting runtime context is returned to the browser and supplied when the voice session starts.

### Real-Time Speech-to-Speech Interview

For the hosted application, the browser requests a connection from the Voice Session Lambda and opens a WebSocket to the AgentCore-hosted Python relay. The relay manages Nova's bidirectional streaming protocol, including audio input, audio playback, transcript events, interruptions, tool calls, and graceful shutdown. Nova 2 Sonic listens to the student's speech and responds directly with synthesized speech, allowing the conversation to continue naturally without push-to-talk controls.

Nova is instructed to ask three main questions and one adaptive follow-up after each main question, drawing from project ownership, technical problem-solving, and learning or collaboration experiences. The follow-up sequence remains model-directed, so the application evaluates the completed question-and-answer pairs rather than penalizing an interview that ends early.

### Feedback Evaluation

When the interview finishes, the frontend pairs final interviewer and student transcript entries into the canonical Evaluator request. The Evaluator Agent calls gpt-oss-120b through Amazon Bedrock with a forced feedback function, validates the returned structure, aggregates deterministic scores, assigns a readiness label, and assembles the final report. Each completed answer is scored independently, while the report combines those results into overall strengths, improvements, keyword coverage, contextual advice, and interview metadata.

### Models and Contracts

| Agent | Model or Service |
|---|---|
| Analyst | OpenAI gpt-oss-120b through Amazon Bedrock |
| Interviewer | Amazon Nova 2 Sonic through Amazon Bedrock, Amazon Bedrock AgentCore |
| Evaluator | OpenAI gpt-oss-120b through Amazon Bedrock |

Inter-agent payload definitions live in `schemas/`:

| File | Purpose |
|---|---|
| `analyst_output.json` | Analyst output shared with Interviewer and Evaluator |
| `interviewer_output.json` | Question-and-answer payload and interview metadata sent to Evaluator |
| `evaluator_output.json` | Scores, feedback, keyword coverage, and interview metadata returned by Evaluator |

### Lambda Module Structure

The Analyst uses an orchestrator and parser layout:

```text
backend/functions/analyst/
├── handler.py          # Lambda entry point
├── orchestrator.py     # Business-logic coordination
├── validation.py       # Input validation
├── prompt_builder.py   # Prompt and function construction
├── bedrock_client.py   # Model request
└── parser.py           # Structured response parsing and validation
```

The Interviewer prepares the personalized Nova context:

```text
backend/functions/interviewer/
├── handler.py          # Lambda entry point
├── validation.py       # Analyst-output validation
├── config_loader.py    # S3 interview-configuration loader
└── context_builder.py  # Nova runtime-context assembly
```

The Evaluator separates model output, deterministic scoring, and response assembly:

```text
backend/functions/evaluator/
├── lambda_handler.py      # Lambda entry point and orchestration
├── validator.py           # Input validation
├── prompt_builder.py      # Prompt and feedback-function construction
├── bedrock_client.py      # Model request and function extraction
├── scorer.py              # Score aggregation and readiness classification
├── response_assembler.py  # Final feedback response
├── schemas.py             # Evaluator function and response schemas
└── exceptions.py          # Evaluator-specific errors
```

### Hosted Architecture

AWS Amplify Hosting serves the React application. The browser sends hosted HTTP requests through one Amazon CloudFront distribution, which routes each path to the appropriate Lambda function. The Voice Session Lambda creates AgentCore connection URLs, while AgentCore runs the session-long Python relay needed for Nova's bidirectional audio stream. Amazon S3 stores interview configuration deployed from the repository, and AWS CDK defines the application infrastructure.

Two GitHub Actions release paths keep the hosted application synchronized with `main`. Application changes test and update the CDK backend before building and publishing the same frontend revision to Amplify. Voice-relay changes test and update the AgentCore runtime separately.

### Security and Cost Controls

The hosted application intentionally does not require an end-user login. Its security and cost controls include:

- All six Lambda Function URLs require AWS IAM authentication. CloudFront Origin Access Control signs hosted origin requests, while anonymous requests sent directly to the Function URLs are rejected.
- Amazon DynamoDB stores only expiring hashed demo-session metadata, admission records, and attempt counters.
- The deployed demo admits at most 100 interview sessions per UTC day and at most 100 per trusted viewer IP per UTC day. Source-level parameter bounds prevent either value from being raised above those ceilings; both limits can later be lowered to 5 without an application rewrite.
- Every hosted pipeline stage requires the IP-bound, two-hour opaque session token. Each token permits at most 2 PDF Parser, 2 Analyst, 2 Interviewer, 2 Evaluator, and 3 Voice Session attempts, preventing one admitted session from repeatedly invoking paid work.
- A CloudFront viewer-request guard rejects unknown API paths and methods other than `POST` and `OPTIONS` before they reach Lambda.
- Browser CORS is limited to the deployed Amplify origin and the configured localhost development origin.
- The Voice Session Lambda returns short-lived, role-scoped AgentCore WebSocket URLs instead of exposing AWS credentials to the browser.
- The frontend and backend enforce a 4 MiB PDF limit, and every job description is limited to 5,000 characters.
- Hosted model calls use bounded input sizes, one model attempt, and a smaller output budget than pure local development. Hosted voice sessions also have an application duration limit.
- CloudWatch alarms monitor invocations, errors, and throttling for every hosted function. Amazon SNS delivers alert notifications, and AWS Budgets tracks account-level spending against a default monthly budget.
- An emergency switch can set all hosted functions to zero concurrency. Optional normal concurrency caps remain disabled unless the AWS account has sufficient Lambda concurrency quota.

Atomic admission enforces the configured global daily ceiling. CORS controls browser access, while alarms and budget notifications provide monitoring rather than an automatic spending stop. AWS WAF is not provisioned, avoiding its fixed baseline cost for the current small-scale deployment.

[![Security and Cost Controls](docs/Architecture/security-cost-control-diagram.png)](docs/Architecture/security-cost-control-diagram.png)

### Important Implementation Notes

- Hosted Lambda handlers parse JSON request payloads from `event["body"]`.
- A 4 MiB PDF expands when base64 encoded, so the product limit also leaves space under the Lambda Function URL request-payload quota.
- Local mode invokes the same Python handlers directly and reads interview configuration from the repository instead of Amazon S3.
- Hosted endpoint configuration is selected only when the frontend explicitly builds or runs with hosted runtime mode.

<br>

## Technical Challenges

- Translating the browser's simple audio and transcript messages into Nova 2 Sonic's bidirectional event lifecycle while managing identifiers, queues, interruptions, tool results, and graceful session shutdown
- Keeping microphone capture, streamed playback, partial transcripts, final transcripts, and active-speaker state synchronized during a natural conversation
- Producing reliable structured outputs from generative models and validating them before the data moves between Analyst, Interviewer, Evaluator, and the frontend
- Coordinating a multi-step cloud workflow while preserving the student's resume analysis and interview state in the browser
- Supporting both local and hosted workflows while maintaining an accessible student experience across a real-time multi-agent application

<br>

## Achievements

- Built a complete three-agent workflow that personalizes interview preparation, live questions, adaptive follow-ups, and feedback using the student's own resume and target job
- Delivered a hands-free speech-to-speech interview experience with Nova 2 Sonic instead of a text chatbot or push-to-talk recorder
- Created both a guided Practice Mode and realistic Live Mode so students can move from supported preparation to independent rehearsal
- Produced a detailed feedback experience with overall scoring, question-specific observations, keyword coverage, and actionable next steps
- Implemented matching local and hosted application paths with automated tests and AWS delivery workflows

<br>

## What We Learned

- Learned to use Kiro’s spec-driven workflow to turn requirements into structured designs and implementation tasks, and to keep specifications updated as interfaces evolved.
- Learned how to design a multi-agent workflow with explicit responsibilities and structured contracts between each stage
- Developed experience with real-time bidirectional audio streaming, browser microphone processing, synthesized playback, and interruption handling
- Learned how to use forced model functions and deterministic post-processing to make generative AI output safer for downstream application code
- Strengthened our understanding of AWS cloud architecture, including Lambda, AgentCore, Bedrock, CloudFront, S3, Amplify, and infrastructure as code
- Learned to balance student-friendly product design with technical constraints around latency, model availability, and real-time interaction quality

<br>

## Future Improvements

- Add selectable interview difficulty modes with supportive, standard, and challenging options
- Introduce panel interviews with distinct interviewer roles, such as a hiring manager, technical interviewer, and challenger
- Add application-side interview-stage tracking so the intended main-question and follow-up sequence is enforced consistently
- Restore interview history when reconnecting to a new voice session so Nova can continue from the same conversational context
- Add a multi-agent validation layer where independent evaluators review interview performance and a Judge Agent reconciles their feedback into a more consistent final report.
- Add a standalone full-transcript view to the feedback experience

<br>

## Getting Started

Follow the steps below to set up and run the application on your own machine. This project requires both a frontend and backend server running at the same time.

<br>

**Prerequisites**

Make sure Node.js, npm, Python 3, and AWS CLI are installed before you begin. You can check all four by running the commands below, which should each print a version number.

> **Note:** This project requires Node.js 20+, Python 3.12, and AWS CLI v2.32.0+ because the recommended browser-based authentication method uses `aws login`. Local AWS credentials must have access to OpenAI gpt-oss-120b and Amazon Nova 2 Sonic in `us-east-1`.

```bash
node --version
npm --version
python3 --version  # On Windows use: python --version
aws --version
```

Install or update AWS CLI v2 using the [official AWS CLI installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) if the `aws` or `aws login` command is unavailable.

<br>

**1. Clone the Repository**

This downloads a copy of the project to your computer and moves you into the project folder.

```bash
git clone https://github.com/Jade-ok/CIC_mock-interview-coach.git
cd CIC_mock-interview-coach
```

**2. Authenticate with AWS**

Choose **one** of the following three authentication options.

**Option 1: Sign in through the browser**

Use an AWS Console account with access to both models. This stores refreshable temporary credentials for local development. The console identity must have the AWS-managed [`SignInLocalDevelopmentAccess`](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/SignInLocalDevelopmentAccess.html) policy.

```bash
aws login
export AWS_REGION="us-east-1"  # On Windows use: $env:AWS_REGION="us-east-1"
```

IAM Identity Center users can sign in with an existing profile instead:

```bash
aws sso login --profile "<profile-name>"
export AWS_PROFILE="<profile-name>"  # On Windows use: $env:AWS_PROFILE="<profile-name>"
export AWS_REGION="us-east-1"        # On Windows use: $env:AWS_REGION="us-east-1"
```

**Option 2: Export temporary credentials**

Export the credentials directly in the terminal that will run the backend:

```bash
export AWS_ACCESS_KEY_ID="..."      # On Windows use: $env:AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."  # On Windows use: $env:AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."      # On Windows use: $env:AWS_SESSION_TOKEN="..."
export AWS_REGION="us-east-1"       # On Windows use: $env:AWS_REGION="us-east-1"
```

**Option 3: Load temporary credentials from a local file**

Create `backend/.env.local` with the following values:

```dotenv
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...
AWS_REGION=us-east-1
```

The local backend loads this file automatically on macOS, Linux, and Windows.

Environment files are ignored by Git. Never commit AWS credentials, place them in a `VITE_*` variable, or expose them to browser code.

**3. Verify the AWS Identity**

Confirm which AWS account will own the local model usage and charges before starting the application:

```bash
aws sts get-caller-identity
```

If the command fails, repeat the authentication step or refresh expired temporary credentials before continuing.

**4. Set Up the Backend**

From the project root, move into the backend folder and create a Python virtual environment.

```bash
cd backend
python3 -m venv .venv       # On Windows use: python -m venv .venv
source .venv/bin/activate   # On Windows use: .venv\Scripts\activate
```

Install all of its dependencies and start the backend development server.

```bash
pip install -r requirements-local.txt
uvicorn backend.local_server:app --app-dir .. --reload --port 8080
```

The backend verifies and prints the active AWS identity during startup. It runs PDF parsing and interview configuration locally while using that AWS identity for Analyst, Evaluator, and Nova 2 Sonic model calls.

**5. Set Up the Frontend**

In a separate terminal window from the project root, move into the frontend folder, install its dependencies, and start the development server.

```bash
cd frontend
npm ci
npm run dev
```

Once both servers are running, open the local URL displayed by Vite and allow microphone access when prompted.

<br>

### Troubleshooting

- **Port 8080 is already in use:** Run `lsof -nP -iTCP:8080 -sTCP:LISTEN`, stop the previous backend process, and start the server again.
- **AWS login has expired:** Run `aws login` again, or refresh the configured profile or temporary credentials.
- **AccessDenied or model quota error:** Confirm that the identity returned by `aws sts get-caller-identity` can use gpt-oss-120b and Nova 2 Sonic in `us-east-1`.
- **Microphone access is blocked:** Allow microphone permission for the local Vite URL in the browser settings, then refresh the page.
- **The repository was moved:** Recreate the backend virtual environment so its executable paths point to the current checkout.
