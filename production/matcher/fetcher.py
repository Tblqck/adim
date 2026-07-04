"""
Wikimedia Commons reference image fetcher.

Given a country + doc_type, checks the local reference store.
If fewer than MIN_REFS images exist it queries Wikimedia Commons,
downloads up to MAX_SAMPLES images, and caches them for future runs.

Filters applied at every stage:
  - Wikimedia API: dimension + aspect ratio + file-size before download
  - Filename blocklist: rejects obviously irrelevant titles (trucks, flags, year < 1980)
  - Post-download: PIL aspect-ratio + minimum-dimension check; deletes rejects

Usage:
    from matcher.fetcher import ensure_refs
    result = ensure_refs({'code2': 'ng', 'name': 'Nigeria'}, 'passport')
    # {'files': [Path, ...], 'fetched': 4, 'source': 'wikimedia'}
"""

import hashlib
import re
import time
from pathlib import Path

try:
    import requests as _req
    def _get(url, **kw):
        return _req.get(url, timeout=kw.pop('timeout', 15), **kw)
except ImportError:
    import urllib.request as _urllib
    import json as _json
    class _FakeResp:
        def __init__(self, data, code):
            self.content = data
            self.status_code = code
        def json(self):
            return _json.loads(self.content)
    def _get(url, params=None, timeout=15, **_kw):
        from urllib.parse import urlencode
        full = url + ('?' + urlencode(params) if params else '')
        req  = _urllib.Request(full, headers={'User-Agent': 'KYCVerifier/1.0'})
        try:
            with _urllib.urlopen(req, timeout=timeout) as r:
                return _FakeResp(r.read(), r.status)
        except Exception:
            return _FakeResp(b'{}', 0)

REFS_ROOT       = Path(__file__).parent.parent / 'references'
REFS_ALPHA_ROOT = Path(__file__).parent.parent.parent / 'id_alpha'
MAX_SAMPLES = 10
MIN_REFS    = 3
WM_API      = 'https://commons.wikimedia.org/w/api.php'
HEADERS     = {'User-Agent': 'KYCVerifier/1.0 (apps@goliveweb.eu)'}

# ISO 3166-1 alpha-2  →  lowercase alpha-3  (for id_alpha/ folder lookup)
_A2_TO_A3 = {
    'af':'afg','ao':'ago','al':'alb','ae':'are','ar':'arg','am':'arm',
    'au':'aus','at':'aut','az':'aze','bi':'bdi','be':'bel','bd':'bgd',
    'bg':'bgr','bh':'bhr','bs':'bhs','ba':'bih','by':'blr','bz':'blz',
    'bm':'bmu','br':'bra','bn':'brn','bt':'btn','bw':'bwa','bf':'bfa',
    'bj':'ben','cf':'caf','ca':'can','cl':'chl','cn':'chn','ci':'civ',
    'cm':'cmr','cd':'cod','cg':'cog','co':'col','km':'com','cv':'cpv',
    'cr':'cri','cu':'cub','cy':'cyp','cz':'cze','dk':'dnk','dj':'dji',
    'dm':'dma','do':'dom','dz':'dza','ec':'ecu','eg':'egy','er':'eri',
    'et':'eth','ee':'est','fi':'fin','fo':'fro','fr':'fra','ga':'gab',
    'gm':'gmb','ge':'geo','de':'deu','gh':'gha','gi':'gib','gr':'grc',
    'gd':'grd','gn':'gin','gw':'gnb','gy':'guy','ht':'hti','hn':'hnd',
    'hk':'hkg','hr':'hrv','hu':'hun','is':'isl','in':'ind','id':'idn',
    'ir':'irn','iq':'irq','ie':'irl','il':'isr','it':'ita','jm':'jam',
    'jo':'jor','jp':'jpn','kz':'kaz','ke':'ken','kg':'kgz','kh':'khm',
    'kp':'prk','kr':'kor','kw':'kwt','la':'lao','lb':'lbn','lr':'lbr',
    'ly':'lby','lk':'lka','ls':'lso','lt':'ltu','lu':'lux','lv':'lva',
    'ma':'mar','mc':'mco','md':'mda','mg':'mdg','mv':'mdv','mx':'mex',
    'mk':'mkd','ml':'mli','mt':'mlt','mn':'mng','me':'mne','mz':'moz',
    'mr':'mrt','ms':'msr','mw':'mwi','my':'mys','na':'nam','ng':'nga',
    'ni':'nic','np':'npl','nl':'nld','nz':'nzl','no':'nor','om':'omn',
    'pk':'pak','pa':'pan','pe':'per','ph':'phl','pl':'pol','py':'pry',
    'pt':'prt','qa':'qat','ro':'rou','ru':'rus','rw':'rwa','sa':'sau',
    'sd':'sdn','sn':'sen','sg':'sgp','sl':'sle','sv':'slv','sm':'smr',
    'so':'som','rs':'srb','ss':'ssd','st':'stp','sr':'sur','sc':'syc',
    'sy':'syr','td':'tcd','tg':'tgo','th':'tha','tm':'tkm','tl':'tls',
    'tn':'tun','tr':'tur','tv':'tuv','tw':'twn','tz':'tza','ug':'uga',
    'ua':'ukr','uy':'ury','us':'usa','uz':'uzb','va':'vat','ve':'ven',
    'vn':'vnm','ye':'yem','za':'zaf','zm':'zmb','zw':'zwe','ch':'che',
    'li':'lie','gb':'gbr','se':'swe','dk':'dnk','fi':'fin','sk':'svk',
    'si':'svn','es':'esp','pt':'prt','hu':'hun','ro':'rou','bg':'bgr',
    'hr':'hrv','cn':'chn','jp':'jpn','kr':'kor',
}

# Expected aspect ratio range (width / height) per doc type.
# ISO 7810 ID-1 (credit card format): 85.6 x 53.98 mm -> exactly 1.585
# Keep a ±15% tolerance to accommodate slight angles / border crops.
DOC_ASPECT_RANGE = {
    'passport':         (0.45, 0.95),   # portrait booklet page / bio-data page
    'national_id':      (1.35, 1.85),   # ID-1 card landscape
    'drivers_license':  (1.35, 1.85),   # ID-1 card landscape
    'residence_permit': (1.30, 1.90),   # ID-1 card landscape (some are slightly taller)
}

# Minimum original image dimensions
MIN_WIDTH  = 280
MIN_HEIGHT = 160

# File-size range to accept (bytes): 20 KB - 6 MB
MIN_SIZE = 20_000
MAX_SIZE = 6_000_000

# Wikimedia Commons category name patterns per doc type (tried in order)
CATEGORY_PATTERNS = {
    'passport': [
        'Passports of {country}',
        'Passports of the {country}',
        'Passport of {country}',
        '{country} passports',
        'Travel documents of {country}',
        'Travel documents of the {country}',
    ],
    'national_id': [
        'National identity cards of {country}',
        'National identity cards of the {country}',
        'Identity cards of {country}',
        'Identity cards of the {country}',
        'National identity card of {country}',
        'Identity documents of {country}',
        '{country} national identity cards',
    ],
    'drivers_license': [
        'Driving licences of {country}',
        'Driving licences of the {country}',
        'Driving licenses of {country}',
        'Driving licenses of the {country}',
        "Driver's licences of {country}",
        "Driver's licences of the {country}",
        "Driver's licenses of {country}",
        "Driver's licenses of the {country}",
        'Driving licence of {country}',
        '{country} driving licences',
        'Road transport documents of {country}',
    ],
    'residence_permit': [
        'Residence permits of {country}',
        'Residence permits of the {country}',
        'Residence permit of {country}',
        'Residence cards of {country}',
        'Residency permits of {country}',
        'Work and residence permits of {country}',
    ],
}

# Per-doc-type text search query templates tried when categories yield nothing.
# {country} and {authority} are substituted at runtime.
TEXT_SEARCH_TEMPLATES = {
    'passport': [
        '"{country}" passport biometric specimen',
        '"{country}" international passport document scan',
        '"{country}" passport front page data',
    ],
    'national_id': [
        '"{country}" national identity card specimen',
        '"{country}" "{authority}" national ID card',
        '"{country}" identity card document front',
    ],
    'drivers_license': [
        '"{country}" "{authority}" driving licence card',
        '"{country}" driving licence card specimen front',
        '"{country}" driver license card document',
        '"{country}" driving licence front scan',
    ],
    'residence_permit': [
        '"{country}" residence permit card specimen',
        '"{country}" residency card document',
    ],
}

# Country-specific issuing authority names used to sharpen text search
COUNTRY_AUTHORITY = {
    'drivers_license': {
        'ng': 'FRSC',           # Federal Road Safety Corps
        'gh': 'DVLA',           # Driver and Vehicle Licensing Authority
        'ke': 'NTSA',           # National Transport and Safety Authority
        'za': 'DLTC',           # Driving Licence Testing Centre
        'gb': 'DVLA',
        'us': 'DMV',
        'de': 'Fuhrerschein',
        'fr': 'permis conduire',
        'in': 'RTO',
        'pk': 'NTRC',
        'eg': 'traffic driving licence',
    },
    'national_id': {
        'ng': 'NIMC',
        'gh': 'NIA Ghana Card',
        'ke': 'Huduma Namba',
        'za': 'DHA Smart ID',
        'in': 'Aadhaar',
        'pk': 'CNIC NADRA',
    },
}

# Reject Wikimedia file titles that match these patterns
_BAD_TERMS_RE = re.compile(
    r'(?i)\b(truck|lorry|bus|tram|train|tank\b|car\b|vehicle|construction|'
    r'building|map|flag|coat.of.arms|landscape|soldiers?|military|army|navy|'
    r'police\b|monument|statue|museum|postage.stamp|stamp|advertising|'
    r'billboard|diploma|warrant|arrest|court|protest|market|stadium|'
    r'school|hospital|church|mosque|bird|animal|plant|flower|tree|'
    r'coin|disc\b|disk\b|token|medal|numismatic|currency|badge|artifact|'
    r'penny|shilling|naira|obverse|reverse|'
    r'war.department|intelligence.agency|adjutant|conscription|ration.book|'
    r'draft.card|selective.service)\b'
)
_OLD_YEAR_RE = re.compile(r'\b(1[89][0-7]\d)\b')   # years 1800-1979

VALID_EXTS = {'.jpg', '.jpeg', '.png', '.webp'}


# ── Public API ────────────────────────────────────────────────────────────────

def ensure_refs(country, doc_type: str) -> dict:
    """
    Ensure reference images exist for country + doc_type.
    Fetches from Wikimedia if not enough are cached.

    country: str code ('ng') or dict {'code2': 'ng', 'name': 'Nigeria'}
    doc_type: 'passport' | 'national_id' | 'drivers_license' | 'residence_permit'

    Returns:
        {
            'files':   [Path, ...],
            'fetched': int,
            'source':  'cache'|'wikimedia'|'none',
            'country': str,
            'doc_type': str,
        }
    """
    code = _code(country)
    name = _name(country)

    existing = _list_refs(code, doc_type)
    if len(existing) >= MIN_REFS:
        return {'files': existing, 'fetched': 0, 'source': 'cache',
                'country': code, 'doc_type': doc_type}

    needed  = MAX_SAMPLES - len(existing)
    fetched = _fetch_wikimedia(name, doc_type, code, needed)

    all_refs = _list_refs(code, doc_type)
    source   = 'wikimedia' if fetched > 0 else ('cache' if existing else 'none')

    return {'files': all_refs, 'fetched': fetched, 'source': source,
            'country': code, 'doc_type': doc_type}


def ref_count(country, doc_type: str) -> int:
    return len(_list_refs(_code(country), doc_type))


# ── Internal ──────────────────────────────────────────────────────────────────

def _code(country) -> str:
    if isinstance(country, dict):
        return (country.get('code2') or country.get('code') or 'xx').lower()
    return str(country).lower()


def _name(country) -> str:
    if isinstance(country, dict):
        return country.get('name') or country.get('label') or _code(country).upper()
    return str(country).title()


def _list_refs(code: str, doc_type: str) -> list:
    found = []

    # Primary: production/references/{alpha2}/{doc_type}/
    d = REFS_ROOT / code / doc_type
    if d.exists():
        found.extend(f for f in d.iterdir() if f.suffix.lower() in VALID_EXTS)

    # Secondary: id_alpha/{alpha3}/{doc_type}/  (pre-loaded reference library)
    alpha3 = _A2_TO_A3.get(code.lower(), '')
    if alpha3:
        d2 = REFS_ALPHA_ROOT / alpha3 / doc_type
        if d2.exists():
            existing_names = {f.name for f in found}
            for f in d2.iterdir():
                if f.suffix.lower() in VALID_EXTS and f.name not in existing_names:
                    found.append(f)

    return sorted(found)


def _is_bad_filename(title: str) -> bool:
    """Return True if the Wikimedia file title is obviously off-topic."""
    if _BAD_TERMS_RE.search(title):
        return True
    if _OLD_YEAR_RE.search(title):
        return True
    return False


def _fetch_wikimedia(country_name: str, doc_type: str, code: str, limit: int) -> int:
    dest = REFS_ROOT / code / doc_type
    dest.mkdir(parents=True, exist_ok=True)

    file_titles = []

    # ── Stage 1: category-based search (most reliable) ────────────────────────
    for pattern in CATEGORY_PATTERNS.get(doc_type, []):
        cat = pattern.format(country=country_name)
        titles = _category_members(cat, limit * 4)
        titles = [t for t in titles if not _is_bad_filename(t)]
        if titles:
            print(f'  [FETCH] Category "{cat}" -> {len(titles)} files')
            file_titles.extend(titles)
        if len(file_titles) >= limit * 2:
            break

    # Text search is intentionally disabled — it returns unrelated landscape images
    # that pass aspect-ratio filters but are not document scans. Category-based
    # search is the only reliable source. Countries without a Wikimedia category
    # for this doc type will return no_refs and the system degrades gracefully.

    # Deduplicate
    seen = set()
    unique = []
    for t in file_titles:
        if t not in seen:
            seen.add(t)
            unique.append(t)
    file_titles = unique

    if not file_titles:
        print(f'  [FETCH] No candidates for {country_name} / {doc_type}')
        return 0

    print(f'  [FETCH] {len(file_titles)} candidate titles, resolving dimensions...')

    # ── Stage 3: resolve URLs + dimension / aspect ratio filter ───────────────
    urls = _resolve_urls(file_titles, doc_type)
    print(f'  [FETCH] {len(urls)} pass dimension + aspect filter')

    if not urls:
        print(f'  [FETCH] All images failed quality filter for {country_name} / {doc_type}')
        return 0

    # ── Stage 4: download + post-download PIL validation ──────────────────────
    saved = 0
    for url, title in urls:
        if saved >= limit:
            break
        try:
            ext = Path(url.split('?')[0]).suffix.lower()
            if ext not in VALID_EXTS:
                ext = '.jpg'
            slug = hashlib.md5(title.encode()).hexdigest()[:14]
            path = dest / f'wm_{slug}{ext}'

            if path.exists():
                ok, reason = _validate_image(path, doc_type)
                if ok:
                    saved += 1
                else:
                    print(f'  [FETCH] removing stale {path.name}: {reason}')
                    path.unlink(missing_ok=True)
                continue

            resp = _get(url, headers=HEADERS, timeout=25)
            if resp.status_code != 200:
                continue
            content = resp.content
            if not (MIN_SIZE <= len(content) <= MAX_SIZE):
                continue

            path.write_bytes(content)

            ok, reason = _validate_image(path, doc_type)
            if ok:
                kb = len(content) // 1024
                print(f'  [FETCH] saved {path.name}  ({kb} KB)')
                saved += 1
            else:
                print(f'  [FETCH] rejected {path.name}: {reason}')
                path.unlink(missing_ok=True)

            time.sleep(0.3)
        except Exception as exc:
            print(f'  [FETCH] error: {exc}')

    return saved


def _validate_image(path: Path, doc_type: str) -> tuple:
    """PIL checks: aspect ratio, minimum dimensions, and colorfulness."""
    try:
        from PIL import Image
        import numpy as np
        with Image.open(path) as img:
            w, h = img.size
            rgb = img.convert('RGB')

        if w < MIN_WIDTH or h < MIN_HEIGHT:
            return False, f'too small {w}x{h}'

        aspect = w / h if h else 0
        lo, hi = DOC_ASPECT_RANGE.get(doc_type, (0.3, 3.0))
        if not (lo <= aspect <= hi):
            return False, f'aspect {aspect:.2f} outside [{lo:.2f},{hi:.2f}]'

        # Reject true grayscale images (BW scans)
        arr = np.array(rgb, dtype=float)
        rg = np.mean(np.abs(arr[:, :, 0] - arr[:, :, 1]))
        rb = np.mean(np.abs(arr[:, :, 0] - arr[:, :, 2]))
        gb = np.mean(np.abs(arr[:, :, 1] - arr[:, :, 2]))
        color_spread = (rg + rb + gb) / 3.0
        if color_spread < 5.0:
            return False, f'grayscale (color_spread={color_spread:.1f})'

        # Reject warm-tone / sepia historical docs.
        # Sepia and aged-paper cards have red as the dominant channel.
        # Threshold lowered to 0.50 to also catch pale-beige WWII-era cards.
        arr_f = arr / 255.0
        r_dom = (arr_f[:, :, 0] > arr_f[:, :, 1] + 0.05) & \
                (arr_f[:, :, 0] > arr_f[:, :, 2] + 0.05)
        warm_frac = float(r_dom.mean())
        if warm_frac > 0.50:
            return False, f'sepia/warm-tone ({warm_frac:.0%} red-dominant pixels)'

        # Require blue or green regions somewhere in the image.
        # Modern ID cards always have blue/green design elements (security features,
        # background colours, text). WWII beige/cream cards are uniformly warm-neutral
        # with no pixel areas where blue or green clearly dominates red.
        r_ch, g_ch, b_ch = arr_f[:, :, 0], arr_f[:, :, 1], arr_f[:, :, 2]
        # A pixel is "cool" if blue or green is clearly above 0.30 and exceeds red
        blue_px  = (b_ch > 0.30) & (b_ch > r_ch + 0.04)
        green_px = (g_ch > 0.35) & (g_ch > r_ch + 0.06)
        cool_frac = float((blue_px | green_px).mean())
        if cool_frac < 0.02:
            return False, f'no blue/green region ({cool_frac:.1%} cool pixels)'

        return True, ''
    except Exception as exc:
        return False, str(exc)


def _category_members(category: str, limit: int) -> list:
    try:
        r = _get(WM_API, params={
            'action':  'query',
            'list':    'categorymembers',
            'cmtitle': f'Category:{category}',
            'cmtype':  'file',
            'cmlimit': min(limit, 50),
            'format':  'json',
        }, headers=HEADERS, timeout=12)
        return [m['title'] for m in r.json().get('query', {}).get('categorymembers', [])]
    except Exception:
        return []


def _text_search(query: str, limit: int) -> list:
    """Namespace-6 (File:) fulltext search on Wikimedia Commons."""
    try:
        r = _get(WM_API, params={
            'action':       'query',
            'generator':    'search',
            'gsrsearch':    f'filetype:bitmap {query}',
            'gsrnamespace': 6,
            'gsrlimit':     min(limit, 20),
            'prop':         'info',
            'format':       'json',
        }, headers=HEADERS, timeout=12)
        pages = r.json().get('query', {}).get('pages', {})
        return [p['title'] for p in pages.values() if 'title' in p]
    except Exception:
        return []


def _resolve_urls(titles: list, doc_type: str) -> list:
    """
    Batch-resolve File: titles to direct download URLs.
    Pre-filters by mime, file size, original pixel dimensions, and aspect ratio.
    """
    lo, hi = DOC_ASPECT_RANGE.get(doc_type, (0.3, 3.0))
    results = []

    for i in range(0, len(titles), 20):
        chunk = titles[i:i + 20]
        try:
            r = _get(WM_API, params={
                'action':     'query',
                'titles':     '|'.join(chunk),
                'prop':       'imageinfo',
                'iiprop':     'url|mime|size|dimensions',
                'iiurlwidth': 1100,
                'format':     'json',
            }, headers=HEADERS, timeout=15)
            pages = r.json().get('query', {}).get('pages', {})
            for page in pages.values():
                info = (page.get('imageinfo') or [{}])[0]
                url  = info.get('thumburl') or info.get('url', '')
                mime = info.get('mime', '')
                size = info.get('size', 0)     # original file bytes
                w    = info.get('width',  0)   # original pixel width
                h    = info.get('height', 0)   # original pixel height

                if not url or 'image' not in mime:
                    continue
                if not (MIN_SIZE <= size <= MAX_SIZE):
                    continue
                if w < MIN_WIDTH or h < MIN_HEIGHT:
                    continue
                aspect = (w / h) if h else 0
                if not (lo <= aspect <= hi):
                    continue
                results.append((url, page.get('title', '')))
        except Exception as exc:
            print(f'  [FETCH] resolve batch error: {exc}')

    return results
