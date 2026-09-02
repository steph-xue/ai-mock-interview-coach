# Design Document

> Maintained design. Last verified: 2026-08-09.

## Overview

The Evaluator Agent is a stateless AWS Lambda function in the deployed CDK-managed backend. It receives a completed interview conversation, interview metadata, and the Analyst's structured assessment (which combines analyst output and job-role alignment), then produces a scored feedback report for the Amplify-hosted React client. It follows an orchestrator pattern where a single handler coordinates sequential steps: validation → prompt construction → Bedrock API call → score aggregation → response assembly. This Lambda does not host the live WebSocket; that persistent stream is handled by the AgentCore serverless voice relay.

All scoring is on a 1-5 integer scale calibrated for co-op seeking students. The system handles variable-length conversations (1-6 question-answer pairs) without penalizing incomplete interviews. Each turn in the conversation (whether main_question or follow_up) is scored independently.

## Architecture

### High-Level Flow

```text
CloudFront /evaluator route
  -> private AWS_IAM Function URL
  -> hosted session/IP/attempt authorization
  -> validator
  -> prompt builder
  -> Bedrock Mantle Chat Completions (gpt-oss-120b)
  -> scorer
  -> response assembler
  -> JSON response through CloudFront
```

### Module Structure

```
backend/functions/evaluator/
├── lambda_handler.py          # Entry point, orchestrator
├── validator.py               # Input validation logic
├── prompt_builder.py          # LLM prompt construction
├── bedrock_client.py          # Signed Bedrock Mantle API wrapper
├── scorer.py                  # Score clamping, aggregation, readiness label
├── response_assembler.py      # Final JSON response construction
├── schemas.py                 # Tool-use schema + response schema definitions
└── exceptions.py              # Custom exception classes
```

## Module Design

### 1. lambda_handler.py (Orchestrator)

**Responsibility:** Entry point for the CloudFront `/evaluator` route's private Function URL origin. It first authorizes the hosted session and claims one of two evaluation attempts, then parses the event, delegates to each module in sequence, and returns the final HTTP response. Pure local mode bypasses this hosted guard.

```python
def handler(event, context):
    try:
        # 1. Authorize hosted session/stage attempt
        authorize_stage(event, "evaluator")

        # 2. Parse and validate evaluator input
        payload = validator.parse_and_validate(event)
        
        # 3. Build evaluation prompt
        system, messages, tool_config = prompt_builder.build(
            conversation=payload["conversation"],
            analyst_output=payload["analyst_output"]
        )
        
        # 4. Call Bedrock Mantle Chat Completions
        llm_response = bedrock_client.invoke(system, messages, tool_config)
        
        # 5. Extract and aggregate scores
        per_question_scores = scorer.extract_and_clamp(llm_response)
        overall_scores = scorer.aggregate(per_question_scores)
        readiness_label = scorer.classify(overall_scores["total"])
        
        # 6. Assemble response (pass through interview_metadata)
        response_body = response_assembler.build(
            per_question_scores=per_question_scores,
            overall_scores=overall_scores,
            readiness_label=readiness_label,
            llm_response=llm_response,
            interview_metadata=payload["interview_metadata"]
        )
        
        return {"statusCode": 200, "body": json.dumps(response_body)}
    
    except ValidationError as e:
        return {"statusCode": 400, "body": json.dumps({"error": "ValidationError", "message": str(e)})}
    except EvaluationError as e:
        return {"statusCode": 500, "body": json.dumps({"error": "EvaluationError", "message": str(e)})}
```

### 2. validator.py

**Responsibility:** Validates the incoming request payload against the expected schema.

**Key behaviors:**
- Parses the JSON body from the Function URL event format received through CloudFront OAC
- Validates presence of conversation, interview_metadata, and analyst_output
- Validates conversation length: minimum 1, maximum 6 question-answer pairs
- Validates each turn contains required fields
- Returns a validated payload dict or raises ValidationError

```python
def parse_and_validate(event: dict) -> dict:
    body = json.loads(event.get("body", "{}"))
    
    required_fields = ["conversation", "interview_metadata", "analyst_output"]
    for field in required_fields:
        if not body.get(field):
            raise ValidationError(f"Missing or empty required field: {field}")
    
    conversation = body["conversation"]
    if len(conversation) < 1:
        raise ValidationError("Conversation must contain at least one question-answer pair")
    if len(conversation) > 6:
        raise ValidationError("Conversation exceeds expected interview length (max 6 question-answer pairs)")
    
    required_turn_fields = ["point_id", "turn_type", "question", "answer"]
    for i, turn in enumerate(conversation):
        for field in required_turn_fields:
            if field not in turn:
                raise ValidationError(f"Conversation turn {i} missing required field: {field}")
    
    return body
```

### 3. prompt_builder.py

**Responsibility:** Constructs messages and a forced function definition for the Bedrock Mantle Chat Completions call.

**Key design decisions:**
- Includes interview_plan to show which topics/skills were planned for assessment
- System prompt sets co-op student calibration context, scoring dimensions, and tone directive
- User message contains the full transcript, analyst output, and job description
- Tool schema forces structured output for per-question scoring + qualitative feedback
- LLM is instructed to score only present questions, not penalize for missing ones

```python
SYSTEM_PROMPT = """You are an interview performance evaluator for co-op seeking students.

IMPORTANT CALIBRATION:
- You are scoring a student seeking a co-op placement, NOT an experienced professional.
- School projects, course work, hackathons, and team assignments are VALID experience.
- Score generously when students demonstrate learning and growth from academic experiences.
- Do NOT penalize for missing questions if the interview ended early.

Score each question-answer pair on these four dimensions (1-5 integer scale):
1. concrete_example (1-5): Did the student provide a specific, real example?
2. star_structure (1-5): Did the answer follow STAR structure?
3. link_to_job (1-5): Did the student connect their experience to the target role?
4. quantifiable_outcome (1-5): Did the student include measurable results or impact?

Scoring guide (co-op student calibration):
- 5: Excellent for a co-op student — clear, specific, well-structured
- 4: Strong — demonstrates good understanding with minor gaps
- 3: Adequate — shows relevant experience but lacks detail or structure
- 2: Developing — vague or generic, needs more specificity
- 1: Missing — dimension not addressed at all

Provide your scoring judgments only. Do NOT calculate averages or assign labels.
Use supportive, constructive, student-friendly language in all feedback."""

def build(conversation: list, analyst_output: dict) -> tuple:
    # analyst_output is a structured JSON object containing candidate_profile, target_role,
    # resume_job_alignment, interview_plan, and selected_experiences
    messages = [{"role": "user", "content": _format_user_message(conversation, analyst_output)}]
    tool_config = _build_tool_config()
    system = SYSTEM_PROMPT
    return system, messages, tool_config
```

**Function schema (forces structured output):**

```python
EVALUATION_TOOL_SCHEMA = {
    "name": "submit_evaluation",
    "description": "Submit the interview evaluation with per-question scores and qualitative feedback",
    "inputSchema": {
        "json": {
            "type": "object",
            "required": ["per_question_scores", "strengths", "improvements", "keywords_covered", "keywords_not_covered", "contextual_advice"],
            "properties": {
                "per_question_scores": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["question_text", "feedback", "scores"],
                        "properties": {
                            "question_text": {"type": "string"},
                            "feedback": {
                                "type": "object",
                                "required": ["strength", "improvement"],
                                "properties": {
                                    "strength": {"type": "string"},
                                    "improvement": {"type": "string"}
                                }
                            },
                            "scores": {
                                "type": "object",
                                "required": ["concrete_example", "star_structure", "link_to_job", "quantifiable_outcome"],
                                "properties": {
                                    "concrete_example": {"type": "integer", "minimum": 1, "maximum": 5},
                                    "star_structure": {"type": "integer", "minimum": 1, "maximum": 5},
                                    "link_to_job": {"type": "integer", "minimum": 1, "maximum": 5},
                                    "quantifiable_outcome": {"type": "integer", "minimum": 1, "maximum": 5}
                                }
                            }
                        }
                    }
                },
                "strengths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Specific praise with quotes/references from the transcript"
                },
                "improvements": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Specific, actionable improvement advice tied to scoring dimensions"
                },
                "keywords_covered": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "keywords_not_covered": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "contextual_advice": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Advice referencing resume experiences or job competency gaps"
                }
            }
        }
    }
}
```

### 4. bedrock_client.py

**Responsibility:** Signs and sends environment-bounded Bedrock Mantle Chat Completions requests.

**Key design decisions:**
- Uses model ID `openai.gpt-oss-120b` in `us-east-1`
- Forces the `submit_evaluation` function through `tool_choice`
- Hosted mode uses one 55-second attempt; local mode retries transport/API exceptions once (max 2 total attempts)
- Does not retry malformed responses or missing tool output (`EvaluationError`)
- Extracts JSON function arguments from the response

```python
MODEL_ID = "openai.gpt-oss-120b"
REGION = "us-east-1"
MAX_ATTEMPTS = 2
HOSTED_REQUEST_TIMEOUT_SECONDS = 55

def invoke(system: str, messages: list, tool_config: dict) -> dict:
    max_attempts = 1 if hosted_guardrails_enabled() else MAX_ATTEMPTS
    for attempt in range(max_attempts):
        try:
            response = _post_chat_completion({
                "model": MODEL_ID,
                "messages": [{"role": "system", "content": system}, *messages],
                **tool_config,
            })
            return _extract_tool_input(response)
        except EvaluationError:
            raise
        except Exception as e:
            if attempt == max_attempts - 1:
                raise EvaluationError(f"Bedrock Mantle call failed after {max_attempts} attempts: {str(e)}")
    
def _extract_tool_input(response: dict) -> dict:
    function = response["choices"][0]["message"]["tool_calls"][0]["function"]
    if function["name"] != "submit_evaluation":
        raise EvaluationError("Expected submit_evaluation function call")
    return json.loads(function["arguments"])
```

### 5. scorer.py

**Responsibility:** Clamps raw scores, calculates aggregates, and determines the readiness label.

**Key design decisions:**
- All clamping is to 1-5 range
- Averages are computed only over questions present (variable-length support)
- Readiness label thresholds are proportionally mapped from the original 1-10 scale
- Classification is deterministic Python code, not LLM output

```python
DIMENSIONS = ["concrete_example", "star_structure", "link_to_job", "quantifiable_outcome"]

READINESS_THRESHOLDS = [
    (4.3, "Interview ready"),
    (3.5, "Strong foundation"),
    (2.8, "Developing well"),
    (2.0, "Needs more practice"),
    (1.0, "Needs clearer examples"),
]

def extract_and_clamp(llm_response: dict) -> list:
    """Clamp all dimension scores to 1-5 range."""
    per_question = llm_response["per_question_scores"]
    for question in per_question:
        for dim in DIMENSIONS:
            score = question["scores"][dim]
            question["scores"][dim] = max(1, min(5, int(score)))
    return per_question

def aggregate(per_question_scores: list) -> dict:
    """Calculate dimension averages and total score over answered questions only."""
    n = len(per_question_scores)
    dimension_averages = {}
    
    for dim in DIMENSIONS:
        total = sum(q["scores"][dim] for q in per_question_scores)
        dimension_averages[dim] = round(total / n, 1)
    
    total_score = round(sum(dimension_averages.values()) / len(DIMENSIONS), 1)
    
    return {
        "dimensions": dimension_averages,
        "total": total_score,
        "question_count": n
    }

def classify(total_score: float) -> str:
    """Deterministically assign readiness label based on 1-5 scale thresholds."""
    for threshold, label in READINESS_THRESHOLDS:
        if total_score >= threshold:
            return label
    return "Needs clearer examples"
```

### 6. response_assembler.py

**Responsibility:** Constructs the final JSON response body matching the expected frontend schema.

```python
def build(per_question_scores: list, overall_scores: dict, readiness_label: str, llm_response: dict, interview_metadata: dict) -> dict:
    return {
        "per_question_scores": per_question_scores,
        "overall_scores": {
            "dimensions": overall_scores["dimensions"],
            "total": overall_scores["total"]
        },
        "question_count": overall_scores["question_count"],
        "readiness_label": readiness_label,
        "strengths": llm_response["strengths"],
        "improvements": llm_response["improvements"],
        "contextual_advice": llm_response["contextual_advice"],
        "interview_metadata": interview_metadata
    }
```

### 7. exceptions.py

```python
class ValidationError(Exception):
    """Raised when input validation fails (400 response)."""
    pass

class EvaluationError(Exception):
    """Raised when evaluation processing fails (500 response)."""
    pass
```

## Data Models

### Input Payload

```json
{
  "session_token": "<opaque interview session token>",
  "conversation": [
    {
      "point_id": "point_1",
      "turn_type": "main_question",
      "question": "Could you describe the project and what you personally contributed?",
      "answer": "My team built a multilingual communication app, and I worked mainly on the frontend."
    },
    {
      "point_id": "point_1",
      "turn_type": "follow_up",
      "question": "What specific frontend feature did you implement?",
      "answer": "I built the language selection interface and connected it to the backend API."
    }
  ],
  "interview_metadata": {
    "candidate_level": "student_intern",
    "target_role": "Software Engineering Intern",
    "status": "completed",
    "completion_reason": "all_questions_completed",
    "main_questions_completed": 3,
    "follow_ups_completed": 3,
    "ended_early": false
  },
  "analyst_output": {
    "schema_version": "1.0",
    "candidate_profile": {
      "candidate_level": "student_intern",
      "education_summary": "Computer science student with relevant coursework.",
      "relevant_skills": ["Java", "Python", "React"],
      "experience_types_available": ["internship", "hackathon", "academic_project"]
    },
    "target_role": {
      "title": "Software Engineering Intern",
      "required_skills": ["programming", "problem-solving", "testing"],
      "evaluation_priorities": ["technical understanding", "learning ability", "teamwork"]
    },
    "resume_job_alignment": {
      "strong_matches": [{"resume_evidence": "...", "job_requirement": "...", "match_reason": "..."}],
      "partial_matches": [{"resume_evidence": "...", "job_requirement": "...", "match_reason": "..."}],
      "areas_to_explore": [{"topic": "testing", "reason": "Limited detail about testing responsibilities."}]
    },
    "interview_plan": [
      {"topic": "team leadership", "priority": 1, "question_type": "behavioral", "target_skill": "teamwork", "source_experience_id": "exp_1"}
    ],
    "selected_experiences": [
      {
        "experience_id": "exp_1",
        "title": "Configuration Management Tool",
        "experience_type": "internship",
        "organization": "Acme Corp",
        "summary": "Built a Java tool that analyzed configuration data.",
        "skills_demonstrated": ["Java", "testing", "caching"],
        "job_requirements_supported": ["software development", "problem-solving"],
        "candidate_claims": ["Improved processing speed by 40%"],
        "relevance_score": 0.94,
        "relevance_reason": "Direct match to required Java development and testing skills"
      }
    ],
    "analysis_warnings": ["Limited evidence of production AWS experience."]
  }
}
```

### Output Response (HTTP 200)

```json
{
  "per_question_scores": [
    {
      "question_text": "Could you describe the project and what you personally contributed?",
      "feedback": {
        "strength": "You grounded the answer in a specific multilingual app project.",
        "improvement": "Add a measurable result from the project."
      },
      "scores": {
        "concrete_example": 4,
        "star_structure": 3,
        "link_to_job": 4,
        "quantifiable_outcome": 2
      }
    }
  ],
  "overall_scores": {
    "dimensions": {
      "concrete_example": 3.8,
      "star_structure": 3.2,
      "link_to_job": 3.5,
      "quantifiable_outcome": 2.5
    },
    "total": 3.3
  },
  "question_count": 4,
  "readiness_label": "Developing well",
  "strengths": [
    "You provided a clear, specific example from your SE course project — 'I led a team of 4 to build a REST API' immediately grounds your answer."
  ],
  "improvements": [
    "Try to include measurable outcomes — for example, how many endpoints did the API have? How much did test coverage improve?"
  ],
  "keywords_covered": ["REST API", "testing"],
  "keywords_not_covered": ["AWS", "Docker"],
  "contextual_advice": [
    "Your resume mentions a hackathon project with real-time data processing. This experience directly maps to the 'stream processing' requirement in the job description — consider using it for questions about technical challenges."
  ],
  "interview_metadata": {
    "candidate_level": "student_intern",
    "target_role": "Software Engineering Intern",
    "status": "completed",
    "completion_reason": "all_questions_completed",
    "main_questions_completed": 3,
    "follow_ups_completed": 3,
    "ended_early": false
  }
}
```

### Error Response (HTTP 400 / 500)

```json
{
  "error": "ValidationError",
  "message": "Missing or empty required field: conversation"
}
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Orchestrator pattern (no state machine) | Single-invocation Lambda, linear flow, no branching logic needed |
| Forced function call for structured output | Produces schema-shaped JSON arguments without post-hoc text parsing |
| Scorer in Python, not LLM | Deterministic aggregation and classification; no LLM variance in math |
| 1-5 scale (not 1-10) | Simpler for students to interpret; reduces LLM scoring variance |
| Variable-length averaging | Students can stop early; no penalty for incomplete interviews |
| Co-op calibration in system prompt | Ensures LLM expectations match student-level experience |
| Environment-aware transport attempts | Hosted uses one bounded attempt to limit cost; local retains one retry; malformed model output fails immediately |
| Separate modules per concern | Testable units; clear responsibility boundaries |

## Constraints and Assumptions

- Hosted Lambda timeout is 60 seconds with one 55-second Mantle attempt; local execution retains two 120-second transport attempts
- Transcript is pre-formatted by the Interviewer agent as an array of {question, answer} objects
- Analyst output is a structured JSON object from the Analyst agent containing candidate_profile, target_role, resume_job_alignment, interview_plan, selected_experiences, and analysis_warnings
- The function URL handles CORS at the API layer (not in Lambda code)
- No interview-content storage; hosted authorization updates only the expiring per-session attempt counter
- Maximum submitted conversation size: 6 captured question-answer pairs. Nova is prompted for 3 mains plus 3 follow-ups, but the frontend does not enforce that semantic sequence.
- interview_metadata is passed through to the response unchanged; it is not used in scoring logic
