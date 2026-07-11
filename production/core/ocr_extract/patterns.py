"""
Regex fallbacks for dates and ID numbers — used when a value can't be tied
to a recognised label (unlabeled layouts, or a label in a language not yet
in labels.py). These are cross-checks, not authoritative: field_extractor
prefers label-adjacency matches and only falls back to these.
"""

from __future__ import annotations

import re

_MONTHS = (
    "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|"
    "january|february|march|april|june|july|august|september|october|november|december"
)

# Numeric dates: 07-09-1997, 07/09/1997, 07.09.1997, 1997-09-07
DATE_NUMERIC_RE = re.compile(
    r"\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})\b"
)

# Textual dates: "15th Apr 2025", "15 April 2025", "15-Apr-2025"
DATE_TEXTUAL_RE = re.compile(
    rf"\b(\d{{1,2}}(?:st|nd|rd|th)?[\s\-]?(?:{_MONTHS})[\s\-]?,?\s?\d{{2,4}})\b",
    re.IGNORECASE,
)

# ID / document numbers: long digit runs, optionally space/dash grouped —
# deliberately broad since formats vary wildly by country/document.
ID_NUMBER_RE = re.compile(r"\b(?=(?:\d[\s\-]?){9,20}\b)[\d\s\-]{9,20}\b")

SEX_TOKEN_RE = re.compile(r"^(m|f|male|female|h|x)$", re.IGNORECASE)


def find_dates(text: str) -> list[str]:
    matches = DATE_NUMERIC_RE.findall(text) + DATE_TEXTUAL_RE.findall(text)
    return [m.strip() for m in matches if m and m.strip()]


def find_id_numbers(text: str) -> list[str]:
    out = []
    for m in ID_NUMBER_RE.finditer(text):
        digits_only = re.sub(r"\D", "", m.group(0))
        if len(digits_only) >= 9:
            out.append(m.group(0).strip())
    return out


def looks_like_sex(text: str) -> bool:
    return bool(SEX_TOKEN_RE.match(text.strip()))


def looks_like_date(text: str) -> bool:
    return bool(DATE_NUMERIC_RE.search(text) or DATE_TEXTUAL_RE.search(text))
