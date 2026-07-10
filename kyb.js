const resultWrap  = document.getElementById('result-wrap');
const searchBtn   = document.getElementById('search-btn');
const errorBox    = document.getElementById('search-error');
let   selectedFirmId = null;

function renderScreenResult(p) {
  const bannerClass = p.risk_classification === 'CLEAN' ? 'clean'
    : p.risk_classification === 'POTENTIAL_MATCH' ? 'warn' : 'unavail';

  const dbGrid = (p.databases_checked || []).map(d => `
    <div class="db-checked-item"><span>${escapeHtml(d.name)}</span><span class="badge green">${escapeHtml(d.status)}</span></div>
  `).join('');

  const matches = (p.matches || []).map(m => renderMatchCard(m, [
    { label: 'Jurisdiction',         value: countryLabel(m.jurisdiction || m.country) },
    { label: 'Entity type',          value: m.entity_type },
    { label: 'Status',               value: m.status },
    { label: 'Registration number',  value: m.registration_number },
    { label: 'Incorporated',         value: m.incorporation_date },
    { label: 'Website',              value: m.website },
    { label: 'Address',              value: m.address },
  ])).join('');

  resultWrap.innerHTML = `
    <div class="admin-panel">
      <h3>Result</h3>
      <div class="field-grid">
        <div class="field-card"><div class="label">Subject company</div><div class="value">${escapeHtml(p.subject_name || '—')}</div></div>
        <div class="field-card"><div class="label">Risk classification</div><div class="value"><span class="badge ${bannerClass === 'clean' ? 'green' : bannerClass === 'warn' ? 'amber' : 'gray'}">${escapeHtml(p.risk_classification)}</span></div></div>
      </div>
      <div class="pep-banner ${bannerClass}">
        ${escapeHtml(p.banner)}<br>
        <span style="font-weight:400;font-size:0.85rem;opacity:0.85">${fmtPct(p.match_confidence)} match confidence</span>
      </div>
      ${p.error ? `<div class="admin-note" style="margin-top:0;background:rgba(255,85,117,0.08);border-color:rgba(255,85,117,0.3);color:#ff5575">${escapeHtml(p.error)}</div>` : ''}
    </div>

    ${matches ? `<div class="admin-panel"><h3>Matches</h3>${matches}</div>` : ''}

    <div class="admin-panel">
      <h3>Databases checked</h3>
      <div class="db-checked-grid">${dbGrid}</div>
    </div>
  `;
}

async function runScreen() {
  const company_name = document.getElementById('k-company-name').value.trim();
  const jurisdictionRaw = document.getElementById('k-jurisdiction').value.trim();
  // Only a resolved 2-letter code is valid for the audit-log FK — a
  // half-typed country name the admin never picked from the dropdown is
  // still fine to drop, the screen itself doesn't require it.
  const jurisdiction = /^[A-Za-z]{2}$/.test(jurisdictionRaw) ? jurisdictionRaw.toUpperCase() : null;
  const registration_number = document.getElementById('k-registration-number').value.trim() || null;
  const searched_by  = document.getElementById('k-searched-by').value.trim() || null;

  errorBox.style.display = 'none';
  if (!company_name) {
    errorBox.textContent = 'Enter a company name.';
    errorBox.style.display = '';
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = 'Screening…';
  resultWrap.innerHTML = `<div class="admin-panel">${'<div class="field-grid">' + Array.from({ length: 2 }, () => `
    <div class="field-card skel-field-card"><div class="skel skel-label"></div><div class="skel skel-text"></div></div>
  `).join('') + '</div>'}</div>`;

  try {
    const resp = await adminFetch('/screen-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name, jurisdiction, registration_number, searched_by, firm_id: selectedFirmId }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      errorBox.textContent = body.detail || `Screen failed (${resp.status})`;
      errorBox.style.display = '';
      resultWrap.innerHTML = '';
      return;
    }
    const result = await resp.json();
    renderScreenResult(result);
  } catch (_) {
    // adminFetch already redirected to login on 401
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Run screen';
  }
}

attachCountryAutocomplete(document.getElementById('k-jurisdiction'));
renderFirmFilter('firm-filter-slot', (firmId) => { selectedFirmId = firmId; });

searchBtn.addEventListener('click', runScreen);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});
