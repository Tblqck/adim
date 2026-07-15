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
  rowsBody.innerHTML = users.map(u => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.display_name)}</td>
      <td><span class="badge ${u.can_create_users ? 'green' : 'gray'}">${u.can_create_users ? 'Yes' : 'No'}</span></td>
      <td><span class="badge ${u.active ? 'green' : 'red'}">${u.active ? 'Active' : 'Disabled'}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>
        <button class="admin-btn" data-toggle-create="${u.id}" data-current="${u.can_create_users}">
          ${u.can_create_users ? 'Revoke create-users' : 'Allow create-users'}
        </button>
        <button class="admin-btn" data-toggle-active="${u.id}" data-current="${u.active}">
          ${u.active ? 'Disable' : 'Re-enable'}
        </button>
      </td>
      <td>
        <button class="admin-btn danger small" data-delete="${u.id}">Delete</button>
      </td>
    </tr>
  `).join('');
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

async function deleteUser(userId, username) {
  if (!confirm(`Delete the login for "${username}"? This can't be undone.`)) return;
  await adminFetch(`/firm-users/${userId}`, { method: 'DELETE' }).catch(() => {});
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
  const deleteBtn = e.target.closest('[data-delete]');
  if (deleteBtn) {
    const username = deleteBtn.closest('tr').querySelector('td').textContent;
    deleteUser(deleteBtn.dataset.delete, username);
  }
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
