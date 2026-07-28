const rowsBody      = document.getElementById('rows');
const emptyMsg      = document.getElementById('empty');
const createBtn     = document.getElementById('create-firm-btn');
const generateBtn   = document.getElementById('generate-password-btn');
const toggleBtn     = document.getElementById('toggle-password-btn');
const copyBtn       = document.getElementById('copy-password-btn');
const errorBox      = document.getElementById('create-error');
const newFirmWrap   = document.getElementById('new-firm-wrap');
const slugInput     = document.getElementById('f-slug');
const passwordInput = document.getElementById('f-password');

function renderRows(firms) {
  emptyMsg.style.display = firms.length ? 'none' : '';
  rowsBody.innerHTML = firms.map(f => {
    const isDeleted = !!f.deleted_at;
    return `
    <tr data-id="${f.id}" class="${isDeleted ? 'row-deleted' : ''}">
      <td>${escapeHtml(f.name)}</td>
      <td style="font-family:var(--a-mono);font-size:0.85rem">${escapeHtml(f.slug || '—')}</td>
      <td>${escapeHtml(f.id)}</td>
      <td>
        <button class="admin-btn small ${isDeleted ? '' : 'danger'}" data-action="${isDeleted ? 'restore' : 'delete'}" data-id="${f.id}">
          ${isDeleted ? 'Restore' : 'Delete'}
        </button>
      </td>
    </tr>
  `;
  }).join('');
}

async function handleDeleteRestore(action, firmId, name) {
  if (action === 'delete' && !confirm(`Delete firm "${name}"? All of its sessions and API keys stop working immediately. It stays recoverable for 3 days, then is permanently removed.`)) return;
  try {
    const path = `/firms/${firmId}${action === 'restore' ? '/restore' : ''}`;
    const resp = await adminFetch(path, { method: action === 'restore' ? 'POST' : 'DELETE' });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      alert(body.detail || `${action === 'restore' ? 'Restore' : 'Delete'} failed (${resp.status})`);
      return;
    }
    await loadFirms();
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

rowsBody.addEventListener('click', (e) => {
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    const name = actionBtn.closest('tr').querySelector('td').textContent;
    handleDeleteRestore(actionBtn.dataset.action, actionBtn.dataset.id, name);
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (row) location.href = `firm-detail?id=${row.dataset.id}`;
});

async function loadFirms() {
  try {
    const resp = await adminFetch('/firms');
    if (!resp.ok) return;
    renderRows((await resp.json()).items || []);
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

function renderNewFirm(name, password, apiKey) {
  newFirmWrap.innerHTML = `
    <div class="admin-panel">
      <h3>Firm created</h3>
      <div class="field-card" style="margin-top:0">
        <div class="label">Name</div>
        <div class="value">${escapeHtml(name)}</div>
      </div>
      <div class="field-card">
        <div class="label">Password</div>
        <div class="value" style="word-break:break-all;font-weight:400;font-size:0.9rem">${escapeHtml(password)}</div>
      </div>
      ${apiKey ? `
        <div class="field-card" style="border-color:rgba(255,85,117,0.3)">
          <div class="label">API key</div>
          <div class="value" style="word-break:break-all;font-weight:400;font-size:0.9rem">${escapeHtml(apiKey)}</div>
        </div>
        <div class="admin-note" style="margin-top:12px;background:rgba(255,85,117,0.08);border-color:rgba(255,85,117,0.3);color:#ff5575">
          This is the only time the API key is shown — save it now, it can't be retrieved again.
        </div>
      ` : ''}
      <div class="admin-note" style="margin-top:12px;margin-bottom:0">
        Share the password with the firm's head admin — it won't be shown again either.
      </div>
    </div>
  `;
}

async function createFirm() {
  errorBox.style.display = 'none';
  const name     = document.getElementById('f-name').value.trim();
  const slug     = slugInput.value.trim();
  const password = passwordInput.value;

  if (!name || !slug || !password) {
    errorBox.textContent = 'Firm name, slug, and password are all required.';
    errorBox.style.display = '';
    return;
  }

  createBtn.disabled = true;
  createBtn.textContent = 'Creating…';
  try {
    // Re-fetch rather than trust whatever's already rendered — this runs
    // right before submit so a firm added moments ago (by this admin in
    // another tab, or another super admin) still gets caught.
    const existingResp = await adminFetch('/firms');
    if (existingResp.ok) {
      const existing = (await existingResp.json()).items || [];
      const nameTaken = existing.some(f => f.name.trim().toLowerCase() === name.toLowerCase());
      const slugTaken = existing.some(f => (f.slug || '').toLowerCase() === slug.toLowerCase());
      if (nameTaken) {
        errorBox.textContent = `A firm named "${name}" already exists.`;
        errorBox.style.display = '';
        return;
      }
      if (slugTaken) {
        errorBox.textContent = `The slug "${slug}" is already in use by another firm.`;
        errorBox.style.display = '';
        return;
      }
    }

    const resp = await adminFetch('/firms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug, password }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      errorBox.textContent = body.detail || `Create failed (${resp.status})`;
      errorBox.style.display = '';
      return;
    }
    const data = await resp.json();
    renderNewFirm(name, password, data.api_key);
    document.getElementById('f-name').value = '';
    slugInput.value = '';
    passwordInput.value = '';
    await loadFirms();
  } catch (_) {
    // adminFetch already redirected to login on 401
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = 'Create firm';
  }
}

wireGeneratePassword(generateBtn, passwordInput);
wirePasswordVisibility(passwordInput, toggleBtn);
wirePasswordCopy(passwordInput, copyBtn);
createBtn.addEventListener('click', createFirm);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});

loadFirms();
