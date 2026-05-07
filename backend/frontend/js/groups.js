async function initializeSidebar() {
  try {
    const response = await fetch('/api/user', {
      credentials: 'include'
    });
    const data = await response.json();

    if (data.authenticated) {
      document.getElementById('user-avatar').src = data.user.avatar;
      document.getElementById('user-name').textContent = 
        data.user.displayName || data.user.username;
      document.getElementById('user-login').textContent = 
        `@${data.user.username}`;
    } else {
      window.location.href = '/login';
    }
  } catch (error) {

    window.location.href = '/login';
  }
}

initializeSidebar();

if (typeof initSettingsDropdown === 'function') {
  initSettingsDropdown();
}

let allGroupCards = [];
let allContacts = [];
let showAllGroups = false;
let showAllContacts = false;

// Load groups from backend
async function loadGroups() {
  try {
    const response = await fetch('/api/groups', {
      credentials: 'include'
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const groupsGrid = document.getElementById('groups-grid');
    allGroupCards = (data.groups || []).filter(g => !g.is_direct)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

    // Build contacts list from group members (exclude current user)
    const contactsMap = new Map();
    allGroupCards.forEach(g => {
      if (!Array.isArray(g.members)) return;
      g.members.forEach(m => {
        if (!m || !m.id) return;
        // skip current user
        const currentUserName = document.getElementById('user-name')?.textContent || '';
        if (m.username && m.username === currentUserName) return;
        if (!contactsMap.has(m.id)) contactsMap.set(m.id, m);
      });
    });

    allContacts = Array.from(contactsMap.values()).sort((left, right) => (left.username || '').localeCompare(right.username || ''));

    renderGroups(groupsGrid);
    renderContacts();
    setupGroupToggle();
    setupContactsToggle();

    if (allGroupCards.length === 0 && groupsGrid) {
      groupsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #8b949e;">No groups yet. Create one to get started!</p>';
    }

    if (allContacts.length === 0) {
      const contactsGrid = document.getElementById('contacts-grid');
      if (contactsGrid) {
        contactsGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#8b949e">No contacts yet</p>';
      }
    }

  } catch (error) {
  }
}

function renderGroups(groupsGrid = document.getElementById('groups-grid')) {
  if (!groupsGrid) return;

  const groupsToShow = showAllGroups ? allGroupCards : allGroupCards.slice(0, 4);

  if (groupsToShow.length === 0) {
    groupsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #8b949e;">No groups yet. Create one to get started!</p>';
    updateGroupToggle();
    return;
  }

  groupsGrid.innerHTML = '';

  groupsToShow.forEach(group => {
    const card = document.createElement('article');
    card.className = 'group-card';

      // Build member avatars markup (show up to 3 avatars, plus a +N if more)
      let membersHtml = '';
      const currentAvatar = document.getElementById('user-avatar')?.src || '';
      const currentName = document.getElementById('user-name')?.textContent || 'You';

      if (group.members && Array.isArray(group.members) && group.members.length > 0) {
        const show = group.members.slice(0, 3);
        show.forEach((m, idx) => {
          const imgSrc = m.avatar_url || currentAvatar || '/images/default-avatar.png';
          const title = m.username || currentName;
          membersHtml += `<div class="member-avatar" title="${title}"><img src="${imgSrc}" alt="${title}"/></div>`;
        });
        if (group.member_count > show.length) {
          membersHtml += `<div class="member-more">+${group.member_count - show.length}</div>`;
        }
      } else {
        // No members array returned yet — show current user avatar if available, otherwise show count
        if (currentAvatar) {
          membersHtml = `<div class="member-avatar" title="${currentName}"><img src="${currentAvatar}" alt="${currentName}"/></div>`;
          if (group.member_count > 1) {
            membersHtml += `<div class="member-more">+${group.member_count - 1}</div>`;
          }
        } else {
          membersHtml = `<div class="member-more">${group.member_count}</div>`;
        }
      }
         
      card.innerHTML = `
        <div class="card-header">
          <div class="card-title">
            <div class="card-icon">
              <span class="material-symbols-outlined">folder</span>
            </div>
            <h3>${group.name}</h3>
          </div>
          <span class="badge">Private</span>
        </div>
        <p class="card-description">Created on ${new Date(group.created_at).toLocaleDateString()}</p>
        <div class="card-footer">
          <div class="member-avatars">
            ${membersHtml}
          </div>
          <div class="card-stats">
            <div class="stat">
              <span class="material-symbols-outlined stat-icon">group</span>
              ${group.member_count}
            </div>
          </div>
        </div>
      `;
      
      // Add click handler to redirect to group conversation
      
        // Store group ID as data attribute and add click handler to redirect to group conversation
        card.dataset.groupId = group.id;
        card.dataset.groupName = group.name;
        card.style.cursor = 'pointer';
      
      card.addEventListener('click', (e) => {
        const groupId = e.currentTarget.dataset.groupId;
        const groupName = e.currentTarget.dataset.groupName;
        navigateToGroupConversation(groupId, groupName);
      });

      groupsGrid.appendChild(card);
    });

    updateGroupToggle();
  }

  function renderContacts() {
    const contactsGrid = document.getElementById('contacts-grid');
    if (!contactsGrid) return;

    const contactsToShow = showAllContacts ? allContacts : allContacts.slice(0, 5);

    if (contactsToShow.length === 0) {
      contactsGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#8b949e">No contacts yet</p>';
      updateContactsToggle();
      return;
    }

    contactsGrid.innerHTML = '';
    contactsToShow.forEach(c => {
      const card = document.createElement('article');
      card.className = 'contact-card';
      card.innerHTML = `
        <div class="contact-avatar"><img src="${c.avatar_url||'/default-avatar.png'}" alt="${c.username||'User'}"/></div>
        <div class="contact-body">
          <strong>${c.username || 'Unknown'}</strong>
          <div class="contact-meta">${c.username ? `@${c.username}` : ''}</div>
        </div>
      `;
      card.addEventListener('click', () => {
        window.location.href = `/messages?contactId=${encodeURIComponent(c.id)}`;
      });
      contactsGrid.appendChild(card);
    });

    updateContactsToggle();
  }

  function setupGroupToggle() {
    const toggle = document.getElementById('groupsViewToggle');
    if (!toggle) return;

    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      if (allGroupCards.length <= 4) return;
      showAllGroups = !showAllGroups;
      renderGroups();
    });

    updateGroupToggle();
  }

  function updateGroupToggle() {
    const toggle = document.getElementById('groupsViewToggle');
    if (!toggle) return;

    if (allGroupCards.length <= 4) {
      toggle.style.display = 'none';
      return;
    }

    toggle.style.display = '';
    toggle.textContent = showAllGroups ? 'Show less' : 'View all';
  }

  function setupContactsToggle() {
    const toggle = document.getElementById('contactsViewToggle');
    if (!toggle) return;

    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      if (allContacts.length <= 4) return;
      showAllContacts = !showAllContacts;
      renderContacts();
    });

    updateContactsToggle();
  }

  function updateContactsToggle() {
    const toggle = document.getElementById('contactsViewToggle');
    if (!toggle) return;

    if (allContacts.length <= 4) {
      toggle.style.display = 'none';
      return;
    }

    toggle.style.display = '';
    toggle.textContent = showAllContacts ? 'Show less' : 'View all';
}

// Load groups on page load
loadGroups();

// Navigate to group conversation
function navigateToGroupConversation(groupId, groupName) {
  window.location.href = `/messages?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`;
}

// Modal show/hide with simple animation
function showModal() {
  const overlay = document.getElementById('modalOverlay');
  if (!overlay) return;
  const modal = overlay.querySelector('.modal');
  // remove initial hidden state
  overlay.classList.remove('hidden');
  // ensure it's visible for animation
  overlay.style.display = 'flex';
  requestAnimationFrame(() => {
    overlay.classList.add('anim-open');
    if (modal) modal.classList.add('open');
  });
}

function hideModal() {
  const overlay = document.getElementById('modalOverlay');
  if (!overlay) return;
  const modal = overlay.querySelector('.modal');
  if (modal) modal.classList.remove('open');
  overlay.classList.remove('anim-open');
  const onEnd = (e) => {
    if (e.target !== overlay) return;
    overlay.style.display = '';
    overlay.classList.add('hidden');
    overlay.removeEventListener('transitionend', onEnd);
  };
  overlay.addEventListener('transitionend', onEnd);
}

// Open modal - select the "Create Group" button in the topbar
const createGroupBtn = document.querySelector('.topbar-actions .secondary-button');
if (createGroupBtn) {
  createGroupBtn.addEventListener('click', () => {
    showModal();
  });
}

// Close modal function
function closeModal() {
  // clear inputs immediately
  document.getElementById('groupName').value = '';
  document.getElementById('repoName').value = '';
  hideModal();
}

document.getElementById('closeModal')
  .addEventListener('click', closeModal);
  
document.getElementById('cancelBtn')
  .addEventListener('click', closeModal);

// Close when clicking outside
document.getElementById('modalOverlay')
  .addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

// Submit
document.getElementById('submitGroup')
  .addEventListener('click', async () => {
    const submitBtn = document.getElementById('submitGroup');
    const name = document.getElementById('groupName').value.trim();
    const repoFullName = document.getElementById('repoName').value.trim();

    if (!name) {
      alert('Group name is required');
      return;
    }

    // Disable button to prevent double-submit
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Creating...';

    try {
      const response = await fetch('/api/groups/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          repoFullName: repoFullName || null 
        })
      });

      const data = await response.json();

      if (response.ok) {
        alert('Group created successfully!');
        closeModal();
        loadGroups(); // refresh the groups list
      } else {
        alert('Error: ' + (data.error || 'Failed to create group'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
