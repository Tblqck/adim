const firmId = new URLSearchParams(location.search).get('id');

const titleEl      = document.getElementById('firm-title');
const subEl        = document.getElementById('firm-sub');
const errorBanner  = document.getElementById('firm-error');
const nameEl       = document.getElementById('firm-name');
const slugEl       = document.getElementById('firm-slug');
const idEl         = document.getElementById('firm-id-value');
const statusBadge  = document.getElementById('key-status-badge');
const rotateBtn    = document.getElementById('rotate-btn');
const keyErrorBox  = document.getElementById('key-error');
const newKeyWrap   = document.getElementById('new-key-wrap');

if (!firmId) {
  location.href = 'firms';
}

function showFatalError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('show');
}

async function loadFirm() {
  try {
    const resp = await adminFetch('/firms');
    if (!resp.ok) {
      showFatalError(`Couldn't load firm (${resp.status})`);
      return;
    }
    const firms = (await resp.json()).items || [];
    const firm = firms.find(f => String(f.id) === firmId);
    if (!firm) {
      showFatalError('Firm not found.');
      return;
    }
    titleEl.textContent = firm.name;
    subEl.textContent = firm.slug ? `@${firm.slug}` : firm.id;
    nameEl.textContent = firm.name || '—';
    slugEl.textContent = firm.slug || '—';
    idEl.textContent = firm.id;
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

async function loadKeyStatus() {
  statusBadge.textContent = 'Loading…';
  statusBadge.className = 'badge gray';
  try {
    const resp = await adminFetch(`/firm-api-key?firm_id=${firmId}`);
    if (!resp.ok) {
      statusBadge.textContent = 'Error';
      return;
    }
    const data = await resp.json();
    const hasKey = !!data.has_key;
    statusBadge.textContent = hasKey ? 'Active' : 'Not set';
    statusBadge.className = `badge ${hasKey ? 'green' : 'gray'}`;
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

function renderNewKey(apiKey) {
  newKeyWrap.innerHTML = `
    <div class="field-card" style="margin-top:14px;border-color:rgba(255,85,117,0.3)">
      <div class="label">New API key</div>
      <div class="value" style="word-break:break-all;font-weight:400;font-size:0.9rem" id="new-key-value">${escapeHtml(apiKey)}</div>
    </div>
    <button class="admin-btn" id="copy-key-btn" style="margin-top:12px">Copy</button>
    <div class="admin-note" style="margin-top:12px;background:rgba(255,85,117,0.08);border-color:rgba(255,85,117,0.3);color:#ff5575">
      This is the only time this key is shown — save it now. The previous key (if any) stopped working the instant this one was generated.
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
  keyErrorBox.style.display = 'none';
  if (statusBadge.textContent === 'Active' && !confirm('Generate a new key for this firm? The current key will stop working immediately.')) return;

  rotateBtn.disabled = true;
  rotateBtn.textContent = 'Generating…';
  try {
    const resp = await adminFetch(`/firm-api-key/rotate?firm_id=${firmId}`, { method: 'POST' });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      keyErrorBox.textContent = body.detail || `Failed (${resp.status})`;
      keyErrorBox.style.display = '';
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
  }
}

rotateBtn.addEventListener('click', rotateKey);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});

if (firmId) {
  loadFirm();
  loadKeyStatus();
}
