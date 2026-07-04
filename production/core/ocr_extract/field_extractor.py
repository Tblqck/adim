"""
The "smart placement" layer — turns a flat list of OCR lines + boxes into
named fields (surname, given_names, date_of_birth, expiry_date, id_number,
nationality, sex) without needing a pre-built coordinate template.

Strategy, in order of trust:
  1. Label-adjacency: find a line that matches a known field label (static
     dictionary in labels.py, extended with any learned_labels passed in
     from templates.py), then take its value from the same line (if the
     label and value share a line) or the next unconsumed line(s).
  2. Shape-aware forward search: when hunting for a label's value, prefer
     a nearby line whose *shape* matches the field (a date pattern for
     date fields, a digit run for id_number) over blindly taking line+1 —
     this survives an extra decorative line between label and value.
  3. Regex-only fallback: for fields no label was found for at all, scan
     every unconsumed line for a matching pattern (dates, digit runs).

engine.py's OCR output already comes out line-grouped (PP-OCR's detector
draws one box per text line, not per word), so "lines" here are just the
Word list in engine order — no separate line-clustering step needed.
"""

from __future__ import annotations

import re
from typing import Optional

from . import labels as labels_mod
from . import patterns
from .engine import Word

# How many unconsumed lines forward of a label to search for its value.
_FORWARD_WINDOW = 3

# Fields whose value is typically a short single line right after the label
# (as opposed to given_names, which can span multiple lines).
_SINGLE_LINE_FIELDS = {
    "surname", "date_of_birth", "expiry_date", "issue_date",
    "id_number", "nationality", "sex",
}

_SHAPE_CHECK = {
    "date_of_birth": patterns.looks_like_date,
    "expiry_date": patterns.looks_like_date,
    "issue_date": patterns.looks_like_date,
    "id_number": lambda t: bool(patterns.find_id_numbers(t)),
    "sex": patterns.looks_like_sex,
}


_DECORATIVE_RE = re.compile(r"^[\(\[\{].*[\)\]\}]$")


def _strip_label(text: str, label_text: str) -> str:
    """Remove a matched label substring (case/diacritic-insensitive) from a line."""
    norm_text = labels_mod._normalize(text)
    norm_label = labels_mod._normalize(label_text)
    idx = norm_text.find(norm_label)
    if idx == -1:
        return text.strip()
    # Map back to original string length heuristically: normalisation rarely
    # changes length enough to matter for ID-card label/value splits, so a
    # simple proportional cut is good enough here.
    cut = int(len(text) * (idx + len(norm_label)) / max(len(norm_text), 1))
    remainder = text[cut:].strip(" :/-")
    return remainder


def _is_real_value(remainder: str) -> bool:
    """
    Reject same-line "remainder" text that is actually leftover label
    decoration — a second-language tag from a combined "SURNAME/NOM" style
    label, or a parenthesised abbreviation like "(NIN)". Both cases either
    are themselves a known label synonym or look purely decorative.
    """
    if not remainder or len(remainder) < 2:
        return False
    if _DECORATIVE_RE.match(remainder):
        return False
    if labels_mod.match_field(remainder) is not None:
        return False
    return True


def _find_shaped_span(words: list[Word], candidates: list[int], shape_check) -> list[int] | None:
    """
    Try concatenating 2-3 consecutive candidate indices and test the joined
    text against shape_check — handles values a detector split across
    adjacent lines (e.g. a long ID number broken into two boxes).
    """
    for size in (2, 3):
        for k in range(len(candidates) - size + 1):
            span = candidates[k:k + size]
            if span != list(range(span[0], span[0] + size)):
                continue  # only adjacent, in-order lines — not scattered picks
            joined = " ".join(words[j].text.strip() for j in span)
            if shape_check(joined):
                return span
    return None


def extract(
    words: list[Word],
    learned_labels: Optional[dict[str, list[str]]] = None,
) -> dict:
    """
    Returns:
        {
          "fields": {field_name: str, ...},
          "full_name": str,
          "raw_text": str,
          "matches": {field_name: {"source": "label"|"regex", "label_text": str|None,
                                     "bbox": (x,y,w,h)}},
        }
    """
    n = len(words)
    consumed = [False] * n
    fields: dict[str, str] = {}
    matches: dict[str, dict] = {}

    def mark_value(field: str, idx: int, value: str, source: str, label_text: str | None):
        wd = words[idx]
        fields[field] = value
        matches[field] = {
            "source": source,
            "label_text": label_text,
            "bbox": (wd.x, wd.y, wd.w, wd.h),
        }
        consumed[idx] = True

    # ── Pass 1: label-adjacency ──────────────────────────────────────────
    for i, wd in enumerate(words):
        if consumed[i]:
            continue

        field = labels_mod.match_field(wd.text)
        source_label_is_new = False
        if field is None and learned_labels:
            field = labels_mod.match_field(wd.text, extra_labels=learned_labels)

        if field is None or field in fields:
            continue

        # Same-line label+value (e.g. "SURNAME: DOE")
        norm_text = labels_mod._normalize(wd.text)
        candidate_labels = list(labels_mod.LABELS.get(field, []))
        if learned_labels:
            candidate_labels += learned_labels.get(field, [])
        matched_label_text = next(
            (
                lbl for lbl in candidate_labels
                if re.search(rf"\b{re.escape(labels_mod._normalize(lbl))}\b", norm_text)
            ),
            None,
        )
        remainder = _strip_label(wd.text, matched_label_text) if matched_label_text else ""
        if _is_real_value(remainder):
            consumed[i] = True
            mark_value(field, i, remainder, "label", matched_label_text)
            continue

        consumed[i] = True  # the label line itself is spent either way

        # Forward search among unconsumed lines for the value
        shape_check = _SHAPE_CHECK.get(field)
        candidates = [
            j for j in range(i + 1, min(i + 1 + _FORWARD_WINDOW, n))
            if not consumed[j] and labels_mod.match_field(words[j].text) is None
        ]
        if not candidates:
            continue

        if shape_check:
            # A shaped field (date/id/sex) is worse wrong than missing —
            # only assign when a candidate actually matches the expected
            # shape, never fall back to "the next line, whatever it is".
            # Some values (e.g. a long ID number) are split across two
            # adjacent lines by the detector, so also try 2-3 consecutive
            # candidates concatenated before giving up.
            chosen = next((j for j in candidates if shape_check(words[j].text)), None)
            if chosen is None:
                span = _find_shaped_span(words, candidates, shape_check)
                if span:
                    value = " ".join(words[j].text.strip() for j in span)
                    for j in span:
                        consumed[j] = True
                    mark_value(field, span[0], value, "label", matched_label_text)
                continue
        else:
            chosen = candidates[0]

        if field in _SINGLE_LINE_FIELDS:
            mark_value(field, chosen, words[chosen].text.strip(), "label", matched_label_text)
        else:
            # given_names: absorb consecutive unconsumed, non-label lines
            span = [chosen]
            for j in range(chosen + 1, min(chosen + 3, n)):
                if consumed[j] or labels_mod.match_field(words[j].text) is not None:
                    break
                if patterns.looks_like_date(words[j].text) or patterns.find_id_numbers(words[j].text):
                    break
                span.append(j)
            value = " ".join(words[j].text.strip() for j in span)
            for j in span:
                consumed[j] = True
            fields[field] = value
            matches[field] = {
                "source": "label",
                "label_text": matched_label_text,
                "bbox": (words[chosen].x, words[chosen].y, words[chosen].w, words[chosen].h),
            }

    # ── Pass 2: regex-only fallback for anything still missing ─────────
    remaining = [i for i in range(n) if not consumed[i]]

    if "id_number" not in fields:
        for i in remaining:
            found = patterns.find_id_numbers(words[i].text)
            if found:
                mark_value("id_number", i, found[0], "regex", None)
                break

    date_fields_missing = [f for f in ("date_of_birth", "expiry_date") if f not in fields]
    if date_fields_missing:
        date_hits = [i for i in remaining if not consumed[i] and patterns.looks_like_date(words[i].text)]
        # Heuristic: with no label to disambiguate, earliest date -> DOB,
        # any later date -> expiry. Good enough as a fallback; label match
        # (pass 1) is what actually disambiguates in the common case.
        for i in date_hits:
            if not date_fields_missing:
                break
            field = date_fields_missing.pop(0)
            mark_value(field, i, words[i].text.strip(), "regex", None)

    full_name = " ".join(filter(None, [fields.get("given_names"), fields.get("surname")])).strip()

    return {
        "fields": fields,
        "full_name": full_name,
        "raw_text": "\n".join(wd.text for wd in words),
        "matches": matches,
    }
