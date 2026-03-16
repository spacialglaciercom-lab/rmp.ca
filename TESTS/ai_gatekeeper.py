"""
AI Gatekeeper: sends raw file preview to an LLM and returns normalized CVRP or CPP JSON.

Supported backends (first set wins):
- VERCEL_AI_GATEWAY_API_KEY or AI_GATEWAY_API_KEY → Vercel AI Gateway (OpenAI-compatible)
- GEMINI_API_KEY → Google Gemini
- OPENAI_API_KEY → OpenAI

Output schema:
- CVRP: {"type": "CVRP", "capacity": int, "depot_id": int (optional), "nodes": [{"id", "lat", "lon", "demand"}]}
- CPP: {"type": "CPP", "edges": [{"u", "v", "weight"}]}
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

SYSTEM_PROMPT = """You are a data ingestion parser for a routing engine. Analyze the following raw text file.

1. Determine if this is a Node Routing problem (CVRP/TSP) or an Arc Routing problem (CPP).
2. Extract the data into a strict JSON schema. Output only valid JSON, no other text.

If CVRP (or TSP), return exactly:
{"type": "CVRP", "capacity": <integer vehicle capacity>, "depot_id": <optional, first node id if single depot>, "nodes": [{"id": <int>, "lat": <float>, "lon": <float>, "demand": <int, default 0>}]}
Use "lat" and "lon" for coordinates (WGS84 decimal degrees or same units as the file). If the file uses x,y instead of lat,lon, use x for lon and y for lat. Ensure every node has id, lat, lon, and demand.

If CPP (edge list / arc routing), return exactly:
{"type": "CPP", "edges": [{"u": <int>, "v": <int>, "weight": <float, default 1.0>}]}

Do not output anything other than the JSON. No markdown, no explanation."""


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences if present."""
    text = text.strip()
    for pattern in (r"^```(?:json)?\s*\n?(.*?)\n?```\s*$", r"^```\s*\n?(.*?)\n?```\s*$"):
        m = re.search(pattern, text, re.DOTALL)
        if m:
            return m.group(1).strip()
    return text


VERCEL_AI_GATEWAY_BASE = "https://ai-gateway.vercel.sh/v1"


def call_ai_gatekeeper(
    raw_text: str,
    api_key_override: str | None = None,
    api_base_url_override: str | None = None,
) -> dict[str, Any]:
    """
    Send raw file text to the LLM and return parsed CVRP or CPP payload.

    Args:
        raw_text: First ~100 lines (or N chars) of the uploaded file.
        api_key_override: If set, use this key for OpenAI or ZAI (OpenAI-compatible) API.
        api_base_url_override: If set with api_key_override, use this base URL (e.g. ZAI endpoint).

    Returns:
        Dict with "type" ("CVRP" or "CPP") and the corresponding payload keys.

    Raises:
        ValueError: If API key is missing, or response is invalid/missing "type".
    """
    # Dashboard override (OpenAI or ZAI) takes precedence
    if api_key_override and api_key_override.strip():
        return _call_openai(
            raw_text,
            api_key_override.strip(),
            base_url=api_base_url_override.strip() if api_base_url_override else None,
        )
    # Priority: Vercel AI Gateway → Gemini → OpenAI
    vercel_key = os.environ.get("VERCEL_AI_GATEWAY_API_KEY") or os.environ.get("AI_GATEWAY_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")

    if vercel_key:
        return _call_vercel(raw_text, vercel_key)
    if gemini_key:
        return _call_gemini(raw_text, gemini_key)
    if openai_key:
        return _call_openai(raw_text, openai_key)
    raise ValueError(
        "No AI API key set. Set one of: VERCEL_AI_GATEWAY_API_KEY, AI_GATEWAY_API_KEY, "
        "GEMINI_API_KEY, or OPENAI_API_KEY. Or enter an OpenAI / ZAI key in the sidebar."
    )


def _call_gemini(raw_text: str, api_key: str) -> dict[str, Any]:
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    response = model.generate_content(
        [SYSTEM_PROMPT, raw_text],
        generation_config=genai.types.GenerationConfig(
            temperature=0.0,
            max_output_tokens=8192,
        ),
    )
    if not response or not response.text:
        raise ValueError("Empty response from Gemini.")
    text = _strip_code_fences(response.text)
    data = json.loads(text)
    if data.get("type") not in ("CVRP", "CPP"):
        raise ValueError("AI response missing or invalid 'type'; expected CVRP or CPP.")
    return data


def _call_vercel(raw_text: str, api_key: str) -> dict[str, Any]:
    """Call Vercel AI Gateway (OpenAI-compatible) at ai-gateway.vercel.sh."""
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=VERCEL_AI_GATEWAY_BASE)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": raw_text},
        ],
        temperature=0.0,
        max_tokens=8192,
    )
    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise ValueError("Empty response from Vercel AI Gateway.")
    text = _strip_code_fences(content)
    data = json.loads(text)
    if data.get("type") not in ("CVRP", "CPP"):
        raise ValueError("AI response missing or invalid 'type'; expected CVRP or CPP.")
    return data


def _call_openai(
    raw_text: str,
    api_key: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Call OpenAI or any OpenAI-compatible API (e.g. ZAI) with optional base_url."""
    from openai import OpenAI

    kwargs: dict = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url.rstrip("/")
    client = OpenAI(**kwargs)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": raw_text},
        ],
        temperature=0.0,
        max_tokens=8192,
    )
    content = (response.choices[0].message.content or "").strip()
    if not content:
        raise ValueError("Empty response from OpenAI.")
    text = _strip_code_fences(content)
    data = json.loads(text)
    if data.get("type") not in ("CVRP", "CPP"):
        raise ValueError("AI response missing or invalid 'type'; expected CVRP or CPP.")
    return data
