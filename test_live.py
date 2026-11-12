import json
import sys
import urllib.request
import uuid

CF_URL = ''
API_URL = ''
for idx, arg in enumerate(sys.argv[1:], 1):
    if arg == '--cf' and idx < len(sys.argv) - 1:
        CF_URL = sys.argv[idx + 1]
    elif arg == '--api' and idx < len(sys.argv) - 1:
        API_URL = sys.argv[idx + 1]
if not CF_URL and not API_URL:
    CF_URL = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != 'skip' else ''
    API_URL = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != 'skip' else ''


def _multipart_request(url: str, fields: dict, file_field: tuple = None, timeout: int = 35):
    boundary = f'----SortiaBoundary{uuid.uuid4().hex}'
    parts = []
    for k, v in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode('utf-8')
        )
    if file_field:
        fname, fbytes, ctype = file_field
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\nContent-Type: {ctype}\r\n\r\n'.encode('utf-8')
            + fbytes + b'\r\n'
        )
    parts.append(f'--{boundary}--\r\n'.encode('utf-8'))
    body = b''.join(parts)
    req = urllib.request.Request(
        url,
        data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))


def run_tests(base_url: str, label: str):
    print(f'\n--- Testing {label}: {base_url} ---')
    # 1. Health
    with urllib.request.urlopen(f'{base_url}/api/health', timeout=15) as r:
        health = json.loads(r.read().decode('utf-8'))
        assert health['status'] == 'ok' and health['agent'] == 'SORTIA', health
        print('  [1/6] /api/health PASS:', health['agent'], health['eyebrow'])

    # 2. Non-repeating greetings across turns
    replies = []
    hist_list = []
    for _ in range(3):
        st, d = _multipart_request(
            f'{base_url}/api/classify',
            {'text': 'hi', 'conversation_history': json.dumps(hist_list)},
        )
        assert st == 200 and d['type'] == 'chat' and d['message'], d
        replies.append(d['message'])
        hist_list.append({'role': 'user', 'content': 'hi'})
        hist_list.append({'role': 'assistant', 'content': d['message']})
    assert len(set(replies)) >= 2, f'Repeated identical replies: {replies}'
    print(f'  [2/6] Consecutive Greetings Varied PASS ({len(set(replies))} unique):', replies[0][:75])

    # 3. Conversational Concept Question (Mode 1)
    st, d = _multipart_request(
        f'{base_url}/api/classify',
        {'text': 'How does SORTIA differ from INDEX?', 'conversation_history': '[]'},
    )
    assert st == 200 and d['type'] == 'chat' and len(d.get('message', '')) > 20, d
    print('  [3/6] Conversational Mode 1 PASS:', d['message'][:90])

    # 4. Clear Content Classification (Mode 2)
    notice = (
        "Dear Policyholder, Your motor accident claim #MC-98412 cannot be settled yet because "
        "we have not received the final garage repair invoice. Please upload the repair invoice "
        "via the customer portal before November 15 to avoid processing delays."
    )
    st, d = _multipart_request(f'{base_url}/api/classify', {'text': notice, 'conversation_history': '[]'})
    assert st == 200 and d.get('type') == 'classification', d
    assert d.get('primary_category') and d.get('confidence', 0) > 0, d
    assert isinstance(d.get('candidates'), list) and len(d['candidates']) >= 1, d
    print('  [4/6] Clear Classification Mode 2 PASS:', d.get('primary_category'), f"({d.get('subtype')}) {d.get('confidence')}%")

    # 5. Ambiguous Classification Check + Human Review Guardrail
    ambig_text = (
        "When an accident occurs, report within 24 hours. Step 1: Collect repair photos. "
        "Please reply to confirm coverage applicability under Clause 4 or update claim details."
    )
    st, da = _multipart_request(f'{base_url}/api/classify', {'text': ambig_text, 'conversation_history': '[]'})
    assert st == 200 and da.get('type') == 'classification' and len(da.get('candidates', [])) >= 2, da
    print(
        '  [5/6] Multi-Candidate Ambiguity Check PASS:',
        da.get('primary_category'),
        f"conf={da.get('confidence')}% human_review={da.get('human_review_recommended')}",
    )

    # 6. File Upload + Document Viewer Endpoint
    doc_bytes = (
        b"INVOICE #INV-2026-4410\n"
        b"Bill To: Meridian Retail Corp\n"
        b"Line Item 1: Enterprise Cloud Managed Support - $4,500.00\n"
        b"Total Amount Due: $4,500.00\n"
        b"Payment Terms: Net 30 Days\n"
    )
    st, df = _multipart_request(
        f'{base_url}/api/classify',
        {'text': '', 'conversation_history': '[]'},
        file_field=('enterprise_invoice_4410.txt', doc_bytes, 'text/plain'),
    )
    assert st == 200 and df.get('type') == 'classification' and df.get('document'), df
    view_url = df['document']['view_url']
    with urllib.request.urlopen(f'{base_url}{view_url}', timeout=15) as vr:
        html_doc = vr.read().decode('utf-8')
        assert vr.status == 200 and 'SORTIA CONTENT SOURCE' in html_doc and 'INV-2026-4410' in html_doc
    print('  [6/6] File Upload + Document Viewer PASS:', df['primary_category'], '->', df['document']['filename'])


if __name__ == '__main__':
    if API_URL:
        run_tests(API_URL.rstrip('/'), 'API Gateway')
    if CF_URL:
        with urllib.request.urlopen(CF_URL.rstrip('/'), timeout=15) as resp:
            assert resp.status == 200 and 'SORTIA' in resp.read().decode('utf-8')
        print('\nCloudFront root HTML HTTP 200 PASS')
        run_tests(CF_URL.rstrip('/'), 'CloudFront End-to-End')
    print('\nALL SORTIA TESTS PASSED!')

