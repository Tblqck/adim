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
  rowsBody.innerHTML = firms.map(f => `
    <tr>
      <td>${escapeHtml(f.name)}</td>
      <td>${escapeHtml(f.id)}</td>
      <td><button class="admin-btn danger small" data-delete="${f.id}">Delete</button></td>
    </tr>
  `).join('');
}

async function deleteFirm(firmId, name) {
  if (!confirm(`Delete firm "${name}"? This can't be undone.`)) return;
  try {
    const resp = await adminFetch(`/firms/${firmId}`, { method: 'DELETE' });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      alert(body.detail || `Delete failed (${resp.status}) — the firm may still have verification records tied to it.`);
      return;
    }
    await loadFirms();
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

rowsBody.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('[data-delete]');
  if (!deleteBtn) return;
  const name = deleteBtn.closest('tr').querySelector('td').textContent;
  deleteFirm(deleteBtn.dataset.delete, name);
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
