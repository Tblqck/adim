const userId = new URLSearchParams(location.search).get('id');

const titleEl        = document.getElementById('user-title');
const subEl          = document.getElementById('user-sub');
const errorBanner    = document.getElementById('detail-error');
const usernameEl     = document.getElementById('d-username');
const displayNameEl  = document.getElementById('d-display-name');
const canCreateBadge = document.getElementById('d-can-create-badge');
const activeBadge    = document.getElementById('d-active-badge');
const createdEl      = document.getElementById('d-created');
const toggleCreateBtn = document.getElementById('toggle-create-btn');
const toggleActiveBtn = document.getElementById('toggle-active-btn');
const deleteBtn        = document.getElementById('delete-btn');
const actionErrorBox   = document.getElementById('action-error');

let user = null;

if (!userId) {
  location.href = 'users';
}

function showFatalError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('show');
}

function render() {
  if (!user) return;
  titleEl.textContent = user.display_name;
  subEl.textContent = `@${user.username}`;
  usernameEl.textContent = user.username;
  displayNameEl.textContent = user.display_name;
  canCreateBadge.textContent = user.can_create_users ? 'Yes' : 'No';
  canCreateBadge.className = `badge ${user.can_create_users ? 'green' : 'gray'}`;
  activeBadge.textContent = user.active ? 'Active' : 'Disabled';
  activeBadge.className = `badge ${user.active ? 'green' : 'red'}`;
  createdEl.textContent = new Date(user.created_at).toLocaleString();
  toggleCreateBtn.textContent = user.can_create_users ? 'Revoke create-users' : 'Allow create-users';
  toggleActiveBtn.textContent = user.active ? 'Disable' : 'Re-enable';
}

async function loadUser() {
  try {
    const resp = await adminFetch(`/firm-users/${userId}`);
    if (!resp.ok) {
      showFatalError(resp.status === 404 ? 'Employee not found.' : `Couldn't load employee (${resp.status})`);
      return;
    }
    user = await resp.json();
    render();
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

async function toggleField(field) {
  actionErrorBox.style.display = 'none';
  try {
    const resp = await adminFetch(`/firm-users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: !user[field] }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      actionErrorBox.textContent = body.detail || `Update failed (${resp.status})`;
      actionErrorBox.style.display = '';
      return;
    }
    await loadUser();
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

async function deleteUser() {
  if (!user) return;
  if (!confirm(`Delete the login for "${user.username}"? This can't be undone.`)) return;
  try {
    const resp = await adminFetch(`/firm-users/${userId}`, { method: 'DELETE' });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      actionErrorBox.textContent = body.detail || `Delete failed (${resp.status})`;
      actionErrorBox.style.display = '';
      return;
    }
    location.href = 'users';
  } catch (_) {
    // adminFetch already redirected to login on 401
  }
}

toggleCreateBtn.addEventListener('click', () => toggleField('can_create_users'));
toggleActiveBtn.addEventListener('click', () => toggleField('active'));
deleteBtn.addEventListener('click', deleteUser);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});

if (userId) {
  loadUser();
}
