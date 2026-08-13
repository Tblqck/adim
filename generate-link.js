const newLinkWrap    = document.getElementById('new-link-wrap');
const linksTableWrap = document.getElementById('links-table-wrap');
const generateBtn    = document.getElementById('generate-btn');
const errorBox       = document.getElementById('generate-error');
const isSuperAdmin   = sessionStorage.getItem('kyc_super_admin') === '1';
const generateHint   = document.getElementById('generate-hint');
let   selectedFirmId = null;

// A link always belongs to exactly one firm. A firm-scoped session has an
// implicit firm_id, but the super-admin's firm filter defaults to "All
// firms" (value null) — valid for browsing, not for generating — so the
// button starts disabled until a specific firm is picked.
function updateGenerateAvailability() {
  if (!isSuperAdmin) return;
  generateBtn.disabled = !selectedFirmId;
  generateHint.style.display = selectedFirmId ? 'none' : '';
}

// Link lifecycle, derived client-side from status/opened_at/expires_at —
// the backend only tracks two hard states (pending/used); "opened" is a
// soft, informational layer on top so an admin can tell "never opened",
// "opened but abandoned mid-capture", and "expired before anyone tried it"
// apart at a glance, instead of every un-submitted link looking identical.
function linkLifecycle(row) {
  const expired = new Date(row.expires_at) < new Date();
  if (row.status === 'used') return { label: 'Submitted', cls: 'green' };
  if (expired) {
    return row.opened_at
      ? { label: 'Expired — opened, not submitted', cls: 'red' }
      : { label: 'Expired — never opened', cls: 'gray' };
  }
  if (row.opened_at) return { label: 'Opened — not submitted', cls: 'amber' };
  return { label: 'Pending — not opened', cls: 'blue' };
}

function renderNewLink(data) {
  const copyRow = data.url
    ? `
      <div class="field-card" style="margin-top:0">
        <div class="label">Link</div>
        <div class="value" style="word-break:break-all;font-weight:400;font-size:0.9rem">${escapeHtml(data.url)}</div>
      </div>
      <button class="admin-btn" id="copy-link-btn" style="margin-top:12px">Copy link</button>
    `
    : `
      <div class="admin-note" style="margin-top:0">
        CAPTURE_BASE_URL isn't configured on the server, so a full link can't be built — but the
        token below is still valid. Append it yourself as <code>?token=...</code> to your capture
        page's URL.
      </div>
      <div class="field-card" style="margin-top:12px">
        <div class="label">Token</div>
        <div class="value" style="word-break:break-all;font-weight:400;font-size:0.9rem">${escapeHtml(data.token)}</div>
      </div>
    `;

  newLinkWrap.innerHTML = `
    <div class="admin-panel">
      <h3>Link ready</h3>
      ${copyRow}
      <div class="admin-note" style="margin-top:12px;margin-bottom:0">
        Single-use, expires ${escapeHtml(fmtDate(data.expires_at))}.
      </div>
    </div>
  `;

  const copyBtn = document.getElementById('copy-link-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.url);
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1500);
      } catch (_) {
        copyBtn.textContent = 'Copy failed — select manually';
      }
    });
  }
}

async function generateLink() {
  errorBox.style.display = 'none';
  const user_ref = document.getElementById('l-user-ref').value.trim() || null;

  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';

  try {
    const resp = await adminFetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_ref, firm_id: selectedFirmId }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      errorBox.textContent = body.detail || `Failed to generate link (${resp.status})`;
      errorBox.style.display = '';
      return;
    }
    const data = await resp.json();
    renderNewLink(data);
    document.getElementById('l-user-ref').value = '';
    loadLinks();
  } catch (_) {
    // adminFetch already redirected to login on 401
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate link';
  }
}

async function loadLinks() {
  linksTableWrap.innerHTML = `<div class="admin-empty">Loading…</div>`;
  try {
    const params = selectedFirmId ? `?firm_id=${selectedFirmId}` : '';
    const resp = await adminFetch(`/sessions${params}`);
    if (!resp.ok) {
      linksTableWrap.innerHTML = `<div class="admin-empty">Couldn't load recent links.</div>`;
      return;
    }
    const data = await resp.json();
    const items = data.items || [];
    if (!items.length) {
      linksTableWrap.innerHTML = `<div class="admin-empty">No links generated yet.</div>`;
      return;
    }
    linksTableWrap.innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Applicant ref</th>
              <th>Status</th>
              <th>Opened</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.map(row => {
              const isDeleted = !!row.deleted_at;
              const lc = linkLifecycle(row);
              return `
              <tr class="${isDeleted ? 'row-deleted' : ''}" style="cursor:default">
                <td>${escapeHtml(fmtDate(row.created_at))}</td>
                <td>${escapeHtml(row.user_ref || '—')}</td>
                <td><span class="badge ${lc.cls}">${escapeHtml(lc.label)}</span></td>
                <td>${row.opened_at ? escapeHtml(fmtDate(row.opened_at)) : '—'}</td>
                <td>${escapeHtml(fmtDate(row.expires_at))}</td>
                <td>
                  <button class="admin-btn small ${isDeleted ? '' : 'danger'}" data-action="${isDeleted ? 'restore' : 'delete'}" data-id="${row.id}">
                    ${isDeleted ? 'Restore' : 'Delete'}
                  </button>
                </td>
              </tr>
            `; }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

async function handleDeleteRestore(action, id) {
  if (action === 'delete' && !confirm('Delete this link? It stays recoverable for 4 days, then is permanently removed.')) return;
  const path   = `/sessions/${id}${action === 'restore' ? '/restore' : ''}`;
  const method = action === 'restore' ? 'POST' : 'DELETE';
  await adminFetch(path, { method }).catch(() => {});
  await loadLinks();
}

linksTableWrap.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (btn) handleDeleteRestore(btn.dataset.action, btn.dataset.id);
});

renderFirmFilter('firm-filter-slot', (firmId) => {
  selectedFirmId = firmId;
  updateGenerateAvailability();
  loadLinks();
}).then(updateGenerateAvailability);

generateBtn.addEventListener('click', generateLink);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});

loadLinks();
