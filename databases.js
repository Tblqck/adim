// Catalog is fetched from the server (production/core/db_catalog.py via
// GET /databases-catalog) — the same source every PEP/KYB search's
// "Databases checked" panel reads from, so this page and every individual
// search result stay in sync by construction.
const TAB_LABELS = {
  pep:           'Politically Exposed Persons (PEP)',
  sanctions:     'Global Sanctions',
  adverse_media: 'Adverse Media',
};

let catalog  = { pep: [], sanctions: [], adverse_media: [] };
let activeTab = 'pep';
let query = '';

const tabsEl   = document.getElementById('db-tabs');
const gridEl   = document.getElementById('db-grid');
const searchEl = document.getElementById('db-search');

function renderTabs() {
  tabsEl.innerHTML = Object.keys(TAB_LABELS).map(key => `
    <button class="db-registry-tab ${key === activeTab ? 'active' : ''}" data-tab="${key}">
      ${escapeHtml(TAB_LABELS[key])} <span class="count">${catalog[key].length} DBs</span>
    </button>
  `).join('');

  tabsEl.querySelectorAll('.db-registry-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      query = '';
      searchEl.value = '';
      searchEl.placeholder = `Search ${TAB_LABELS[activeTab].toLowerCase()} databases…`;
      renderTabs();
      renderGrid();
    });
  });
}

function renderGrid() {
  const items = catalog[activeTab].filter(d =>
    !query || d.name.toLowerCase().includes(query) || d.agency.toLowerCase().includes(query)
  );

  gridEl.innerHTML = items.length ? items.map(d => `
    <div class="db-registry-card">
      <h4>${escapeHtml(d.name)}</h4>
      <div class="agency">🔗 Agency: ${escapeHtml(d.agency)}</div>
      <div class="db-registry-pill">🌐 ${escapeHtml(d.region)}</div>
      <div class="db-registry-pill">📅 Added to App: ${escapeHtml(d.added)}</div>
    </div>
  `).join('') : `<div class="admin-empty">No databases match "${escapeHtml(query)}".</div>`;
}

searchEl.addEventListener('input', () => {
  query = searchEl.value.trim().toLowerCase();
  renderGrid();
});

async function load() {
  gridEl.innerHTML = `<div class="admin-empty">Loading…</div>`;
  try {
    const resp = await adminFetch('/databases-catalog');
    if (!resp.ok) throw new Error(`catalog fetch failed (${resp.status})`);
    catalog = await resp.json();
  } catch (_) {
    gridEl.innerHTML = `<div class="admin-empty">Could not load the database catalog.</div>`;
    return;
  }
  searchEl.placeholder = `Search ${TAB_LABELS[activeTab].toLowerCase()} databases…`;
  renderTabs();
  renderGrid();
}

renderFirmFilter('firm-filter-slot', () => {});
load();

document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});
