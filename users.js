const rowsBody      = document.getElementById('rows');
const emptyMsg      = document.getElementById('empty');
const createBtn     = document.getElementById('create-btn');
const errorBox      = document.getElementById('create-error');
const passwordInput = document.getElementById('u-password');
const generateBtn   = document.getElementById('generate-password-btn');
const toggleBtn     = document.getElementById('toggle-password-btn');
const copyBtn       = document.getElementById('copy-password-btn');

function renderRows(users) {
  emptyMsg.style.display = users.length ? 'none' : '';
  rowsBody.innerHTML = users.map(u => {
    const isDeleted = !!u.deleted_at;
    return `
    <tr data-id="${u.id}" class="${isDeleted ? 'row-deleted' : ''}">
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.display_name)}</td>
      <td><span class="badge ${u.can_create_users ? 'green' : 'gray'}">${u.can_create_users ? 'Yes' : 'No'}</span></td>
      <td><span class="badge ${u.active ? 'green' : 'red'}">${u.active ? 'Active' : 'Disabled'}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>
        <button class="admin-btn" data-toggle-create="${u.id}" data-current="${u.can_create_users}" ${isDeleted ? 'disabled' : ''}>
          ${u.can_create_users ? 'Revoke create-users' : 'Allow create-users'}
        </button>
        <button class="admin-btn" data-toggle-active="${u.id}" data-current="${u.active}" ${isDeleted ? 'disabled' : ''}>
          ${u.active ? 'Disable' : 'Re-enable'}
        </button>
      </td>
      <td>
        <button class="admin-btn small ${isDeleted ? '' : 'danger'}" data-action="${isDeleted ? 'restore' : 'delete'}" data-id="${u.id}">
          ${isDeleted ? 'Restore' : 'Delete'}
        </button>
      </td>
    </tr>
  `;
  }).join('');
}

async function loadUsers() {
  try {
    const resp = await adminFetch('/firm-users');
    if (!resp.ok) return;
    renderRows((await resp.json()).items || []);
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

// Employee login needs firm name + username + password — the firm name is
// easy to forget it's a separate field from "which employee", so surface it
// here rather than making people dig through the Firms page to find it.
async function loadFirmLoginInfo() {
  const note = document.getElementById('firm-login-note');
  try {
    const resp = await adminFetch('/me');
    if (!resp.ok) return;
    const me = await resp.json();
    if (!me.firm_name) return;
    note.innerHTML = `Employees log in with <b>Firm: ${escapeHtml(me.firm_name)}</b>, their own <b>Username</b> (shown below), and their password.`;
    note.style.display = '';
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

async function createUser() {
  const username         = document.getElementById('u-username').value.trim().toLowerCase();
  const display_name     = document.getElementById('u-display-name').value.trim();
  const password         = passwordInput.value;
  const can_create_users = document.getElementById('u-can-create-users').checked;

  errorBox.style.display = 'none';
  if (!username || !display_name || !password) {
    errorBox.textContent = 'Username, display name, and password are all required.';
    errorBox.style.display = '';
    return;
  }

  createBtn.disabled = true;
  createBtn.textContent = 'Creating…';
  try {
    const resp = await adminFetch('/firm-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, display_name, password, can_create_users }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      errorBox.textContent = body.detail || `Create failed (${resp.status})`;
      errorBox.style.display = '';
      return;
    }
    document.getElementById('u-username').value = '';
    document.getElementById('u-display-name').value = '';
    passwordInput.value = '';
    document.getElementById('u-can-create-users').checked = false;
    await loadUsers();
  } catch (_) {
    // adminFetch already redirected to login on 401
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = 'Create user';
  }
}

async function toggleField(userId, field, currentValue) {
  await adminFetch(`/firm-users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [field]: !currentValue }),
  }).catch(() => {});
  await loadUsers();
}

async function handleDeleteRestore(action, userId, username) {
  if (action === 'delete' && !confirm(`Delete the login for "${username}"? It stops working immediately. It stays recoverable for 3 days, then is permanently removed.`)) return;
  const path   = `/firm-users/${userId}${action === 'restore' ? '/restore' : ''}`;
  const method = action === 'restore' ? 'POST' : 'DELETE';
  await adminFetch(path, { method }).catch(() => {});
  await loadUsers();
}

rowsBody.addEventListener('click', (e) => {
  const createToggle = e.target.closest('[data-toggle-create]');
  if (createToggle) {
    toggleField(createToggle.dataset.toggleCreate, 'can_create_users', createToggle.dataset.current === 'true');
    return;
  }
  const activeToggle = e.target.closest('[data-toggle-active]');
  if (activeToggle) {
    toggleField(activeToggle.dataset.toggleActive, 'active', activeToggle.dataset.current === 'true');
    return;
  }
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    const username = actionBtn.closest('tr').querySelector('td').textContent;
    handleDeleteRestore(actionBtn.dataset.action, actionBtn.dataset.id, username);
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (row) location.href = `user-detail?id=${row.dataset.id}`;
});

wireGeneratePassword(generateBtn, passwordInput);
wirePasswordVisibility(passwordInput, toggleBtn);
wirePasswordCopy(passwordInput, copyBtn);
createBtn.addEventListener('click', createUser);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});

loadUsers();
loadFirmLoginInfo();
