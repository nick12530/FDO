from __future__ import annotations

from collections.abc import Iterable


def symbol_allows_open(trade_mode: int, direction: str | None = None) -> bool:
    if direction == "BUY":
        return trade_mode in (1, 4)
    if direction == "SELL":
        return trade_mode in (2, 4)
    return trade_mode in (1, 2, 4)


def select_broker_symbol(
    requested: str,
    candidates: Iterable[tuple[str, int, bool]],
    direction: str | None = None,
) -> str | None:
    normalized = requested.upper().replace("/", "")
    is_gold = "XAU" in normalized or "GOLD" in normalized
    base_names = ("XAUUSD", "GOLD") if is_gold else (normalized,)
    ranked: list[tuple[tuple[int, int, int, int], str]] = []

    for name, trade_mode, visible in candidates:
        normalized_name = name.upper().replace("/", "")
        if not any(base in normalized_name for base in base_names):
            continue
        if not symbol_allows_open(trade_mode, direction):
            continue
        match_rank = (
            0 if normalized_name == normalized else
            1 if normalized_name.startswith(normalized) else
            2 if normalized_name.endswith(normalized) else
            3
        )
        ranked.append((
            (
                0 if trade_mode == 4 else 1,
                0 if visible else 1,
                match_rank,
                len(name),
            ),
            name,
        ))

    return min(ranked, key=lambda candidate: candidate[0])[1] if ranked else None
