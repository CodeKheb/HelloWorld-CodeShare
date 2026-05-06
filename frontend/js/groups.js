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
    console.error('Sidebar load failed:', error);
    window.location.href = '/login';
  }
}

initializeSidebar();

// Load groups from backend
async function loadGroups() {
  try {
    const response = await fetch('/api/groups', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load groups');
      return;
    }

    const data = await response.json();
    const groupsGrid = document.getElementById('groups-grid');
    const groups = (data.groups || []).filter(g => !g.is_direct);

    if (groups.length === 0) {
      groupsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #8b949e;">No groups yet. Create one to get started!</p>';
      return;
    }

    // Clear existing groups
    groupsGrid.innerHTML = '';

    // Render each group as a card
    groups.forEach(group => {
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
          console.log('Clicked group:', groupId, groupName);
          navigateToGroupConversation(groupId, groupName);
        });
      
      groupsGrid.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading groups:', error);
  }
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
        console.log('Group created:', data.group);
        alert('Group created successfully!');
        closeModal();
        loadGroups(); // refresh the groups list
      } else {
        alert('Error: ' + (data.error || 'Failed to create group'));
      }
    } catch (error) {
      console.error('Error creating group:', error);
      alert('Error: ' + error.message);
    } finally {
      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
