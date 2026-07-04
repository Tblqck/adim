"""
Multi-language field-label dictionary for ID document layouts.

Maps a canonical field name to every label string we can reliably confirm
across languages commonly printed on national IDs, passports, and driving
licences. Matching is done case-insensitively against normalised OCR text
(see _normalize) so accents/diacritics don't need duplicate entries.

This is a *seed* list, not a closed one — templates.py extends it per
country/doc_type at runtime with labels the field extractor confirmed by
other means (regex match adjacent to an unrecognised label), so coverage
grows from real scans instead of requiring every language up front.
"""

from __future__ import annotations

import re
import unicodedata

CANONICAL_FIELDS = [
    "surname",
    "given_names",
    "date_of_birth",
    "expiry_date",
    "issue_date",
    "id_number",
    "nationality",
    "sex",
]

# Each value is a list of label strings as they commonly appear printed
# (before normalisation). Slash-combined bilingual labels (e.g. government
# IDs that print "SURNAME/NOM") are handled by substring matching, not by
# needing the exact combined string here.
LABELS: dict[str, list[str]] = {
    "surname": [
        "surname", "last name", "family name",
        "nom", "nom de famille",
        "apellido", "apellidos",
        "sobrenome", "apelido",
        "nachname", "familienname",
        "cognome",
        "achternaam",
        "фамилия",
        "soyadi", "soyadı",
        "الاسم العائلي", "اللقب",
    ],
    "given_names": [
        "given name", "given names", "first name", "forename", "forenames",
        "prenom", "prenoms", "prénom", "prénoms",
        "nombre", "nombres",
        "nome", "nomes", "primeiro nome",
        "vorname", "vornamen",
        "voornaam", "voornamen",
        "имя",
        "ad", "adi", "adı",
        "الاسم",
    ],
    "date_of_birth": [
        "date of birth", "birth date", "born",
        "date de naissance", "ne le", "née le", "né le",
        "fecha de nacimiento",
        "data de nascimento",
        "geburtsdatum", "geboren am",
        "data di nascita",
        "geboortedatum",
        "дата рождения",
        "dogum tarihi", "doğum tarihi",
        "تاريخ الميلاد",
    ],
    "expiry_date": [
        "date of expiry", "expiry date", "expiration date", "valid until", "expires",
        "date d'expiration", "date d'expiration",
        "fecha de caducidad", "fecha de vencimiento",
        "data de validade",
        "gultig bis", "gültig bis", "ablaufdatum",
        "data di scadenza",
        "geldig tot",
        "действительно до",
        "son gecerlilik tarihi", "son geçerlilik tarihi",
        "تاريخ الانتهاء",
    ],
    "issue_date": [
        "date of issue", "issue date", "issued",
        "date de delivrance", "date de délivrance",
        "fecha de expedicion", "fecha de expedición",
        "data de emissao", "data de emissão",
        "ausstellungsdatum",
        "data di rilascio",
        "afgiftedatum",
        "дата выдачи",
        "veriliş tarihi",
        "تاريخ الإصدار",
    ],
    "id_number": [
        "identification number", "national identification number", "id number",
        "id no", "document number", "document no", "card number", "personal number",
        "numero de identification", "numéro d'identification", "numero de document",
        "numero de identificacion", "número de identificación", "numero de documento",
        "numero de identidade", "número de identidade",
        "ausweisnummer", "personalausweisnummer",
        "numero di documento", "numero di carta",
        "identiteitsnummer", "documentnummer",
        "номер документа", "идентификационный номер",
        "kimlik numarasi", "kimlik numarası",
        "رقم الوثيقة", "رقم الهوية",
    ],
    "nationality": [
        "nationality",
        "nationalite", "nationalité",
        "nacionalidad",
        "nacionalidade",
        "staatsangehorigkeit", "staatsangehörigkeit",
        "nazionalita", "nazionalità",
        "nationaliteit",
        "гражданство",
        "uyruk", "uyruğu",
        "الجنسية",
    ],
    "sex": [
        "sex", "gender",
        "sexe",
        "sexo",
        "geschlecht",
        "sesso",
        "geslacht",
        "пол",
        "cinsiyet",
        "الجنس",
    ],
}


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().strip()
    text = re.sub(r"[.:_\-]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text


# Precomputed normalised (field, label) pairs, longest label first so a
# substring scan prefers the most specific match (e.g. "date of expiry"
# before "date").
_NORMALIZED_PAIRS: list[tuple[str, str, str]] = sorted(
    (
        (field, _normalize(label), label)
        for field, labels in LABELS.items()
        for label in labels
    ),
    key=lambda t: len(t[1]),
    reverse=True,
)


def match_field(text: str, extra_labels: dict[str, list[str]] | None = None) -> str | None:
    """
    Return the canonical field name if `text` contains a known label as a
    whole word/phrase, else None. Word-boundary matching matters here —
    short labels like "nom" (fr: surname) or "ad" (tr: given name) would
    otherwise false-positive inside unrelated OCR text ("ECONOMI" contains
    "nom", "COMUNIDADE" contains "ad"). `extra_labels` (field -> [label,
    ...]) lets callers (e.g. templates.py) fold in learned labels without
    mutating the static dict.
    """
    norm = _normalize(text)
    if not norm:
        return None

    pairs = _NORMALIZED_PAIRS
    if extra_labels:
        pairs = pairs + sorted(
            (
                (field, _normalize(label), label)
                for field, labels in extra_labels.items()
                for label in labels
            ),
            key=lambda t: len(t[1]),
            reverse=True,
        )

    for field, norm_label, _orig in pairs:
        if norm_label and re.search(rf"\b{re.escape(norm_label)}\b", norm):
            return field
    return None
