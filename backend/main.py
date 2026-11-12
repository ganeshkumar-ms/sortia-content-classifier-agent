import os
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
import lambda_function

app = FastAPI(title="SORTIA Content Classifier API")


@app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def proxy_to_lambda(full_path: str, request: Request):
    body = await request.body()
    event = {
        "httpMethod": request.method,
        "path": "/" + full_path.lstrip("/"),
        "headers": dict(request.headers),
        "body": body.decode("latin-1") if body else "",
        "isBase64Encoded": False,
    }
    res = lambda_function.lambda_handler(event, None)
    status = res.get("statusCode", 200)
    headers = res.get("headers", {})
    raw_body = res.get("body", "")
    if res.get("isBase64Encoded"):
        import base64
        return Response(content=base64.b64decode(raw_body), status_code=status, headers=headers)
    return Response(content=raw_body, status_code=status, headers=headers)

