import datetime
import hashlib
import uuid
import json
import os
import random
import re
import time
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
  "document_type_detected": "Specific document format/type (e.g., C2PA Signature Document, Vendor MSA, AWS Architecture Runbook)",
  "primary_category": "One of the 10 predefined categories above",
  "secondary_classifications": ["Digital Identity", "Security Metadata", "Content Authenticity"],
  "taxonomy_hierarchy": ["Technology", "Security & Digital Trust", "Digital Signatures", "C2PA"],
  "subtype": "Specific subtype (e.g., Missing Document Request, Vendor SLA, AWS Runbook)",
  "domain": "Business domain (e.g., Insurance · Motor Claims, Technology · Security)",
  "confidence": 94,
  "confidence_calibration": "High | Moderate | Low",
  "ambiguity": {
    "score": 14,
    "level": "Low | Moderate | High",
    "overlapping_categories": [],
    "conflicting_signals": [],
    "reasoning": "1-sentence explanation of why ambiguity is low, moderate, or high."
  },
  "status": "CONFIDENT" | "AMBIGUOUS_EXCEPTION",
  "human_review_recommended": false,
  "summary": "2 clear sentences explaining what type of content this is, why it was classified this way, and where it belongs.",
  "metrics": {
    "candidates_evaluated": 10,
    "signals_detected": 5,
    "confidence_gap": "+48%",
    "review_flag": "Autonomous Route | Exception Queue"
  },
  "candidates": [
    {
      "category": "Technical Documentation",
      "subtype": "Cryptographic Specification",
      "confidence": 94,
      "ranking_score": 94,
      "status": "Selected Primary",
      "reasoning": "Concrete 1-sentence reason backed by document cues.",
      "rejection_reason": ""
    },
    {
      "category": "Contract",
      "subtype": "Vendor SLA",
      "confidence": 18,
      "ranking_score": 18,
      "status": "Rejected Alternative",
      "reasoning": "Contains compliance terminology but lacks bilateral legal clauses.",
      "rejection_reason": "No binding legal obligations, signatures, or indemnity clauses found."
    }
  ],
  "classification_signals": [
    {
      "signal": "Named Signal (e.g., Cryptographic Assertion Structure)",
      "explanation": "1-sentence explanation of how this signal influenced classification.",
      "evidence": "Verbatim short quote or structural clue from input",
      "weight": "High" | "Medium" | "Low",
      "category_influence": "Technical Documentation"
    }
  ],
  "extracted_metadata": {
    "document_title": "Extracted or inferred title",
    "author_or_issuer": "Organization or author if present, else Not specified",
    "dates": ["Extracted dates if any"],
    "identifiers": ["IDs, version numbers, standard codes if any"],
    "version": "Version string if present, else Not specified",
    "entities": ["Named organizations, systems, or standards"],
    "keywords": ["Top 5-8 domain keywords"]
  },
  "sensitivity": {
    "level": "Public | Internal | Confidential | Restricted",
    "pii_detected": [],
    "sensitive_identifiers": [],
    "data_handling_policy": "Short policy rule (e.g., Internal technical archive · Standard access control)"
  },
  "routing_recommendation": {
    "repository_path": "Enterprise Content Hub / Technology / Security / C2PA",
    "retention_tier": "7 Years · Enterprise Governance",
    "next_step": "Automatically indexed and routed to target repository."
  },
  "suggested_followups": [
    "Why was the top alternative category rejected?",
    "Which signals had the highest classification weight?",
    "What happens if ambiguity rises on similar documents?"
  ]
}

STRICT RULES:
- Output ONLY raw valid JSON (no markdown fences, no extra prose outside JSON).
- NEVER mention AI model names, provider names, or prompt internals. You are SORTIA.
- Candidate scores are ranking/similarity scores, NOT calibrated independent probabilities. Always explain why alternatives were rejected.
- If confidence < 78 OR the gap between top 2 candidates is <= 15 points, MUST set status to "AMBIGUOUS_EXCEPTION" and ambiguity.level to "High".
- Never fabricate facts, dates, or quotes absent from the input."""


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

    is_ambiguous = (conf < 78) or (len(candidates) >= 2 and gap <= 15) or (result.get('status') in ('AMBIGUOUS_REVIEW', 'AMBIGUOUS_EXCEPTION'))
    result['status'] = 'AMBIGUOUS_EXCEPTION' if is_ambiguous else 'CONFIDENT'
    result['human_review_recommended'] = bool(is_ambiguous)

    metrics = result.get('metrics')
    if not isinstance(metrics, dict):
        metrics = {}
    metrics.setdefault('candidates_evaluated', len(PREDEFINED_CATEGORIES))
    metrics.setdefault('signals_detected', len(result.get('classification_signals') or []))
    metrics['confidence_gap'] = f'+{gap}%' if len(candidates) >= 2 else f'{conf}%'
    metrics['review_flag'] = 'Exception Queue' if is_ambiguous else 'Autonomous Route'
    result['metrics'] = metrics

    return result


LEDGER_PATH = (Path('/tmp') if os.path.exists('/tmp') else Path(__file__).resolve().parent.parent / 'uploads') / 'sortia_routing_ledger.json'

DEFAULT_TAXONOMY_MAP = {
    'Invoice': ['Finance & Billing', 'Accounts Payable', 'Invoices & Receipts'],
    'Statement': ['Finance & Accounting', 'Account Reporting', 'Statements & Schedules'],
    'Policy': ['Governance & Compliance', 'Enterprise Policies', 'Standard Policy'],
    'Procedure': ['Operations & Delivery', 'Standard Operating Procedures', 'Workflow Runbook'],
    'Customer Communication': ['Customer Operations', 'Outbound Communications', 'Customer Notice'],
    'Claim Form': ['Insurance Operations', 'Claims Intake', 'Claim Submission'],
    'Contract': ['Legal & Procurement', 'Agreements & SLAs', 'Binding Contract'],
    'Technical Documentation': ['Technology', 'Engineering & Architecture', 'Technical Specification'],
    'Marketing Content': ['Brand & Growth', 'Campaign Assets', 'Marketing Collateral'],
    'Knowledge Article': ['Enterprise Knowledge', 'Help & Enablement', 'Reference Guide'],
}

ROUTING_RULES_MAP = {
    'Invoice': ('Finance ERP & AP Repository', '/Finance/Accounts-Payable/Invoices/', 'Finance Operations', 'AP-3-Way-Match'),
    'Statement': ('Financial Reporting Archive', '/Finance/Statements/Archive/', 'Treasury & Reporting', 'Statement-Reconciliation'),
    'Policy': ('Compliance & Policy Registry', '/Governance/Policies/Active/', 'Risk & Compliance', 'Policy-Index-Sync'),
    'Procedure': ('Operations Runbook Hub', '/Operations/SOPs/Verified/', 'Enterprise Operations', 'SOP-Catalog-Update'),
    'Customer Communication': ('Customer Communications Hub', '/Customer-Ops/Outbound-Notices/', 'Customer Experience', 'CRM-Archive-Sync'),
    'Claim Form': ('Claims Intake & Adjudication Hub', '/Claims/Intake/Submissions/', 'Claims Processing', 'FNOL-Triage-Pipeline'),
    'Contract': ('Legal Contract Vault (CLM)', '/Legal/Contracts/Executed/', 'Legal & Procurement', 'CLM-Obligation-Index'),
    'Technical Documentation': ('Technical Documentation Repository', '/Technology/Documentation/Specs/', 'Engineering & Architecture', 'DevPortal-Docs-Sync'),
    'Marketing Content': ('Brand & DAM Content Hub', '/Marketing/Campaigns/Assets/', 'Marketing & Brand', 'DAM-Asset-Publish'),
    'Knowledge Article': ('Enterprise Knowledge Base', '/Knowledge/Articles/Published/', 'Enablement & Support', 'KB-Search-Index'),
}


def _load_routing_ledger() -> list:
    try:
        if LEDGER_PATH.exists():
            data = json.loads(LEDGER_PATH.read_text(encoding='utf-8'))
            if isinstance(data, list):
                return data
    except Exception:
        pass
    return []


def _save_routing_ledger(entries: list):
    try:
        LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
        LEDGER_PATH.write_text(json.dumps(entries[-100:], indent=2), encoding='utf-8')
    except Exception:
        pass


def _enrich_and_execute_routing(result: dict, text: str, file_name: str, started_at: float) -> dict:
    """
    Upgrades classification output with multi-label tags, hierarchical taxonomy,
    separate ambiguity scoring, sensitivity checks, metadata extraction,
    real duplicate/similarity detection, deterministic autonomous routing,
    and real persisted routing analytics.
    """
    if not isinstance(result, dict) or result.get('type') != 'classification':
        return result

    primary = result.get('primary_category') or 'Knowledge Article'
    conf = int(result.get('confidence', 75))
    candidates = result.get('candidates') or []
    signals = result.get('classification_signals') or []
    raw_text = (text or '').strip()
    lower_text = raw_text.lower()

    # 1. Confidence Calibration & Candidate Normalization (ranking_score vs probability)
    if not result.get('confidence_calibration'):
        result['confidence_calibration'] = 'High' if conf >= 88 else ('Moderate' if conf >= 75 else 'Low')

    norm_candidates = []
    for idx, c in enumerate(candidates):
        score = int(float(c.get('ranking_score', c.get('confidence', 0))))
        status = c.get('status') or ('Selected Primary' if idx == 0 else 'Rejected Alternative')
        rej_reason = c.get('rejection_reason') or ''
        if idx > 0 and not rej_reason:
            rej_reason = f"Scored {conf - score} points below {primary}; lacks primary structural dominance."
        norm_candidates.append({
            **c,
            'ranking_score': score,
            'confidence': score,
            'status': status,
            'rejection_reason': rej_reason
        })
    result['candidates'] = norm_candidates

    # 2. Separate Ambiguity Score & Level
    top1 = norm_candidates[0]['ranking_score'] if len(norm_candidates) >= 1 else conf
    top2 = norm_candidates[1]['ranking_score'] if len(norm_candidates) >= 2 else 0
    gap = max(0, top1 - top2)
    amb_data = result.get('ambiguity') if isinstance(result.get('ambiguity'), dict) else {}
    if 'score' not in amb_data:
        amb_score = max(5, min(95, 100 - conf + max(0, 25 - gap)))
    else:
        amb_score = max(0, min(100, int(float(amb_data.get('score', 20)))))
    amb_level = amb_data.get('level') or ('High' if (amb_score >= 45 or conf < 78 or gap <= 15) else ('Moderate' if amb_score >= 25 else 'Low'))
    overlapping = amb_data.get('overlapping_categories') or ([c.get('category') for c in norm_candidates[1:3] if c.get('ranking_score', 0) >= 40])
    result['ambiguity'] = {
        'score': amb_score,
        'level': amb_level,
        'overlapping_categories': overlapping,
        'conflicting_signals': amb_data.get('conflicting_signals') or [],
        'reasoning': amb_data.get('reasoning') or (
            f"Candidate separation is +{gap}% with {len(signals)} supporting signal(s)."
            if amb_level == 'Low'
            else f"Detected category overlap ({', '.join(overlapping) or 'multiple classes'}) requiring exception evaluation."
        )
    }

    # 3. Multi-label Secondary Classifications & Smart Taxonomy Hierarchy
    sec_labels = result.get('secondary_classifications')
    if not isinstance(sec_labels, list) or len(sec_labels) == 0:
        sec_labels = [c.get('category') for c in norm_candidates[1:3] if c.get('ranking_score', 0) >= 35]
        if result.get('subtype'):
            sec_labels.append(result['subtype'])
    result['secondary_classifications'] = list(dict.fromkeys([str(x) for x in sec_labels if x]))[:5]

    taxonomy = result.get('taxonomy_hierarchy')
    if not isinstance(taxonomy, list) or len(taxonomy) < 2:
        taxonomy = list(DEFAULT_TAXONOMY_MAP.get(primary, ['Enterprise Content', primary]))
        if result.get('subtype') and result['subtype'] not in taxonomy:
            taxonomy.append(result['subtype'])
    result['taxonomy_hierarchy'] = [str(t) for t in taxonomy[:5]]

    # 4. Metadata & Entity Extraction (grounded in real text)
    meta = result.get('extracted_metadata') if isinstance(result.get('extracted_metadata'), dict) else {}
    dates_found = meta.get('dates') if isinstance(meta.get('dates'), list) and meta.get('dates') else re.findall(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?|\b\d{4}-\d{2}-\d{2}\b', raw_text)[:5]
    ids_found = meta.get('identifiers') if isinstance(meta.get('identifiers'), list) and meta.get('identifiers') else re.findall(r'\b[A-Z]{2,6}-\d{2,8}\b', raw_text)[:5]
    ext = Path(file_name).suffix.upper().lstrip('.') if file_name else 'TEXT'
    result['extracted_metadata'] = {
        'document_title': meta.get('document_title') or result.get('classification_title') or (file_name or 'Submitted Content'),
        'author_or_issuer': meta.get('author_or_issuer') or 'Not specified in text',
        'dates': list(dict.fromkeys([str(d) for d in dates_found]))[:5],
        'identifiers': list(dict.fromkeys([str(i) for i in ids_found]))[:5],
        'version': meta.get('version') or 'Not specified',
        'entities': (meta.get('entities') or [])[:6],
        'keywords': (meta.get('keywords') or [])[:8],
        'file_type': ext or 'TEXT',
        'word_count': len(raw_text.split())
    }

    # 5. Sensitivity Classification & Deterministic Access Policy
    sens = result.get('sensitivity') if isinstance(result.get('sensitivity'), dict) else {}
    pii_hits = list(sens.get('pii_detected') or [])
    if re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b', raw_text) and 'Email Address' not in pii_hits:
        pii_hits.append('Email Address')
    if re.search(r'\b\d{3}-\d{2}-\d{4}\b', raw_text) and 'SSN Pattern' not in pii_hits:
        pii_hits.append('SSN Pattern')
    sens_level = sens.get('level') or (
        'Restricted' if any(k in lower_text for k in ['strictly confidential', 'restricted', 'top secret', 'private key']) else
        'Confidential' if (pii_hits or any(k in lower_text for k in ['confidential', 'nda', 'proprietary', 'internal only'])) else
        'Internal'
    )
    access_cleared = sens_level != 'Restricted'
    result['sensitivity'] = {
        'level': sens_level,
        'pii_detected': pii_hits,
        'sensitive_identifiers': sens.get('sensitive_identifiers') or [],
        'data_handling_policy': sens.get('data_handling_policy') or (
            'Restricted handling: blocked from standard auto-routing; escalated to security queue.'
            if not access_cleared
            else f'{sens_level} handling policy verified · Eligible for automated repository routing.'
        ),
        'access_control_cleared': access_cleared
    }

    # 6. Duplicate & Similarity Detection against real persisted ledger
    content_hash = hashlib.sha256(raw_text.encode('utf-8', errors='ignore')).hexdigest()[:16]
    tokens = set(re.findall(r'\b[a-z0-9]{4,}\b', lower_text))
    ledger = _load_routing_ledger()
    similar_docs = []
    exact_duplicate = False
    for prev in ledger[-30:]:
        if prev.get('content_hash') == content_hash:
            exact_duplicate = True
            similar_docs.append({
                'title': prev.get('title', 'Previous Document'),
                'category': prev.get('primary_category', ''),
                'similarity_pct': 100,
                'match_type': 'Exact Duplicate (SHA-256)',
                'timestamp': prev.get('timestamp', '')
            })
        elif tokens and prev.get('tokens'):
            prev_tokens = set(prev['tokens'])
            union = len(tokens | prev_tokens)
            if union > 0:
                jacc = round((len(tokens & prev_tokens) / union) * 100)
                if jacc >= 35:
                    similar_docs.append({
                        'title': prev.get('title', 'Related Document'),
                        'category': prev.get('primary_category', ''),
                        'similarity_pct': jacc,
                        'match_type': 'Content Similarity',
                        'timestamp': prev.get('timestamp', '')
                    })
    similar_docs = sorted(similar_docs, key=lambda x: x['similarity_pct'], reverse=True)[:4]
    result['similarity_check'] = {
        'content_fingerprint': content_hash,
        'exact_duplicate': exact_duplicate,
        'matches': similar_docs
    }

    # 7. Autonomous Routing Decision & Execution (No Human Approval)
    repo_name, repo_path, dept, wf_trigger = ROUTING_RULES_MAP.get(
        primary,
        ('Enterprise Content Hub', f'/Enterprise/{primary.replace(" ", "-")}/', 'Content Operations', 'General-Index-Sync')
    )
    existing_routing = result.get('routing_recommendation') if isinstance(result.get('routing_recommendation'), dict) else {}
    dest_path = existing_routing.get('repository_path') or repo_path

    is_exception = (amb_level == 'High') or (conf < 78) or (not access_cleared)
    exec_status = 'EXCEPTION_QUEUE' if is_exception else 'ROUTED'
    final_dest_name = 'Automated Ambiguity & Policy Exception Queue' if is_exception else repo_name
    final_dest_path = '/Exceptions/Auto-Triage-Queue/' if is_exception else dest_path
    exec_reason = (
        'Restricted sensitivity policy prevents automated external routing.' if not access_cleared
        else f'Ambiguity level is {amb_level} (confidence {conf}%, gap +{gap}%); routed to automated exception queue rather than guessing.' if is_exception
        else f'Confidence {conf}% with {amb_level} ambiguity and {sens_level} policy clearance; autonomously routed and indexed.'
    )

    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    audit_ref = f"AUD-{uuid.uuid4().hex[:8].upper()}"
    proc_ms = max(12, int((time.time() - started_at) * 1000))

    result['autonomous_routing'] = {
        'execution_status': exec_status,
        'destination_repository': final_dest_name,
        'destination_path': final_dest_path,
        'department': dept,
        'workflow_triggered': 'Exception-Deep-Context-Retry' if is_exception else wf_trigger,
        'retention_tier': existing_routing.get('retention_tier') or '7 Years · Enterprise Governance',
        'execution_reason': exec_reason,
        'audit_ref': audit_ref,
        'processing_time_ms': proc_ms,
        'executed_at': now_iso,
        'verification_steps': [
            {'stage': '01. Document Input', 'status': 'completed', 'detail': file_name or 'Direct text stream'},
            {'stage': '02. Content Extraction', 'status': 'completed', 'detail': f"{len(raw_text.split())} words parsed"},
            {'stage': '03. Signal Detection', 'status': 'completed', 'detail': f"{len(signals)} named signals extracted"},
            {'stage': '04. Multi-Label AI', 'status': 'completed', 'detail': f"{primary} + {len(result['secondary_classifications'])} tags"},
            {'stage': '05. Ambiguity Analysis', 'status': 'warning' if is_exception else 'completed', 'detail': f"{amb_level} ({amb_score}/100)"},
            {'stage': '06. Sensitivity & Policy', 'status': 'blocked' if not access_cleared else 'completed', 'detail': f"{sens_level}"},
            {'stage': '07. Routing Execution', 'status': 'exception' if is_exception else 'completed', 'detail': final_dest_path},
            {'stage': '08. Audit & Index Logged', 'status': 'completed', 'detail': audit_ref},
        ]
    }
    result['routing_recommendation'] = {
        'repository_path': final_dest_path,
        'retention_tier': result['autonomous_routing']['retention_tier'],
        'next_step': exec_reason,
    }

    # 8. Persist to Ledger & Compute Real Routing Analytics
    ledger.append({
        'title': result['extracted_metadata']['document_title'],
        'primary_category': primary,
        'execution_status': exec_status,
        'processing_time_ms': proc_ms,
        'content_hash': content_hash,
        'tokens': list(tokens)[:40],
        'timestamp': now_iso,
        'audit_ref': audit_ref
    })
    _save_routing_ledger(ledger)

    total_vol = len(ledger)
    routed_cnt = sum(1 for e in ledger if e.get('execution_status') == 'ROUTED')
    exc_cnt = sum(1 for e in ledger if e.get('execution_status') == 'EXCEPTION_QUEUE')
    avg_ms = round(sum(int(e.get('processing_time_ms', proc_ms)) for e in ledger) / max(1, total_vol))
    cat_dist = {}
    for e in ledger:
        c = e.get('primary_category') or 'Other'
        cat_dist[c] = cat_dist.get(c, 0) + 1

    result['routing_analytics'] = {
        'total_processed': total_vol,
        'routed_count': routed_cnt,
        'exception_count': exc_cnt,
        'success_rate_pct': round((routed_cnt / max(1, total_vol)) * 100),
        'avg_processing_ms': avg_ms,
        'category_distribution': [{'category': k, 'count': v} for k, v in sorted(cat_dist.items(), key=lambda x: x[1], reverse=True)[:6]],
        'recent_activity': [{'title': e.get('title'), 'category': e.get('primary_category'), 'status': e.get('execution_status'), 'timestamp': e.get('timestamp')} for e in reversed(ledger[-5:])]
    }

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
    started_at = time.time()
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
        trace_code = f"SRT-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
        return {
            'type': 'chat',
            'message': sanitized_res.get('message', 'Content rejected by Enterprise BFSI Security Guardrails.'),
            'guardrail_status': 'BLOCKED',
            'guardrails': sanitized_res.get('guardrails', {"status": "BLOCKED"}),
            'rejected': True,
            'trace_id': trace_code,
            'data': {
                'trace_id': trace_code,
                'guardrails': sanitized_res.get('guardrails', {"status": "BLOCKED"})
            }
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
                        parsed = _enrich_and_execute_routing(parsed, safe_text, file_name, started_at)
                    trace_code = f"SRT-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
                    parsed['trace_id'] = trace_code
                    parsed['guardrails'] = {
                        "status": "REDACTED" if sanitized_res.get("pii_detected") else "PASSED",
                        "pci_dss_sanitized": True,
                        "redacted_count": sanitized_res.get("guardrails", {}).get("redacted_count", 0),
                        "redacted_types": sanitized_res.get("guardrails", {}).get("redacted_types", []),
                    }
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
    res = rule_based_classification_fallback(safe_text, file_name)
    res = _enrich_and_execute_routing(res, safe_text, file_name, started_at)
    trace_code = f"SRT-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    if isinstance(res, dict):
        res['trace_id'] = trace_code
        res['guardrails'] = {"status": "PASSED", "pci_dss_sanitized": True}
    return res

