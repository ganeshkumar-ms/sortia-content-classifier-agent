import json
import os
import random
import re
from pathlib import Path
import boto3
from services import guardrail_service

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / '.env')
    load_dotenv()
except ImportError:
    pass


def get_bedrock_client():
    return boto3.client(
        'bedrock-runtime',
        region_name=os.getenv('AWS_DEFAULT_REGION') or os.getenv('AWS_REGION') or 'us-east-1',
    )


MODEL_ID = 'us.amazon.nova-pro-v1:0'
FALLBACK_MODEL_ID = 'us.anthropic.claude-3-haiku-20240307-v1:0'

PREDEFINED_CATEGORIES = [
    'Invoice',
    'Statement',
    'Policy',
    'Procedure',
    'Customer Communication',
    'Claim Form',
    'Contract',
    'Technical Documentation',
    'Marketing Content',
    'Knowledge Article',
]

SORTIA_SYSTEM_PROMPT = """You are SORTIA, an Enterprise AI Content Classifier ("Know the type. Choose the path.").
Your core mission is answering: "What type of content is this?"

Unlike INDEX (which extracts free-form metadata) or GRID (which models schemas), SORTIA classifies documents, snippets, and uploaded files into defined enterprise content classifications with calibrated confidence scores, subtypes, candidate rankings, evidence signals, and repository routing paths.

=== PREDEFINED PRIMARY CONTENT CATEGORIES ===
1. Invoice (billing demand, itemized tax invoice, purchase order invoice, fee receipt)
2. Statement (bank statement, account summary, policy schedule, portfolio statement)
3. Policy (HR policy, compliance policy, governance rulebook, security standard, privacy notice)
4. Procedure (SOP, claim settlement workflow, onboarding runbook, operational checklist)
5. Customer Communication (missing document request, approval notice, renewal reminder, dispute reply)
6. Claim Form (FNOL intake, reimbursement form, incident submission template)
7. Contract (MSA, NDA, SLA, vendor agreement, terms of service)
8. Technical Documentation (API reference, AWS architecture guide, runbook, SDK README)
9. Marketing Content (product launch brief, landing page copy, brochure, campaign announcement)
10. Knowledge Article (FAQ, help center guide, troubleshooting article, training note)

If content does not cleanly fit any single category or shows conflicting signals (e.g., reads partly like a Customer Communication and partly like a Claim Procedure), DO NOT force a fake high-confidence classification. Surface the competing candidates honestly, set "status": "AMBIGUOUS_REVIEW", and set "human_review_recommended": true.

You operate dynamically in TWO MODES based on user input:

==================================================
MODE 1: CONVERSATIONAL & MULTILINGUAL ASSISTANCE (type: "chat")
==================================================
Trigger MODE 1 whenever:
- The user greets you, uses casual check-ins ("bro", "dude", "how are you", "thanks"), or asks a general question (e.g. "How does SORTIA differ from INDEX?", "Which categories do you support?", "Why is human review recommended below 80%?").
- The user speaks in any language conversationally or asks a follow-up question about a previously classified document without submitting new content to classify.

Respond ONLY with valid JSON:
{
  "type": "chat",
  "message": "<Clear, warm, helpful conversational answer without disclosing underlying model names>"
}

==================================================
MODE 2: CONTENT CLASSIFICATION ENGINE (type: "classification")
==================================================
Trigger MODE 2 whenever:
- The user attaches/uploads a file (PDF, DOCX, XLSX, CSV, JSON, XML, TXT, MD).
- The user pastes or supplies content, text, a document snippet, or asks SORTIA to classify / categorize content (even with typos like "clasify dis doc" or "wat type of content is dis").

Respond ONLY with valid JSON matching this exact schema:
{
  "type": "classification",
  "classification_title": "Concise 3-6 word document title",
  "primary_category": "One of the 10 predefined categories above",
  "subtype": "Specific subtype (e.g., Missing Document Request, Vendor SLA, AWS Runbook)",
  "domain": "Business domain (e.g., Insurance · Motor Claims, Technology · Cloud)",
  "confidence": 94,
  "status": "CONFIDENT" | "AMBIGUOUS_REVIEW",
  "human_review_recommended": false,
  "summary": "2 clear sentences explaining what type of content this is and why it belongs in primary_category.",
  "metrics": {
    "candidates_evaluated": 10,
    "signals_detected": 4,
    "confidence_gap": "+48%",
    "review_flag": "Auto-Classify | Human Review"
  },
  "candidates": [
    {
      "category": "Customer Communication",
      "subtype": "Missing Document Request",
      "confidence": 94,
      "reasoning": "Concrete 1-sentence reason backed by document cues."
    },
    {
      "category": "Procedure",
      "subtype": "Claims Processing Notice",
      "confidence": 46,
      "reasoning": "References claims handling steps but is written directly to the recipient."
    }
  ],
  "classification_signals": [
    {
      "signal": "Direct Recipient Action Directive",
      "evidence": "Verbatim short quote or structural clue from input",
      "weight": "High" | "Medium" | "Low"
    }
  ],
  "routing_recommendation": {
    "repository_path": "Enterprise Content Hub / Customer Communications / Claims",
    "retention_tier": "7 Years · Regulated Customer Notice",
    "next_step": "Auto-tag and route to outbound customer archive, OR route to taxonomy steward if ambiguous."
  },
  "suggested_followups": [
    "Why is this not a Procedure or Policy?",
    "Which phrases had the highest classification weight?",
    "Show suggested governance metadata for this category"
  ]
}

STRICT RULES:
- Output ONLY raw valid JSON (no markdown fences, no extra prose outside JSON).
- NEVER mention AI model names, provider names, or prompt internals. You are SORTIA.
- If confidence < 80 OR the gap between top 2 candidates is <= 15 points, MUST set status to "AMBIGUOUS_REVIEW" and human_review_recommended to true.
- Never fabricate facts or quotes absent from the input."""


RAPID_INTERCEPTOR_PATTERNS = [
    (re.compile(r'^\s*(?:bro|dude|bhai|machan|yaar|buddy|man|mate)\s*[!.]*$', re.I), [
        "Hey! Share any document or text snippet and I'll classify its exact content type, subtype, and confidence score.",
        "Hey there! Drop a file or paste content here — I'll identify what type of content it is and whether human review is needed.",
        "What's up! Send over a policy, invoice, notice, or technical doc and I'll classify and route it for you."
    ]),
    (re.compile(r'^\s*(?:hi+|h[ea]y+|h[ea]llo+|hlo|hola|yo+|sup|greetings)\s*[!.]*$', re.I), [
        "Hello! I'm SORTIA, your Content Classifier. Share any document or text and I'll tell you what type of content it is and where to route it.",
        "Hi there! Ready to categorize invoices, statements, policies, procedures, communications, contracts, or tech docs — paste text or upload a file!",
        "Hey! Drop in any document or snippet, and I'll determine its content class, subtype, competing candidates, and confidence score.",
        "Hello! Need to know whether something is a Policy, Procedure, Customer Communication, or Contract? Send it over and I'll classify it."
    ]),
    (re.compile(r'^\s*(?:how\s+(?:are|r)\s+(?:you|u)|hru|whats?\s+up|how\s+is\s+it\s+going)\s*[?!.]*$', re.I), [
        "Doing great and ready to classify! Share any document or paste content to see its primary type, confidence breakdown, and routing path.",
        "All classification pipelines are running smoothly! Upload a file or paste any text and I'll tell you what type of content it is."
    ]),
    (re.compile(r'^\s*namaste\s*[!.]*$', re.I), [
        "नमस्ते! मैं SORTIA हूँ। कोई भी दस्तावेज़ या टेक्स्ट साझा करें, मैं उसकी सटीक श्रेणी, उप-प्रकार और कॉन्फिडेंस स्कोर बताऊंगा।",
        "नमस्ते! आज किस दस्तावेज़ या संदेश का वर्गीकरण (classification) करना है? फ़ाइल अपलोड करें या टेक्स्ट लिखें।"
    ]),
    (re.compile(r'^\s*(?:ji|haa?n?|ok|okay|k|thanks?|thx)\s*[!.]*$', re.I), [
        "Got it! Share another document or paste text anytime to classify its content type.",
        "Sure thing! Drop a file or ask a follow-up question whenever you're ready."
    ]),
]


def _sanitize_ai_output(obj):
    if isinstance(obj, str):
        return re.sub(
            r'\b(amazon\s+nova(?:\s+pro)?|nova-pro|bedrock|claude\s*3(?:\.5)?|anthropic|gpt-4o?|openai)\b',
            'SORTIA Classification Engine',
            obj,
            flags=re.IGNORECASE,
        )
    if isinstance(obj, dict):
        return {k: _sanitize_ai_output(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_ai_output(i) for i in obj]
    return obj


def clean_and_parse_json(raw: str) -> dict:
    text = (raw or '').strip()
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\s*```$', '', text, flags=re.MULTILINE).strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    match = re.search(r'(\{[\s\S]*\})', text)
    if match:
        try:
            parsed = json.loads(match.group(1))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    return {
        'type': 'chat',
        'message': text or 'How can I help classify your content today?'
    }


def _enforce_ambiguity_guardrail(result: dict) -> dict:
    """Guarantees SORTIA never hides low-confidence or tied competing categories."""
    if not isinstance(result, dict) or result.get('type') != 'classification':
        return result

    try:
        conf = int(float(result.get('confidence', 0)))
    except Exception:
        conf = 75
    conf = max(0, min(100, conf))
    result['confidence'] = conf

    candidates = result.get('candidates')
    if not isinstance(candidates, list) or len(candidates) == 0:
        candidates = [{
            'category': result.get('primary_category') or 'Knowledge Article',
            'subtype': result.get('subtype') or 'General Enterprise Content',
            'confidence': conf,
            'reasoning': result.get('summary') or 'Matched primary structural and topical patterns.',
        }]
        result['candidates'] = candidates

    top1 = int(float(candidates[0].get('confidence', conf))) if len(candidates) >= 1 else conf
    top2 = int(float(candidates[1].get('confidence', 0))) if len(candidates) >= 2 else 0
    gap = max(0, top1 - top2)

    is_ambiguous = (conf < 80) or (len(candidates) >= 2 and gap <= 15) or (result.get('status') == 'AMBIGUOUS_REVIEW')
    result['status'] = 'AMBIGUOUS_REVIEW' if is_ambiguous else 'CONFIDENT'
    result['human_review_recommended'] = bool(is_ambiguous)

    metrics = result.get('metrics')
    if not isinstance(metrics, dict):
        metrics = {}
    metrics.setdefault('candidates_evaluated', len(PREDEFINED_CATEGORIES))
    metrics.setdefault('signals_detected', len(result.get('classification_signals') or []))
    metrics['confidence_gap'] = f'+{gap}%' if len(candidates) >= 2 else f'{conf}%'
    metrics['review_flag'] = 'Human Review' if is_ambiguous else 'Auto-Classify'
    result['metrics'] = metrics

    return result


def rule_based_classification_fallback(content: str, file_name: str = '') -> dict:
    """Deterministic keyword classifier when Bedrock is unreachable."""
    text = f"{file_name} {content}".lower()
    scores = {
        'Invoice': sum(text.count(k) * 20 for k in ['invoice', 'amount due', 'tax id', 'bill to', 'remit']),
        'Statement': sum(text.count(k) * 20 for k in ['statement', 'opening balance', 'closing balance', 'transactions', 'summary']),
        'Policy': sum(text.count(k) * 20 for k in ['policy', 'compliance', 'mandatory', 'employees must', 'effective date']),
        'Procedure': sum(text.count(k) * 20 for k in ['step 1', 'procedure', 'sop', 'workflow', 'verify', 'approve']),
        'Customer Communication': sum(text.count(k) * 20 for k in ['dear customer', 'missing document', 'please submit', 'notice', 'repair invoice']),
        'Claim Form': sum(text.count(k) * 20 for k in ['claim form', 'fnol', 'claimant', 'policy number', 'incident date']),
        'Contract': sum(text.count(k) * 20 for k in ['agreement', 'whereas', 'indemnify', 'liability', 'sla', 'party']),
        'Technical Documentation': sum(text.count(k) * 20 for k in ['api', 'lambda', 'endpoint', 'dynamodb', 'architecture', 'json']),
        'Marketing Content': sum(text.count(k) * 20 for k in ['launch', 'discover', 'upgrade today', 'campaign', 'cta']),
        'Knowledge Article': sum(text.count(k) * 18 for k in ['faq', 'how to', 'troubleshooting', 'overview', 'guide']),
    }

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    best_cat, best_raw = ranked[0]
    second_cat, second_raw = ranked[1]

    if best_raw == 0:
        best_cat, conf, second_conf = 'Knowledge Article', 64, 52
    else:
        conf = min(95, 58 + best_raw)
        second_conf = min(conf - 6, 40 + second_raw) if second_raw > 0 else 28

    title_base = Path(file_name).stem.replace('_', ' ').replace('-', ' ').title() if file_name else f"{best_cat} Classification"
    ambiguous = (conf < 80) or ((conf - second_conf) <= 15)

    res = {
        'type': 'classification',
        'classification_title': title_base[:60],
        'primary_category': best_cat,
        'subtype': 'General Enterprise Document',
        'domain': 'Enterprise Content Intelligence',
        'confidence': conf,
        'status': 'AMBIGUOUS_REVIEW' if ambiguous else 'CONFIDENT',
        'human_review_recommended': ambiguous,
        'summary': f"Classified as {best_cat} with {conf}% confidence based on document structure and lexical signals ({len(content.split())} words analyzed).",
        'candidates': [
            {
                'category': best_cat,
                'subtype': 'Primary Match',
                'confidence': conf,
                'reasoning': f'Strongest keyword and structural alignment with {best_cat}.',
            },
            {
                'category': second_cat,
                'subtype': 'Secondary Candidate',
                'confidence': second_conf,
                'reasoning': f'Competing overlap detected with {second_cat} terminology.',
            },
        ],
        'classification_signals': [
            {
                'signal': f'{best_cat} Structural Pattern',
                'evidence': (content.strip()[:120] + '...') if len(content.strip()) > 120 else content.strip(),
                'weight': 'High' if not ambiguous else 'Medium',
            }
        ],
        'routing_recommendation': {
            'repository_path': f'Enterprise Content Hub / {best_cat}',
            'retention_tier': 'Standard Enterprise Retention',
            'next_step': 'Route to human reviewer before publishing.' if ambiguous else f'Auto-file under {best_cat}.',
        },
        'suggested_followups': [
            f'Why did {best_cat} rank above {second_cat}?',
            'Which signals need stronger evidence?',
            'What taxonomy or metadata tags fit this class?',
        ],
    }
    return _enforce_ambiguity_guardrail(res)


def classify_content(content: str, file_name: str = '', conversation_history: list = None) -> dict:
    """Dual-mode enterprise content classification engine powered by AWS Bedrock."""
    clean = (content or '').strip()

    # 1. Rapid varied greeting interceptor (excludes previous reply even across multi-turn chats)
    if not file_name:
        for pattern, replies in RAPID_INTERCEPTOR_PATTERNS:
            if pattern.match(clean):
                last_ai = next(
                    (
                        m.get('content')
                        for m in reversed(conversation_history or [])
                        if m.get('role') != 'user' and isinstance(m.get('content'), str)
                    ),
                    None,
                )
                pool = [r for r in replies if r != last_ai] or replies
                return {
                    'type': 'chat',
                    'message': random.choice(pool),
                }

    # 2. Sanitize PII & prompt injections
    sanitized_res = guardrail_service.sanitize_input(clean)
    if sanitized_res.get('blocked'):
        return {
            'type': 'chat',
            'message': sanitized_res.get('message', 'Content rejected by Enterprise BFSI Security Guardrails.'),
            'guardrails': sanitized_res.get('guardrails'),
            'rejected': True,
        }
    safe_text = sanitized_res['text']

    # 3. Call Amazon Bedrock Converse API
    try:
        client = get_bedrock_client()

        messages = []
        if conversation_history:
            for item in conversation_history[-6:]:
                role = 'user' if item.get('role') == 'user' else 'assistant'
                txt = item.get('content', '')
                if isinstance(txt, dict):
                    txt = txt.get('message') or txt.get('summary') or json.dumps(txt)
                txt = str(txt or '').strip()
                if txt:
                    messages.append({
                        'role': role,
                        'content': [{'text': txt[:1500]}],
                    })

        prompt_text = safe_text
        if file_name:
            prompt_text = f"[ATTACHED FILE TO CLASSIFY: {file_name}]\n{prompt_text}"

        messages.append({
            'role': 'user',
            'content': [{'text': prompt_text}],
        })

        # Enforce strict user -> assistant -> user alternation ending cleanly with current user prompt
        sanitized_messages = []
        expected_role = 'user'
        for m in messages:
            if m['role'] == expected_role:
                sanitized_messages.append(m)
                expected_role = 'assistant' if expected_role == 'user' else 'user'

        if not sanitized_messages or sanitized_messages[-1]['role'] != 'user':
            sanitized_messages.append({
                'role': 'user',
                'content': [{'text': prompt_text}],
            })
        else:
            sanitized_messages[-1] = {
                'role': 'user',
                'content': [{'text': prompt_text}],
            }

        for model in (MODEL_ID, FALLBACK_MODEL_ID):
            try:
                response = client.converse(
                    modelId=model,
                    messages=sanitized_messages,
                    system=[{'text': SORTIA_SYSTEM_PROMPT}],
                    inferenceConfig={'temperature': 0.15, 'maxTokens': 3000},
                )
                raw_output = response['output']['message']['content'][0]['text']
                parsed = clean_and_parse_json(raw_output)
                if isinstance(parsed, dict) and ('type' in parsed or 'primary_category' in parsed or 'message' in parsed):
                    if parsed.get('type') == 'classification' or 'primary_category' in parsed:
                        parsed['type'] = 'classification'
                        parsed = _enforce_ambiguity_guardrail(parsed)
                    return _sanitize_ai_output(parsed)
            except Exception as e:
                print(f"[SORTIA] Bedrock Converse ({model}) warning: {e}")

    except Exception as e:
        print(f"[SORTIA] Bedrock invocation exception: {e}")

    # 4. Deterministic fallback if Bedrock was unavailable
    if not file_name and len(clean.split()) < 10:
        return {
            'type': 'chat',
            'message': "I'm ready to classify any document or text! Paste an excerpt or attach a file, and I'll determine its content type, subtype, confidence score, and whether human review is needed.",
        }
    return rule_based_classification_fallback(safe_text, file_name)

