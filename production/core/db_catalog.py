"""
Shared PEP / Sanctions / Adverse-Media database catalog.

Single source of truth for both:
  - Per-search "databases checked" breakdown (pep_screen.py, kyb_screen.py)
  - The admin "Databases" registry page (GET /api/v1/admin/databases-catalog,
    consumed by development/admin/databases.js)

Every screen actually runs through one aggregated call to the OpenSanctions
Match API (see pep_screen.py / kyb_screen.py) — these named entries document
the underlying sources folded into that aggregation, so an admin can see
which specific list a given search actually hit, not a blanket "checked".

dataset_id is the real OpenSanctions per-entity dataset id where confirmed
(seen firsthand in live match responses — see the confirmed set below) or
best-effort per OpenSanctions' naming convention otherwise. Entries not
confirmed will simply read CLEAR until verified against a live hit — flagged
per-entry below. Fix-later item: replace with a live-fetched catalog (see
development/db/DATABASES.md).

`category` ("pep" / "sanctions" / "adverse_media") lets the admin frontend
group a flat databases_checked array back into the same three tabs the
Databases registry page uses — see mountDbCategoryTabs() in admin.js.

Confirmed live (seen in an actual OpenSanctions match response):
us_ofac_sdn, us_trade_csl, eu_fsf, ch_seco_sanctions, ca_dfatd_sema_sanctions,
au_dfat_sanctions, jp_mof_sanctions, fr_tresor_gels_avoir, nz_russia_sanctions,
us_cia_world_leaders, wikidata, wd_curated, wd_categories, gb_coh_disqualified,
us_sam_exclusions, gb_fcdo_sanctions
"""

from __future__ import annotations

_ADDED = "2026-07-11"  # date this catalog shipped in our app

PEP_DATABASES = [
    {"name": "Global PEP Register & Politicians Database", "agency": "OpenSanctions PEP",      "region": "Global",         "dataset_id": "peps",               "category": "pep", "added": _ADDED},  # special-cased: role.pep topic, not a single dataset
    {"name": "CIA World Leaders List",                     "agency": "CIA",                    "region": "Global",         "dataset_id": "us_cia_world_leaders", "category": "pep", "added": _ADDED},  # confirmed
    {"name": "EveryPolitician",                            "agency": "EveryPolitician",         "region": "Global",         "dataset_id": "everypolitician",     "category": "pep", "added": _ADDED},
    {"name": "European Parliament Members",                "agency": "European Union",          "region": "Europe",         "dataset_id": "eu_meps",             "category": "pep", "added": _ADDED},
    {"name": "Council of Europe PACE",                     "agency": "Council of Europe",       "region": "Europe",         "dataset_id": "coe_pace",            "category": "pep", "added": _ADDED},
    {"name": "UK Parliament Members",                      "agency": "UK Government",           "region": "United Kingdom", "dataset_id": "gb_parliament",       "category": "pep", "added": _ADDED},
    {"name": "US Congress Members",                        "agency": "US Congress.gov",         "region": "United States",  "dataset_id": "us_congress",         "category": "pep", "added": _ADDED},
    {"name": "Wikidata Political Positions",                "agency": "Wikidata",                "region": "Global",         "dataset_id": "wikidata",            "category": "pep", "added": _ADDED},  # confirmed
    {"name": "Rulers.org World Leaders Archive",            "agency": "Rulers.org",              "region": "Global",         "dataset_id": "rulers",              "category": "pep", "added": _ADDED},
    {"name": "National Governments Database",               "agency": "OpenSanctions",           "region": "Global",         "dataset_id": "wd_curated",          "category": "pep", "added": _ADDED},  # confirmed
]

SANCTIONS_DATABASES = [
    {"name": "US OFAC SDN List",                    "agency": "US Dept. of the Treasury (OFAC)", "region": "United States", "dataset_id": "us_ofac_sdn",         "category": "sanctions", "added": _ADDED},  # confirmed
    {"name": "US Trade Consolidated Screening List", "agency": "US Dept. of Commerce",            "region": "United States", "dataset_id": "us_trade_csl",        "category": "sanctions", "added": _ADDED},  # confirmed
    {"name": "EU Financial Sanctions Files (FSF)",   "agency": "European Union",                  "region": "Europe",        "dataset_id": "eu_fsf",              "category": "sanctions", "added": _ADDED},  # confirmed
    {"name": "UK Sanctions List",                    "agency": "UK Government (FCDO)",            "region": "United Kingdom", "dataset_id": "gb_fcdo_sanctions",  "category": "sanctions", "added": _ADDED},  # confirmed; replaces the retired OFSI Consolidated List (retired 2026-01-28)
    {"name": "UN Security Council Consolidated List", "agency": "United Nations",                 "region": "Global",        "dataset_id": "un_sc_sanctions",     "category": "sanctions", "added": _ADDED},
    {"name": "Switzerland SECO Sanctions List",       "agency": "Swiss SECO",                      "region": "Switzerland",   "dataset_id": "ch_seco_sanctions",   "category": "sanctions", "added": _ADDED},  # confirmed
    {"name": "Canada Consolidated Sanctions (SEMA)",  "agency": "Global Affairs Canada",           "region": "Canada",        "dataset_id": "ca_dfatd_sema_sanctions", "category": "sanctions", "added": _ADDED},  # confirmed
    {"name": "Australia DFAT Sanctions List",         "agency": "Australian Government (DFAT)",    "region": "Australia",     "dataset_id": "au_dfat_sanctions",   "category": "sanctions", "added": _ADDED},  # confirmed
    {"name": "Japan MOF Sanctions List",              "agency": "Japan Ministry of Finance",       "region": "Japan",         "dataset_id": "jp_mof_sanctions",    "category": "sanctions", "added": _ADDED},  # confirmed
    {"name": "France Gels des Avoirs",                "agency": "Direction Générale du Trésor",    "region": "France",        "dataset_id": "fr_tresor_gels_avoir", "category": "sanctions", "added": _ADDED},  # confirmed
    {"name": "New Zealand Russia Sanctions List",     "agency": "New Zealand Government",          "region": "New Zealand",   "dataset_id": "nz_russia_sanctions", "category": "sanctions", "added": _ADDED},  # confirmed
]

ADVERSE_MEDIA_DATABASES = [
    {"name": "ICIJ Offshore Leaks Database",            "agency": "Intl. Consortium of Investigative Journalists", "region": "Global",         "dataset_id": "icij_offshoreleaks", "category": "adverse_media", "added": _ADDED},
    {"name": "OCCRP Aleph Investigative Data",           "agency": "Organized Crime & Corruption Reporting Project", "region": "Global",        "dataset_id": "occrp",              "category": "adverse_media", "added": _ADDED},
    {"name": "Interpol Red Notices",                     "agency": "Interpol",                                       "region": "Global",        "dataset_id": "interpol_red_notices", "category": "adverse_media", "added": _ADDED},
    {"name": "UK Companies House Disqualified Officers", "agency": "UK Government (Companies House)",                "region": "United Kingdom", "dataset_id": "gb_coh_disqualified", "category": "adverse_media", "added": _ADDED},  # confirmed
    {"name": "US SAM.gov Exclusions List",               "agency": "US General Services Administration",             "region": "United States",  "dataset_id": "us_sam_exclusions",   "category": "adverse_media", "added": _ADDED},  # confirmed
    {"name": "World Bank Debarred Firms & Individuals",  "agency": "World Bank Group",                               "region": "Global",         "dataset_id": "wb_debarred",         "category": "adverse_media", "added": _ADDED},
    {"name": "Wikidata Curated Adverse Media Flags",     "agency": "Wikidata",                                       "region": "Global",         "dataset_id": "wd_categories",       "category": "adverse_media", "added": _ADDED},  # confirmed
    {"name": "Press-Sourced Sanctions Announcements",    "agency": "OpenSanctions (press monitoring)",               "region": "Global",         "dataset_id": "adverse_media_other", "category": "adverse_media", "added": _ADDED},  # special-cased fallback, see kyb_screen.py
]

# OpenSanctions topic codes that mean an entity is actually
# compliance-relevant (sanctioned, PEP, wanted, debarred, etc.), mapped to
# a plain-language reason. A match can carry an empty topics list and still
# score high — e.g. a same-name entry in a general corporate/ownership
# reference dataset (seen live: "Amazon Web Services" scored 80-100%
# against gem_energy_ownership, Global Energy Monitor's power-plant
# ownership mapping, with zero topics) — that's a coincidental name match,
# not a risk signal, and must not by itself flag POTENTIAL_MATCH. Order
# here is the priority order used when composing a summary sentence.
RISK_TOPIC_LABELS = {
    "sanction":         "on a sanctions list",
    "sanction.linked":  "linked to a sanctioned entity",
    "sanction.counter": "subject to counter-sanctions",
    "role.pep":         "a Politically Exposed Person",
    "role.rca":         "a close associate of a PEP",
    "role.pol":         "a political office holder",
    "poi":              "a person/entity of interest",
    "wanted":           "wanted by law enforcement",
    "debarment":        "debarred from public contracts",
    "export.control":   "subject to export controls",
    "corp.disqual":     "a disqualified company director",
    "asset.freeze":     "subject to an asset freeze",
}
