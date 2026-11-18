from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse


CATEGORY_KEYWORDS = {
    "economic": (
        "gdp", "inflation", "cpi", "ppi", "interest rate", "fed", "ecb", "boe", "boj",
        "payroll", "nfp", "unemployment", "retail sales", "pmi", "fomc", "treasury",
        "yield", "bond", "recession", "growth", "central bank", "rate hike", "rate cut",
    ),
    "financial": (
        "forex", "fx", "stock", "equity", "market", "gold", "oil", "crypto", "bitcoin",
        "nasdaq", "dow", "s&p", "bank", "earnings", "liquidity", "volatility", "commodity",
        "eurusd", "gbpusd", "usdjpy", "xauusd", "wall street", "nikkei",
    ),
    "political": (
        "election", "president", "parliament", "congress", "sanctions", "war", "geopolit",
        "tariff", "trade war", "white house", "nato", "summit", "minister", "diplomacy",
        "conflict", "vote", "legislation", "policy",
    ),
}


def classify_category(title: str, summary: str = "") -> str:
    text = f"{title} {summary}".lower()
    scores = {
        category: sum(1 for keyword in keywords if keyword in text)
        for category, keywords in CATEGORY_KEYWORDS.items()
    }
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "financial"


def _text(node: ET.Element | None) -> str:
    if node is None or node.text is None:
        return ""
    return re.sub(r"\s+", " ", node.text).strip()


def _parse_pub_date(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, IndexError, OverflowError):
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat()
        except ValueError:
            return None


def parse_rss_items(xml_payload: str, source_name: str) -> list[dict[str, Any]]:
    if re.search(r"<!DOCTYPE|<!ENTITY", xml_payload, re.IGNORECASE):
        return []
    try:
        root = ET.fromstring(xml_payload)
    except ET.ParseError:
        return []

    items: list[dict[str, Any]] = []
    channel = root.find("channel")
    nodes = channel.findall("item") if channel is not None else root.findall(".//item")

    for node in nodes:
        title = _text(node.find("title"))
        if not title:
            continue
        link = _text(node.find("link")) or _text(node.find("guid"))
        parsed_link = urlparse(link)
        if parsed_link.scheme not in {"http", "https"} or not parsed_link.netloc:
            link = ""
        summary = _text(node.find("description"))
        # Strip residual HTML tags from summaries
        summary = re.sub(r"<[^>]+>", " ", summary)
        summary = re.sub(r"\s+", " ", summary).strip()
        published_at = _parse_pub_date(_text(node.find("pubDate")) or None)
        if published_at is None:
            continue
        source_host = urlparse(link).netloc.replace("www.", "") if link else source_name
        digest = hashlib.sha1(f"{title}|{link}|{published_at}".encode("utf-8")).hexdigest()[:16]
        items.append(
            {
                "id": f"{source_name}:{digest}",
                "title": title[:240],
                "summary": summary[:420],
                "url": link,
                "source": source_host or source_name,
                "category": classify_category(title, summary),
                "publishedAt": published_at,
            }
        )
    return items


def merge_news_items(batches: list[list[dict[str, Any]]], limit: int = 40) -> list[dict[str, Any]]:
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for batch in batches:
        for item in batch:
            normalized_title = re.sub(r"[^a-z0-9]+", " ", str(item.get("title", "")).lower()).strip()
            key = normalized_title or str(item.get("id") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(item)

    def sort_key(item: dict[str, Any]) -> float:
        try:
            return datetime.fromisoformat(str(item.get("publishedAt", "")).replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0.0

    merged.sort(key=sort_key, reverse=True)
    return merged[:limit]
