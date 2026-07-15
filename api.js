const isSuperAdmin = sessionStorage.getItem('kyc_super_admin') === '1';
const canManage    = isSuperAdmin || sessionStorage.getItem('kyc_can_create_users') === '1';

const statusBadge = document.getElementById('key-status-badge');
const keyHint      = document.getElementById('key-hint');
const rotateBtn    = document.getElementById('rotate-btn');
const revokeBtn    = document.getElementById('revoke-btn');
const errorBox     = document.getElementById('key-error');
const newKeyWrap   = document.getElementById('new-key-wrap');

let selectedFirmId = null;
let hasKey = false;

function firmQuery() {
  return selectedFirmId ? `?firm_id=${selectedFirmId}` : '';
}

function fillCurlSlug(slug) {
  const s = slug || 'your-firm-slug';
  document.getElementById('curl-verify').textContent =
    document.getElementById('curl-verify').textContent.replace(/X-Client-Id: [^\\\n]+/, `X-Client-Id: ${s} \\`);
  document.getElementById('curl-sessions').textContent =
    document.getElementById('curl-sessions').textContent.replace(/X-Client-Id: [^\\\n]+/, `X-Client-Id: ${s} \\`);
}

function updateAvailability() {
  const noFirmPicked = isSuperAdmin && !selectedFirmId;
  keyHint.style.display = noFirmPicked ? '' : 'none';
  rotateBtn.disabled = noFirmPicked || !canManage;
  revokeBtn.disabled = noFirmPicked || !canManage || !hasKey;
  if (!canManage) {
    rotateBtn.title = 'Ask your firm admin to manage the API key';
    revokeBtn.title = rotateBtn.title;
  }
}

async function loadKeyStatus() {
  if (isSuperAdmin && !selectedFirmId) {
    statusBadge.textContent = '—';
    statusBadge.className = 'badge gray';
    updateAvailability();
    return;
  }
  statusBadge.textContent = 'Loading…';
  statusBadge.className = 'badge gray';
  try {
    const resp = await adminFetch(`/firm-api-key${firmQuery()}`);
    if (!resp.ok) {
      statusBadge.textContent = 'Error';
      return;
    }
    const data = await resp.json();
    hasKey = !!data.has_key;
    statusBadge.textContent = hasKey ? 'Active' : 'Not set';
    statusBadge.className = `badge ${hasKey ? 'green' : 'gray'}`;
    fillCurlSlug(data.firm_slug);
  } catch (_) {
    // adminFetch already redirected to login on 401
  } finally {
    updateAvailability();
  }
}

function renderNewKey(apiKey) {
  newKeyWrap.innerHTML = `
    <div class="admin-panel">
      <h3>New API key</h3>
      <div class="field-card" style="margin-top:0;border-color:rgba(255,85,117,0.3)">
        <div class="label">API key</div>
        <div class="value" style="word-break:break-all;font-weight:400;font-size:0.9rem" id="new-key-value">${escapeHtml(apiKey)}</div>
      </div>
      <button class="admin-btn" id="copy-key-btn" style="margin-top:12px">Copy</button>
      <div class="admin-note" style="margin-top:12px;margin-bottom:0;background:rgba(255,85,117,0.08);border-color:rgba(255,85,117,0.3);color:#ff5575">
        This is the only time this key is shown — save it now. The previous key (if any) stopped working the instant this one was generated.
      </div>
    </div>
  `;
  document.getElementById('copy-key-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      const btn = document.getElementById('copy-key-btn');
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } catch (_) {
      document.getElementById('copy-key-btn').textContent = 'Copy failed — select manually';
    }
  });
}

async function rotateKey() {
  errorBox.style.display = 'none';
  if (hasKey && !confirm('Generate a new key? The current key will stop working immediately.')) return;

  rotateBtn.disabled = true;
  rotateBtn.textContent = 'Generating…';
  try {
    const resp = await adminFetch(`/firm-api-key/rotate${firmQuery()}`, { method: 'POST' });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      errorBox.textContent = body.detail || `Failed (${resp.status})`;
      errorBox.style.display = '';
      return;
    }
    const data = await resp.json();
    renderNewKey(data.api_key);
    await loadKeyStatus();
  } catch (_) {
    // adminFetch already redirected to login on 401
  } finally {
    rotateBtn.disabled = false;
    rotateBtn.textContent = 'Generate / rotate key';
    updateAvailability();
  }
}

async function revokeKey() {
  errorBox.style.display = 'none';
  if (!confirm('Remove this API key? Server-to-server access (X-Api-Key) stops immediately until a new one is generated. The dashboard login is unaffected.')) return;

  revokeBtn.disabled = true;
  try {
    const resp = await adminFetch(`/firm-api-key${firmQuery()}`, { method: 'DELETE' });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      errorBox.textContent = body.detail || `Failed (${resp.status})`;
      errorBox.style.display = '';
      return;
    }
    newKeyWrap.innerHTML = '';
    await loadKeyStatus();
  } catch (_) {
    // adminFetch already redirected to login on 401
  } finally {
    updateAvailability();
  }
}

rotateBtn.addEventListener('click', rotateKey);
revokeBtn.addEventListener('click', revokeKey);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});

renderFirmFilter('firm-filter-slot', (firmId) => {
  selectedFirmId = firmId;
  loadKeyStatus();
}).then(() => {
  if (!isSuperAdmin) loadKeyStatus();
  else updateAvailability();
});
