const resultWrap = document.getElementById('result-wrap');
const checkBtn    = document.getElementById('check-btn');
const errorBox    = document.getElementById('check-error');
let   selectedFirmId = null;

function renderDocumentPanel(doc) {
  if (!doc) return '';
  const verdictClass = verdictBadgeClass(null, doc.verdict);
  return `
    <div class="admin-panel">
      <h3>Document Reference Match <span class="badge ${verdictClass}" style="margin-left:8px">${escapeHtml((doc.verdict || 'unknown').replace(/_/g, ' '))}</span></h3>
      ${doc.error ? `<div class="admin-note" style="margin-top:0">${escapeHtml(doc.error)}</div>` : ''}
      <div class="field-grid">
        <div class="field-card"><div class="label">Score</div><div class="value">${fmtPct(doc.score)}</div></div>
        <div class="field-card"><div class="label">References checked</div><div class="value">${doc.refs_checked ?? 0}</div></div>
      </div>
    </div>`;
}

function renderMrzPanel(mrz) {
  if (!mrz) return '';
  if (!mrz.raw_lines || mrz.raw_lines.length < 2) {
    return `<div class="admin-panel"><h3>MRZ Validation</h3><div class="admin-note">${mrz.error ? escapeHtml(mrz.error) : 'No machine-readable zone could be extracted from this image.'}</div></div>`;
  }
  const fields = mrz.fields || {};
  const checks = mrz.checks || {};
  return `
    <div class="admin-panel">
      <h3>MRZ Validation <span class="badge ${verdictBadgeClass(null, mrz.verdict)}" style="margin-left:8px">${escapeHtml((mrz.verdict || 'unknown').replace(/_/g, ' '))}</span></h3>
      <div class="mrz-block">01  ${escapeHtml(mrz.raw_lines[0])}\n02  ${escapeHtml(mrz.raw_lines[1])}</div>
      <div class="field-grid" style="margin-top:14px">
        ${Object.entries(checks).map(([k, ok]) => `
          <div class="field-card">
            <div class="label">${escapeHtml(k.replace(/_/g, ' '))}</div>
            <div class="value"><span class="badge ${ok ? 'green' : 'red'}">${ok ? '✓ Passed' : '✗ Failed'}</span></div>
          </div>
        `).join('')}
      </div>
      <div class="field-grid" style="margin-top:14px">
        <div class="field-card"><div class="label">Given name</div><div class="value">${escapeHtml(fields.given_names || '—')}</div></div>
        <div class="field-card"><div class="label">Surname</div><div class="value">${escapeHtml(fields.surname || '—')}</div></div>
        <div class="field-card"><div class="label">Date of birth</div><div class="value">${escapeHtml(fields.date_of_birth || '—')}</div></div>
        <div class="field-card"><div class="label">Nationality</div><div class="value">${escapeHtml(fields.nationality || '—')}</div></div>
        <div class="field-card"><div class="label">Expiry</div><div class="value">${escapeHtml(fields.expiry_date || '—')}</div></div>
        <div class="field-card"><div class="label">Document number</div><div class="value">${escapeHtml(fields.passport_number || '—')}</div></div>
      </div>
    </div>`;
}

function renderOcrPanel(ocrFields, mrz) {
  if (mrz || !ocrFields || !Object.keys(ocrFields).length) return '';
  return `
    <div class="admin-panel">
      <h3>Extracted fields</h3>
      <div class="field-grid">
        ${Object.entries(ocrFields).map(([k, v]) => `
          <div class="field-card"><div class="label">${escapeHtml(k.replace(/_/g, ' '))}</div><div class="value">${escapeHtml(v || '—')}</div></div>
        `).join('')}
      </div>
    </div>`;
}

function renderForensicsPanel(fr) {
  if (!fr) {
    return `<div class="admin-panel"><h3>Forensics &amp; EXIF</h3><div class="admin-note">Not available.</div></div>`;
  }
  const verdictClass = fr.verdict === 'clean' ? 'green' : fr.verdict === 'suspicious' ? 'amber' : 'gray';
  return `
    <div class="admin-panel">
      <h3>Forensics &amp; EXIF <span class="badge ${verdictClass}" style="margin-left:8px">${escapeHtml((fr.verdict || 'unavailable').toUpperCase())}</span></h3>
      ${fr.error ? `<div class="admin-note" style="margin-top:0">${escapeHtml(fr.error)}</div>` : ''}
      <div class="field-grid">
        <div class="field-card"><div class="label">EXIF present</div><div class="value">${fr.exif_present ? 'Yes' : 'No'}</div></div>
        <div class="field-card"><div class="label">Camera make</div><div class="value">${escapeHtml(fr.camera_make || '—')}</div></div>
        <div class="field-card"><div class="label">Camera model</div><div class="value">${escapeHtml(fr.camera_model || '—')}</div></div>
        <div class="field-card"><div class="label">Software tag</div><div class="value">${escapeHtml(fr.software_tag || '—')}</div></div>
        <div class="field-card"><div class="label">ELA score</div><div class="value">${fr.ela_score ?? '—'}</div></div>
        <div class="field-card"><div class="label">Editing software detected</div><div class="value">${fr.editing_software_detected ? 'Yes' : 'No'}</div></div>
      </div>
      ${fr.ela_heatmap_b64 ? `<div style="margin-top:14px"><img src="${fr.ela_heatmap_b64}" alt="ELA heatmap" style="max-width:100%;border-radius:10px;border:1px solid var(--a-border)"></div>` : ''}
      ${(fr.risk_flags && fr.risk_flags.length) ? `<ul class="risk-flags" style="margin-top:14px">${fr.risk_flags.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
    </div>`;
}

function renderPepPanel(p) {
  if (!p) {
    return `<div class="admin-panel"><h3>PEP &amp; Sanctions</h3><div class="admin-note">Not available.</div></div>`;
  }
  const bannerClass = p.risk_classification === 'CLEAN' ? 'clean'
    : p.risk_classification === 'POTENTIAL_MATCH' ? 'warn' : 'unavail';
  const matches = (p.matches || []).map(m => `
    <div class="field-card">
      <div class="label">${escapeHtml((m.datasets || []).join(', ') || 'match')}</div>
      <div class="value">${escapeHtml(m.name)} — ${fmtPct(m.score)}</div>
    </div>
  `).join('');
  return `
    <div class="admin-panel">
      <h3>PEP &amp; Sanctions</h3>
      <div class="field-grid">
        <div class="field-card"><div class="label">Subject name</div><div class="value">${escapeHtml(p.subject_name || '—')}</div></div>
        <div class="field-card"><div class="label">Risk classification</div><div class="value"><span class="badge ${bannerClass === 'clean' ? 'green' : bannerClass === 'warn' ? 'amber' : 'gray'}">${escapeHtml(p.risk_classification)}</span></div></div>
      </div>
      <div class="pep-banner ${bannerClass}">
        ${escapeHtml(p.banner)}<br>
        <span style="font-weight:400;font-size:0.85rem;opacity:0.85">${fmtPct(p.match_confidence)} match confidence</span>
      </div>
    </div>
    ${matches ? `<div class="admin-panel"><h3>Matches</h3><div class="field-grid">${matches}</div></div>` : ''}
  `;
}

function renderResult(data) {
  resultWrap.innerHTML =
    renderDocumentPanel(data.document) +
    renderMrzPanel(data.mrz) +
    renderOcrPanel(data.ocr_fields, data.mrz) +
    renderForensicsPanel(data.forensics) +
    renderPepPanel(data.pep);
}

async function runCheck() {
  const countryInput = document.getElementById('d-country');
  const country = countryInput.value.trim();
  const docType = document.getElementById('d-doc-type').value;
  const frontFile = document.getElementById('d-image-front').files[0];
  const backFile = document.getElementById('d-image-back').files[0];
  const checkedBy = document.getElementById('d-checked-by').value.trim() || null;

  errorBox.style.display = 'none';

  if (!/^[A-Za-z]{2}$/.test(country)) {
    errorBox.textContent = 'Pick an issuing country from the dropdown.';
    errorBox.style.display = '';
    countryInput.focus();
    return;
  }
  if (!frontFile) {
    errorBox.textContent = 'Choose a document front image to upload.';
    errorBox.style.display = '';
    return;
  }

  checkBtn.disabled = true;
  checkBtn.textContent = 'Checking…';
  resultWrap.innerHTML = `<div class="admin-panel"><div class="field-grid">${Array.from({ length: 3 }, () => `
    <div class="field-card skel-field-card"><div class="skel skel-label"></div><div class="skel skel-text"></div></div>
  `).join('')}</div></div>`;

  const form = new FormData();
  form.append('country', country.toUpperCase());
  form.append('doc_type', docType);
  form.append('id_image', frontFile);
  if (backFile) form.append('id_image_back', backFile);
  if (checkedBy) form.append('checked_by', checkedBy);
  if (selectedFirmId) form.append('firm_id', selectedFirmId);

  try {
    const resp = await adminFetch('/document-check', { method: 'POST', body: form });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      errorBox.textContent = body.detail || `Check failed (${resp.status})`;
      errorBox.style.display = '';
      resultWrap.innerHTML = '';
      return;
    }
    const data = await resp.json();
    renderResult(data);
  } catch (_) {
    // adminFetch already redirected to login on 401
  } finally {
    checkBtn.disabled = false;
    checkBtn.textContent = 'Run check';
  }
}

attachCountryAutocomplete(document.getElementById('d-country'));
renderFirmFilter('firm-filter-slot', (firmId) => { selectedFirmId = firmId; });

checkBtn.addEventListener('click', runCheck);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});
