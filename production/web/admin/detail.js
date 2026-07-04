const id = new URLSearchParams(location.search).get('id');
const panels = {
  overview:  document.querySelector('[data-panel="overview"]'),
  scores:    document.querySelector('[data-panel="scores"]'),
  mrz:       document.querySelector('[data-panel="mrz"]'),
  cross:     document.querySelector('[data-panel="cross"]'),
  forensics: document.querySelector('[data-panel="forensics"]'),
  pep:       document.querySelector('[data-panel="pep"]'),
};

// Canonical editable fields — key is what gets sent back as corrected_fields.
const EDITABLE_FIELDS = [
  ['given_names',   'Given name',       ['given_name', 'first_name']],
  ['surname',       'Surname',          ['last_name']],
  ['date_of_birth', 'Date of birth',    ['dob', 'birth_date']],
  ['nationality',   'Nationality',      []],
  ['id_number',     'Document number',  ['doc_number', 'document_number', 'passport_number']],
  ['issue_date',    'Issue date',       []],
  ['expiry_date',   'Expiry',           ['expiry']],
];

let currentRow = null;
let editing = false;

document.getElementById('tabbar').addEventListener('click', (e) => {
  const tab = e.target.closest('.admin-tab');
  if (!tab) return;
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t === tab));
  const name = tab.dataset.tab;
  Object.entries(panels).forEach(([k, el]) => { el.style.display = k === name ? '' : 'none'; });
});

// field(row)(canonicalKey) — corrected_fields overlay wins, then the
// structured extracted_id_data column, then the raw ocr_fields JSONB, then
// any aliases (older field names / MRZ naming).
function field(row) {
  const corrected = row.corrected_fields || {};
  const val = (row.extracted_id_data && row.extracted_id_data[0]) || {};
  const ocr = (row.pipeline_response && row.pipeline_response.ocr_fields) || {};
  return (key, ...aliases) => {
    if (corrected[key]) return corrected[key];
    for (const k of [key, ...aliases]) {
      if (val[k]) return val[k];
      if (ocr[k]) return ocr[k];
    }
    return null;
  };
}

function isCorrected(row, key) {
  return !!(row.corrected_fields && row.corrected_fields[key]);
}

function mrzFields(row) {
  const mrz = row.pipeline_response && row.pipeline_response.mrz;
  return mrz && mrz.fields ? mrz.fields : null;
}

// ── Review status / actions ─────────────────────────────────────────────

function renderReviewStatus(row) {
  const badge = document.getElementById('review-status');
  if (row.reviewed) {
    badge.style.display = '';
    badge.className = 'badge blue';
    badge.textContent = `Reviewed by ${row.reviewed_by || 'unknown'}`;
  } else {
    badge.style.display = 'none';
  }
  document.getElementById('reviewer-name').value = row.reviewed_by || '';
}

function collectCorrections() {
  const corrections = {};
  document.querySelectorAll('[data-edit-field]').forEach((input) => {
    const key = input.dataset.editField;
    const value = input.value.trim();
    if (value && value !== input.dataset.original) {
      corrections[key] = value;
    }
  });
  return corrections;
}

async function submitReview(verified) {
  const reviewedBy = document.getElementById('reviewer-name').value.trim();
  if (!reviewedBy) {
    alert('Enter your name in "Reviewed by" before saving/approving/rejecting.');
    return;
  }
  const corrected_fields = editing ? collectCorrections() : undefined;
  if (verified === undefined && (!corrected_fields || !Object.keys(corrected_fields).length)) {
    alert('No changed values to save.');
    return;
  }

  const body = { reviewed_by: reviewedBy, corrected_fields };
  if (verified !== undefined) body.verified = verified;

  const resp = await adminFetch(`/verifications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const respBody = await resp.json().catch(() => ({}));
    alert(respBody.detail || `Update failed (${resp.status})`);
    return;
  }
  editing = false;
  document.getElementById('edit-btn').textContent = 'Edit values';
  document.getElementById('save-btn').style.display = 'none';
  await load();
}

document.getElementById('approve-btn').addEventListener('click', () => submitReview(true));
document.getElementById('reject-btn').addEventListener('click', () => submitReview(false));
document.getElementById('save-btn').addEventListener('click', () => submitReview(undefined));
document.getElementById('edit-btn').addEventListener('click', () => {
  editing = !editing;
  document.getElementById('edit-btn').textContent = editing ? 'Cancel edit' : 'Edit values';
  document.getElementById('save-btn').style.display = editing ? '' : 'none';
  if (currentRow) renderOverview(currentRow);
});

// ── Overview ─────────────────────────────────────────────────────────────

function identityFieldCard(row, key, label, aliases) {
  const f = field(row);
  const value = f(key, ...aliases) || '';
  const corrected = isCorrected(row, key);

  if (editing) {
    return `
      <div class="field-card">
        <div class="label">${escapeHtml(label)}</div>
        <input type="text" class="edit-input" data-edit-field="${key}" data-original="${escapeHtml(value)}" value="${escapeHtml(value)}">
      </div>`;
  }
  return `
    <div class="field-card">
      <div class="label">${escapeHtml(label)} ${corrected ? '<span class="badge blue" style="margin-left:4px">corrected</span>' : ''}</div>
      <div class="value">${escapeHtml(value || '—')}</div>
    </div>`;
}

function renderOverview(row) {
  const badgeClass = verdictBadgeClass(row.verified, row.overall_verdict);
  const badgeText  = (row.overall_verdict || (row.verified ? 'verified' : 'pending')).replace(/_/g, ' ');
  const images = row.images || {};

  const imageCards = [];
  if (images.id_front_url) imageCards.push(['ID front', images.id_front_url]);
  if (images.id_back_url)  imageCards.push(['ID back', images.id_back_url]);
  (images.face_urls || []).forEach((u, i) => imageCards.push([`Liveness frame ${i + 1}`, u]));

  panels.overview.innerHTML = `
    <div class="admin-panel">
      <h3>Summary</h3>
      <div class="field-grid">
        <div class="field-card"><div class="label">Overall verdict</div><div class="value"><span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span></div></div>
        <div class="field-card"><div class="label">Score</div><div class="value">${fmtPct(row.confidence_score)}</div></div>
        <div class="field-card"><div class="label">Country</div><div class="value">${escapeHtml(row.country || '—')}</div></div>
        <div class="field-card"><div class="label">Document type</div><div class="value">${escapeHtml((row.doc_type || '—').replace(/_/g, ' '))}</div></div>
        <div class="field-card"><div class="label">Submitted</div><div class="value">${escapeHtml(fmtDate(row.created_at))}</div></div>
        <div class="field-card"><div class="label">User ref</div><div class="value">${escapeHtml(row.user_ref || '—')}</div></div>
      </div>
    </div>

    <div class="admin-panel">
      <h3>Extracted identity ${editing ? '<span class="admin-note" style="display:inline-block;margin:0 0 0 10px;padding:2px 8px">Editing — change a value, then Approve/Reject to save</span>' : ''}</h3>
      <div class="field-grid">
        ${EDITABLE_FIELDS.map(([key, label, aliases]) => identityFieldCard(row, key, label, aliases)).join('')}
      </div>
    </div>

    <div class="admin-panel">
      <h3>Captured images</h3>
      ${imageCards.length
        ? `<div class="image-grid">${imageCards.map(([label, url]) => `
            <figure><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy"><figcaption>${escapeHtml(label)}</figcaption></figure>
          `).join('')}</div>`
        : `<div class="admin-note">No images stored for this verification (Supabase Storage may not be configured, or upload is still in progress).</div>`}
    </div>
  `;
}

// ── Model Scores tab ─────────────────────────────────────────────────────

function scoreCard(label, score, verdict, modelLabel, extraBadge) {
  return `
    <div class="field-card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${fmtPct(score)} ${verdict ? `<span class="badge ${verdictBadgeClass(null, verdict)}" style="margin-left:6px">${escapeHtml(verdict.replace(/_/g, ' '))}</span>` : ''}</div>
      <div class="admin-note" style="margin:8px 0 0;padding:6px 10px">${escapeHtml(modelLabel)}${extraBadge ? ' · ' + extraBadge : ''}</div>
    </div>`;
}

function renderScores(row) {
  const wordCount = row.ocr_word_count;
  const extracted = (row.extracted_id_data && row.extracted_id_data[0]) || {};
  const sources = extracted.field_sources || null;

  panels.scores.innerHTML = `
    <div class="admin-panel">
      <h3>Per-model results</h3>
      <div class="admin-note">Each score is tagged with the model or method that actually produced it, so a "heuristic" fallback score can be weighted differently from a real ONNX model result.</div>
      <div class="field-grid">
        ${scoreCard('Face match', row.face_match_score, row.face_match_verdict, 'ArcFace R50 (w600k_r50.onnx) — cosine similarity vs ID photo')}
        ${scoreCard('Liveness', row.liveness_score, row.liveness_verdict, row.liveness_method === 'onnx' ? 'MiniFASNetV2.onnx (real anti-spoofing model)' : 'Heuristic fallback — Laplacian sharpness, NOT the ONNX anti-spoofing model')}
        ${scoreCard('Document match', row.document_match_score, row.document_match_verdict, 'ORB + colour histogram vs cached reference images')}
        ${row.mrz_verdict ? scoreCard('MRZ validation', null, row.mrz_verdict, 'ICAO 9303 checksum validation (passport only)') : ''}
      </div>
    </div>

    <div class="admin-panel">
      <h3>OCR extraction quality</h3>
      <div class="field-grid">
        <div class="field-card"><div class="label">Words detected</div><div class="value">${wordCount ?? '—'}</div></div>
      </div>
      ${sources ? `
        <div class="field-grid" style="margin-top:12px">
          ${Object.entries(sources).map(([f, src]) => `
            <div class="field-card">
              <div class="label">${escapeHtml(f.replace(/_/g, ' '))}</div>
              <div class="value"><span class="badge ${src === 'label' ? 'green' : 'amber'}">${src === 'label' ? 'Label match' : 'Regex guess'}</span></div>
            </div>
          `).join('')}
        </div>` : `<div class="admin-note" style="margin-top:12px">Per-field source (label match vs regex guess) not recorded for this verification.</div>`}
    </div>
  `;
}

// ── MRZ tab ──────────────────────────────────────────────────────────────

function renderMrz(row) {
  const mrz = row.pipeline_response && row.pipeline_response.mrz;
  if (!mrz || !mrz.raw_lines || mrz.raw_lines.length < 2) {
    panels.mrz.innerHTML = `<div class="admin-panel"><div class="admin-note">Not applicable — MRZ is only present on passports, and none was extracted for this verification.</div></div>`;
    return;
  }
  const fields = mrz.fields || {};
  const checks = mrz.checks || {};

  panels.mrz.innerHTML = `
    <div class="admin-panel">
      <h3>Embedded OCR machine-readable lines</h3>
      <div class="mrz-block">01  ${escapeHtml(mrz.raw_lines[0])}\n02  ${escapeHtml(mrz.raw_lines[1])}</div>
      <div class="admin-note" style="margin-top:12px">Format detected: TD3 ICAO document structure (44 chars/row)</div>
    </div>

    <div class="admin-panel">
      <h3>Check digit validation</h3>
      <div class="field-grid">
        ${Object.entries(checks).map(([k, ok]) => `
          <div class="field-card">
            <div class="label">${escapeHtml(k.replace(/_/g, ' '))}</div>
            <div class="value"><span class="badge ${ok ? 'green' : 'red'}">${ok ? '✓ Passed' : '✗ Failed'}</span></div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="admin-panel">
      <h3>Extracted sovereign identity profile</h3>
      <div class="field-grid">
        <div class="field-card"><div class="label">Given name</div><div class="value">${escapeHtml(fields.given_names || '—')}</div></div>
        <div class="field-card"><div class="label">Surname</div><div class="value">${escapeHtml(fields.surname || '—')}</div></div>
        <div class="field-card"><div class="label">Date of birth</div><div class="value">${escapeHtml(fields.date_of_birth || '—')}</div></div>
        <div class="field-card"><div class="label">Nationality</div><div class="value">${escapeHtml(fields.nationality || '—')}</div></div>
        <div class="field-card"><div class="label">Date of expiry</div><div class="value">${escapeHtml(fields.expiry_date || '—')}</div></div>
        <div class="field-card"><div class="label">Document number</div><div class="value">${escapeHtml(fields.passport_number || '—')}</div></div>
      </div>
    </div>
  `;
}

// ── Cross-check tab ──────────────────────────────────────────────────────

function renderCross(row) {
  const ocr = (row.pipeline_response && row.pipeline_response.ocr_fields) || {};
  const mrz = mrzFields(row);

  const rows = [
    ['Document number', ['id_number', 'doc_number'], 'passport_number', 'text'],
    ['Date of birth',   ['dob', 'date_of_birth'],     'date_of_birth',   'date'],
    ['Surname',         ['surname'],                  'surname',         'text'],
    ['Given names',     ['given_names'],               'given_names',    'text'],
    ['Date of expiry',  ['expiry', 'expiry_date'],     'expiry_date',    'date'],
    ['Nationality',     ['nationality'],               'nationality',    'text'],
  ];

  // Printed OCR text is often bilingual / differently formatted than the
  // MRZ (e.g. "ΑΝΩΝΥΜΟΥ ANONYMOU" vs "ANONYMOU", "01/01/1970" vs
  // "1 January 1970") — so this checks containment / calendar-date
  // equality rather than exact string equality.
  const normText = (s) => (s || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const textMatches = (a, b) => {
    const na = normText(a), nb = normText(b);
    if (!na || !nb) return false;
    return na.includes(nb) || nb.includes(na) || na.split(' ').some(tok => tok && nb.split(' ').includes(tok));
  };
  const dateMatches = (a, b) => {
    const da = new Date(a), db = new Date(b);
    if (isNaN(da) || isNaN(db)) return textMatches(a, b);
    return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
  };

  const body = rows.map(([label, ocrKeys, mrzKey, kind]) => {
    const ocrVal = ocrKeys.map(k => ocr[k]).find(Boolean) || null;
    const mrzVal = mrz ? mrz[mrzKey] : null;

    if (!mrz) {
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td class="mono">${escapeHtml(ocrVal || '—')}</td>
        <td class="mono">—</td>
        <td colspan="2">No MRZ available — OCR value only</td>
      </tr>`;
    }
    const match = ocrVal && mrzVal && (kind === 'date' ? dateMatches(ocrVal, mrzVal) : textMatches(ocrVal, mrzVal));
    return `<tr>
      <td>${escapeHtml(label)}</td>
      <td class="mono">${escapeHtml(ocrVal || '—')}</td>
      <td class="mono">${escapeHtml(mrzVal || '—')}</td>
      <td>${match ? '<span class="badge green">✓ Match Confirmed</span>' : '<span class="badge amber">Mismatch / incomplete</span>'}</td>
      <td>${match ? `Found visual match for ${label.toLowerCase()}: ${escapeHtml(ocrVal)}` : 'Values differ or one side is missing'}</td>
    </tr>`;
  }).join('');

  panels.cross.innerHTML = `
    <div class="admin-panel">
      ${!mrz ? `<div class="admin-note">No MRZ available for this document type — showing OCR-extracted fields only, no cross-check performed.</div>` : ''}
      <table class="cross-table">
        <thead><tr><th>Field attribute</th><th>Printed visual OCR text</th><th>Embedded MRZ value</th><th>Matching integrity</th><th>Forensic details</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

// ── Forensics tab ────────────────────────────────────────────────────────

function renderForensics(row) {
  const fr = row.forensics_result;
  if (!fr) {
    panels.forensics.innerHTML = `<div class="admin-panel"><div class="admin-note">Forensics data not yet available — it is written a few seconds after submission by a background step.</div></div>`;
    return;
  }
  const verdictClass = fr.verdict === 'clean' ? 'green' : fr.verdict === 'suspicious' ? 'amber' : 'gray';

  panels.forensics.innerHTML = `
    <div class="admin-panel">
      <h3>Verdict</h3>
      <span class="badge ${verdictClass}">${escapeHtml((fr.verdict || 'unavailable').toUpperCase())}</span>
      ${fr.error ? `<div class="admin-note" style="margin-top:12px">${escapeHtml(fr.error)}</div>` : ''}
    </div>

    <div class="admin-panel">
      <h3>EXIF metadata</h3>
      <div class="field-grid">
        <div class="field-card"><div class="label">EXIF present</div><div class="value">${fr.exif_present ? 'Yes' : 'No'}</div></div>
        <div class="field-card"><div class="label">Camera make</div><div class="value">${escapeHtml(fr.camera_make || '—')}</div></div>
        <div class="field-card"><div class="label">Camera model</div><div class="value">${escapeHtml(fr.camera_model || '—')}</div></div>
        <div class="field-card"><div class="label">Captured at</div><div class="value">${escapeHtml(fr.datetime_original || '—')}</div></div>
        <div class="field-card"><div class="label">Software tag</div><div class="value">${escapeHtml(fr.software_tag || '—')}</div></div>
        <div class="field-card"><div class="label">GPS present</div><div class="value">${fr.gps_present ? 'Yes' : 'No'}</div></div>
      </div>
    </div>

    <div class="admin-panel">
      <h3>Error Level Analysis</h3>
      <div class="field-grid">
        <div class="field-card"><div class="label">ELA score</div><div class="value">${fr.ela_score ?? '—'}</div></div>
        <div class="field-card"><div class="label">Editing software detected</div><div class="value">${fr.editing_software_detected ? 'Yes' : 'No'}</div></div>
        <div class="field-card"><div class="label">Possible resave</div><div class="value">${fr.resave_detected ? 'Yes (low confidence)' : 'No'}</div></div>
      </div>
      ${fr.ela_heatmap_b64 ? `<div style="margin-top:14px"><img src="${fr.ela_heatmap_b64}" alt="ELA heatmap" style="max-width:100%;border-radius:10px;border:1px solid var(--a-border)"></div>` : ''}
    </div>

    ${(fr.risk_flags && fr.risk_flags.length) ? `
    <div class="admin-panel">
      <h3>Risk flags</h3>
      <ul class="risk-flags">${fr.risk_flags.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    </div>` : ''}
  `;
}

// ── PEP tab ──────────────────────────────────────────────────────────────

function renderPep(row) {
  const p = row.pep_result;
  if (!p) {
    panels.pep.innerHTML = `<div class="admin-panel"><div class="admin-note">PEP/sanctions screening not yet available — it is written a few seconds after submission by a background step.</div></div>`;
    return;
  }
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

  panels.pep.innerHTML = `
    <div class="admin-panel">
      <h3>Automated traveler screen</h3>
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

    <div class="admin-panel">
      <h3>Databases checked</h3>
      <div class="db-checked-grid">${dbGrid}</div>
    </div>
  `;
}

// ── Skeleton ─────────────────────────────────────────────────────────────

function skeletonFieldGrid(n = 6) {
  return `<div class="field-grid">${Array.from({ length: n }, () => `
    <div class="field-card skel-field-card">
      <div class="skel skel-label"></div>
      <div class="skel skel-text"></div>
    </div>
  `).join('')}</div>`;
}

function skeletonHeading(width = 140) {
  return `<span class="skel skel-text short" style="width:${width}px;display:inline-block"></span>`;
}

function renderSkeleton() {
  document.getElementById('case-title').innerHTML = skeletonHeading(180);
  document.getElementById('case-sub').innerHTML = skeletonHeading(240);

  panels.overview.innerHTML = `
    <div class="admin-panel"><h3>${skeletonHeading(90)}</h3>${skeletonFieldGrid(6)}</div>
    <div class="admin-panel"><h3>${skeletonHeading(160)}</h3>${skeletonFieldGrid(7)}</div>
    <div class="admin-panel"><h3>${skeletonHeading(140)}</h3>
      <div class="image-grid">${Array.from({ length: 3 }, () => `<figure><div class="skel skel-image"></div></figure>`).join('')}</div>
    </div>
  `;
  panels.scores.innerHTML = `
    <div class="admin-panel"><h3>${skeletonHeading(150)}</h3>${skeletonFieldGrid(4)}</div>
    <div class="admin-panel"><h3>${skeletonHeading(180)}</h3>${skeletonFieldGrid(3)}</div>
  `;
  panels.mrz.innerHTML = `<div class="admin-panel"><h3>${skeletonHeading(220)}</h3><div class="skel" style="height:80px;border-radius:10px"></div></div>`;
  panels.cross.innerHTML = `<div class="admin-panel">${skeletonFieldGrid(5)}</div>`;
  panels.forensics.innerHTML = `<div class="admin-panel"><h3>${skeletonHeading(80)}</h3><span class="skel skel-badge"></span></div><div class="admin-panel">${skeletonFieldGrid(6)}</div>`;
  panels.pep.innerHTML = `<div class="admin-panel">${skeletonFieldGrid(2)}</div>`;
}

// ── Load ─────────────────────────────────────────────────────────────────

async function load() {
  if (!id) {
    document.getElementById('case-sub').textContent = 'No verification id in URL';
    return;
  }
  renderSkeleton();
  let row;
  try {
    const resp = await adminFetch(`/verifications/${id}`);
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      document.getElementById('case-sub').textContent = body.detail || `Error ${resp.status}`;
      return;
    }
    row = await resp.json();
  } catch (_) {
    return; // adminFetch already redirected on 401
  }

  currentRow = row;
  document.getElementById('case-title').textContent = `Verification #${row.id}`;
  document.getElementById('case-sub').textContent =
    `${row.country || '—'} · ${(row.doc_type || '—').replace(/_/g, ' ')} · ${fmtDate(row.created_at)}`;

  renderReviewStatus(row);
  renderOverview(row);
  renderScores(row);
  renderMrz(row);
  renderCross(row);
  renderForensics(row);
  renderPep(row);
}

load();
