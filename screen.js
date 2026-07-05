const resultWrap  = document.getElementById('result-wrap');
const searchBtn   = document.getElementById('search-btn');
const errorBox    = document.getElementById('search-error');

function renderScreenResult(p) {
  const bannerClass = p.risk_classification === 'CLEAN' ? 'clean'
    : p.risk_classification === 'POTENTIAL_MATCH' ? 'warn' : 'unavail';

  const dbGrid = (p.databases_checked || []).map(d => `
    <div class="db-checked-item"><span>${escapeHtml(d.name)}</span><span class="badge green">${escapeHtml(d.status)}</span></div>
  `).join('');

  const matches = (p.matches || []).map(m => `
    <div class="field-card">
      <div class="label">${escapeHtml((m.datasets || []).join(', ') || 'match')}</div>
      <div class="value">${escapeHtml(m.name)} — ${fmtPct(m.score)}</div>
    </div>
  `).join('');

  resultWrap.innerHTML = `
    <div class="admin-panel">
      <h3>Result</h3>
      <div class="field-grid">
        <div class="field-card"><div class="label">Subject name</div><div class="value">${escapeHtml(p.subject_name || '—')}</div></div>
        <div class="field-card"><div class="label">Risk classification</div><div class="value"><span class="badge ${bannerClass === 'clean' ? 'green' : bannerClass === 'warn' ? 'amber' : 'gray'}">${escapeHtml(p.risk_classification)}</span></div></div>
      </div>
      <div class="pep-banner ${bannerClass}">
        ${escapeHtml(p.banner)}<br>
        <span style="font-weight:400;font-size:0.85rem;opacity:0.85">${fmtPct(p.match_confidence)} match confidence</span>
      </div>
      ${p.error ? `<div class="admin-note" style="margin-top:0;background:rgba(255,85,117,0.08);border-color:rgba(255,85,117,0.3);color:#ff5575">${escapeHtml(p.error)}</div>` : ''}
    </div>

    ${matches ? `<div class="admin-panel"><h3>Matches</h3><div class="field-grid">${matches}</div></div>` : ''}

    <div class="admin-panel">
      <h3>Databases checked</h3>
      <div class="db-checked-grid">${dbGrid}</div>
    </div>
  `;
}

async function runScreen() {
  const given_names = document.getElementById('s-given-names').value.trim();
  const surname      = document.getElementById('s-surname').value.trim();
  const date_of_birth = document.getElementById('s-dob').value || null;
  const nationalityRaw = document.getElementById('s-nationality').value.trim();
  // Only a resolved 2-letter code is valid for the audit-log FK — a
  // half-typed country name the admin never picked from the dropdown is
  // still fine to drop, the screen itself doesn't require it.
  const nationality   = /^[A-Za-z]{2}$/.test(nationalityRaw) ? nationalityRaw.toUpperCase() : null;
  const searched_by   = document.getElementById('s-searched-by').value.trim() || null;

  errorBox.style.display = 'none';
  if (!given_names && !surname) {
    errorBox.textContent = 'Enter at least a first name or surname.';
    errorBox.style.display = '';
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = 'Screening…';
  resultWrap.innerHTML = `<div class="admin-panel">${'<div class="field-grid">' + Array.from({ length: 2 }, () => `
    <div class="field-card skel-field-card"><div class="skel skel-label"></div><div class="skel skel-text"></div></div>
  `).join('') + '</div>'}</div>`;

  try {
    const resp = await adminFetch('/screen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ given_names, surname, date_of_birth, nationality, searched_by }),
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

attachCountryAutocomplete(document.getElementById('s-nationality'));

searchBtn.addEventListener('click', runScreen);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});
