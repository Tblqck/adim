// Shared helpers for the admin dashboard — plain fetch/DOM, no framework,
// same convention as production/web/scripts/liveness.js.

const ADMIN_API = '/api/v1/admin';

async function adminFetch(path, opts = {}) {
  const resp = await fetch(ADMIN_API + path, { credentials: 'same-origin', ...opts });
  if (resp.status === 401) {
    if (!location.pathname.endsWith('/admin/login')) {
      location.href = 'login';
    }
    throw new Error('not authenticated');
  }
  return resp;
}

// ── Firm filter (super-admin only) ──────────────────────────────────────────
// A firm-scoped login is already confined server-side and never sees this —
// there's nothing to pick. A super-admin login can see everything by
// default, with this dropdown to narrow to one firm. `kyc_super_admin` is
// set in sessionStorage by login.html right after a successful login.

async function renderFirmFilter(containerId, onChange) {
  if (sessionStorage.getItem('kyc_super_admin') !== '1') return;

  let firms = [];
  try {
    const resp = await adminFetch('/firms');
    if (!resp.ok) return;
    firms = (await resp.json()).items || [];
  } catch (_) {
    return;
  }
  if (!firms.length) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  const wrap = document.createElement('div');
  wrap.className = 'field-card';
  wrap.style.marginBottom = '16px';
  wrap.innerHTML = `
    <div class="label">Firm</div>
    <select id="firm-filter-select" class="edit-input">
      <option value="">All firms</option>
      ${firms.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}
    </select>
  `;
  container.prepend(wrap);
  wrap.querySelector('select').addEventListener('change', (e) => onChange(e.target.value || null));
}

function verdictBadgeClass(verified, verdict) {
  if (verified === true) return 'green';
  if (verified === false) return 'red';
  const v = (verdict || '').toLowerCase();
  if (v.includes('weak') || v.includes('warn')) return 'amber';
  return 'gray';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch (_) {
    return iso;
  }
}

function fmtPct(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

// ── OpenSanctions topic/country label translation ──────────────────────────
// Raw API output is jargon (topic codes, ISO country codes, dataset IDs)
// aimed at compliance software, not the person reading the admin dashboard.
// These turn that into plain language for the PEP/KYB result cards.

const TOPIC_LABELS = {
  'sanction':         'Sanctioned',
  'sanction.linked':  'Linked to a Sanctioned Entity',
  'sanction.counter': 'Counter-Sanctioned',
  'role.pep':         'Politically Exposed Person',
  'role.rca':         'Close Associate of a PEP',
  'role.pol':         'Political Office Holder',
  'role.oligarch':    'Oligarch',
  'poi':              'Adverse Media',
  'debarment':        'Debarred From Public Contracts',
  'corp.disqual':     'Disqualified Company Director',
  'corp.public':      'Publicly Listed Company',
  'gov.soe':          'State-Owned Enterprise',
  'fin.bank':         'Bank / Financial Institution',
  'crime':            'Criminal Association',
  'crime.boss':       'Organized Crime',
  'crime.fin':        'Financial Crime',
  'crime.fraud':      'Fraud',
  'crime.terror':     'Terrorism',
  'crime.theft':      'Theft',
  'crime.traffick':   'Trafficking',
  'crime.war':        'War Crimes',
  'export.control':   'Export-Controlled',
  'export.risk':      'Export Control Risk',
  'reg.action':       'Regulatory Action Taken',
  'reg.warn':         'Regulatory Warning',
  'wanted':           'Wanted by Law Enforcement',
  'asset.frozen':     'Assets Frozen',
};

function humanizeTopic(code) {
  if (TOPIC_LABELS[code]) return TOPIC_LABELS[code];
  // Unknown code — fall back to a readable guess rather than showing raw dots/underscores.
  return code.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function countryLabel(code2) {
  if (!code2) return null;
  const c = (window.COUNTRIES || []).find(c => c.code2.toLowerCase() === code2.toLowerCase());
  const flag = window.countryFlag ? window.countryFlag(code2) : '';
  return c ? `${flag} ${c.name}` : code2.toUpperCase();
}

// Shared PEP/KYB match profile card — factFields is an array of
// {label, value} pairs the caller precomputes (person vs company have
// different relevant facts); falsy values are dropped automatically.
function renderMatchCard(m, factFields) {
  const badges = (m.topics || []).map(t =>
    `<span class="badge blue">${escapeHtml(humanizeTopic(t))}</span>`
  ).join('');

  const facts = factFields.filter(f => f.value).map(f => `
    <div class="field-card"><div class="label">${escapeHtml(f.label)}</div><div class="value">${escapeHtml(f.value)}</div></div>
  `).join('');

  const sourceUrls = m.source_urls || [];
  const links = sourceUrls.map((u, i) =>
    `<a class="admin-btn" href="${escapeHtml(u)}" target="_blank" rel="noopener">Verify source${sourceUrls.length > 1 ? ' ' + (i + 1) : ''}</a>`
  );
  if (m.wikipedia_url) {
    links.push(`<a class="admin-btn" href="${escapeHtml(m.wikipedia_url)}" target="_blank" rel="noopener">Wikipedia</a>`);
  }

  return `
    <div class="match-card">
      <div class="match-header">
        <div class="match-name">${escapeHtml(m.name)}</div>
        <div class="match-score">${fmtPct(m.score)} match</div>
      </div>
      <div class="match-badges">${badges}</div>
      ${facts ? `<div class="field-grid" style="margin-top:0">${facts}</div>` : ''}
      ${m.notes ? `<div class="match-notes" style="margin-top:12px">${escapeHtml(m.notes)}</div>` : ''}
      ${links.length ? `<div class="match-links">${links.join('')}</div>` : ''}
      <details class="match-raw">
        <summary>Technical details — ${(m.datasets || []).length} source lists</summary>
        <div class="match-raw-body">
          <strong>Source lists:</strong> ${escapeHtml((m.datasets || []).join(', ') || '—')}<br>
          <strong>Topic codes:</strong> ${escapeHtml((m.topics || []).join(', ') || '—')}
          ${(m.program_ids || []).length ? `<br><strong>Sanctions program codes:</strong> ${escapeHtml(m.program_ids.join(', '))}` : ''}
        </div>
      </details>
    </div>
  `;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Databases-checked category tabs ─────────────────────────────────────────
// Shared by screen.js/kyb.js (per-search results, showStatus: true) and
// databases.js could use it too, but that page also needs a search box so it
// keeps its own renderer — this one groups a flat databases_checked array
// (each entry carrying `category` from production/core/db_catalog.py) back
// into the same three PEP/Sanctions/Adverse-Media tabs the Databases
// registry page shows, so a search result and the registry page always look
// like the same view of the same data.

const DB_CATEGORY_LABELS = {
  pep:           'Politically Exposed Persons (PEP)',
  sanctions:     'Global Sanctions',
  adverse_media: 'Adverse Media',
};
const DB_CATEGORY_ORDER = ['pep', 'sanctions', 'adverse_media'];

function renderDbCard(d, showStatus) {
  const statusClass = d.status === 'HIT' ? 'red' : d.status === 'UNAVAILABLE' ? 'gray' : 'green';
  return `
    <div class="db-registry-card">
      <div class="db-registry-card-head">
        <h4>${escapeHtml(d.name)}</h4>
        ${showStatus ? `<span class="badge ${statusClass}">${escapeHtml(d.status)}</span>` : ''}
      </div>
      <div class="agency">🔗 Agency: ${escapeHtml(d.agency)}</div>
      <div class="db-registry-pill">🌐 ${escapeHtml(d.region)}</div>
      <div class="db-registry-pill">📅 Added to App: ${escapeHtml(d.added)}</div>
    </div>
  `;
}

// containerEl gets fully owned/re-rendered by this function on every tab
// click — call once after inserting containerEl into the DOM.
function mountDbCategoryTabs(containerEl, databases, { showStatus = false } = {}) {
  const grouped = {};
  (databases || []).forEach(d => (grouped[d.category] = grouped[d.category] || []).push(d));
  const cats = DB_CATEGORY_ORDER.filter(c => (grouped[c] || []).length);
  if (!cats.length) { containerEl.innerHTML = '<div class="admin-empty">No databases to show.</div>'; return; }

  let active = cats[0];

  function render() {
    const tabsHtml = cats.map(cat => {
      const items = grouped[cat];
      const hits  = showStatus ? items.filter(d => d.status === 'HIT').length : null;
      const label = showStatus ? `${hits}/${items.length} hit` : `${items.length} DBs`;
      return `
        <button class="db-registry-tab ${cat === active ? 'active' : ''}" data-cat="${cat}">
          ${escapeHtml(DB_CATEGORY_LABELS[cat])} <span class="count ${showStatus && hits > 0 ? 'hit' : ''}">${label}</span>
        </button>
      `;
    }).join('');

    containerEl.innerHTML = `
      <div class="db-registry-tabs">${tabsHtml}</div>
      <div class="db-registry-grid">${grouped[active].map(d => renderDbCard(d, showStatus)).join('')}</div>
    `;

    containerEl.querySelectorAll('.db-registry-tab').forEach(btn => {
      btn.addEventListener('click', () => { active = btn.dataset.cat; render(); });
    });
  }

  render();
}

// ── Generic autocomplete dropdown ────────────────────────────────────────
// Attaches a searchable dropdown to a text input. Works for both a static
// list (countries) and an async server query (user/name search) — pass
// fetchItems as either a sync filter or an async function.
//
//   attachAutocomplete(input, {
//     fetchItems: (query) => Item[] | Promise<Item[]>,
//     renderItem: (item, query) => htmlString,
//     onSelect:   (item, input) => void,
//     minChars:   1,      // don't query below this length
//     debounceMs: 150,    // only matters for async fetchItems
//   });

function attachAutocomplete(input, opts) {
  const {
    fetchItems,
    renderItem,
    onSelect,
    minChars = 1,
    debounceMs = 150,
  } = opts;

  let wrap = input.closest('.ac-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
  }

  const list = document.createElement('ul');
  list.className = 'ac-list';
  wrap.appendChild(list);

  let items = [];
  let activeIdx = -1;
  let debounceTimer = null;
  let requestId = 0;

  function open()  { list.classList.add('is-open'); }
  function close() { list.classList.remove('is-open'); activeIdx = -1; }

  function render(query) {
    if (!items.length) {
      list.innerHTML = '<li class="ac-empty">No matches</li>';
      return;
    }
    list.innerHTML = items.map((item, i) =>
      `<li class="ac-item" data-idx="${i}">${renderItem(item, query)}</li>`
    ).join('');
  }

  function updateActive() {
    [...list.children].forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  }

  async function runQuery(query) {
    const myRequest = ++requestId;
    const result = await fetchItems(query);
    if (myRequest !== requestId) return; // stale response, a newer query superseded it
    items = result || [];
    activeIdx = -1;
    render(query);
    open();
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (q.length < minChars) { close(); return; }
    debounceTimer = setTimeout(() => runQuery(q), debounceMs);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q.length >= minChars) runQuery(q);
  });

  input.addEventListener('blur', () => setTimeout(close, 180));

  input.addEventListener('keydown', (e) => {
    if (!list.classList.contains('is-open')) return;
    const n = items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(n - 1, activeIdx + 1); updateActive(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); updateActive(); }
    if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      onSelect(items[activeIdx], input);
      close();
    }
    if (e.key === 'Escape') close();
  });

  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.ac-item');
    if (!li) return;
    e.preventDefault();
    onSelect(items[Number(li.dataset.idx)], input);
    close();
  });
}

// ── Country autocomplete (reuses window.COUNTRIES from /scripts/countries.js) ──
// Keeps the input's visible value as the plain 2-letter code (backward
// compatible with existing filter/query logic that reads input.value
// directly), while data-country-name carries the full name for display.

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx))
    + '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>'
    + escapeHtml(text.slice(idx + query.length));
}

function attachCountryAutocomplete(input) {
  const countries = window.COUNTRIES || [];
  const flag = window.countryFlag || (() => '');

  function filterCountries(q) {
    if (!q) return countries.slice(0, 50);
    const lq = q.toLowerCase();
    return countries.filter(c =>
      c.name.toLowerCase().includes(lq) || c.code2.toLowerCase() === lq || c.code3.toLowerCase().includes(lq)
    ).slice(0, 50);
  }

  attachAutocomplete(input, {
    minChars: 0,
    fetchItems: (q) => filterCountries(q),
    renderItem: (c, q) =>
      `<span class="ac-item-flag">${flag(c.code2)}</span>` +
      `<span class="ac-item-main">${highlightMatch(c.name, q)}</span>` +
      `<span class="ac-item-sub">${escapeHtml(c.code2)}</span>`,
    onSelect: (c, el) => {
      el.value = c.code2;
      el.dataset.countryName = c.name;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
  });
}
