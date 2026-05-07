/**
 * ========================================
 * MODAL HANDLERS
 * ========================================
 * 
 * This module contains handlers for specific modal operations.
 * Each modal has its own setup function that registers event listeners
 * and handles form submissions.
 */

// ── CREATE GROUP MODAL ────────────────────────────────────────

/**
 * Initialize Create Group Modal
 * @param {Function} onSuccess - Callback function when group is created successfully
 */
function groupModalSwitchTab(tab) {
    const isCreate = tab === 'create';
    document.getElementById('groupPaneCreate').style.display = isCreate ? '' : 'none';
    document.getElementById('groupPaneCreateFooter').style.display = isCreate ? '' : 'none';
    document.getElementById('groupPaneJoin').style.display = isCreate ? 'none' : '';
    document.getElementById('groupPaneJoinFooter').style.display = isCreate ? 'none' : '';
    document.getElementById('groupModalTitle').textContent = isCreate ? 'Create Group' : 'Join Group';
    document.getElementById('tabCreate').style.cssText = `flex:1;padding:10px;background:none;border:none;border-bottom:2px solid ${isCreate ? '#3fb950;color:#3fb950' : 'transparent;color:#8b949e'};font-weight:600;cursor:pointer;font-size:0.875rem;`;
    document.getElementById('tabJoin').style.cssText = `flex:1;padding:10px;background:none;border:none;border-bottom:2px solid ${isCreate ? 'transparent;color:#8b949e' : '#3fb950;color:#3fb950'};font-weight:600;cursor:pointer;font-size:0.875rem;`;
}


function initCreateGroupModal(onSuccess) {
    const modalId = 'createGroupModal';
    const fieldIds = ['groupNameInput', 'groupRepoInput'];

    // Replace the registerOpenButton line inside registerModal with manual wiring:
    document.getElementById('newGroupSidebarBtn')?.addEventListener('click', () => {
        groupModalSwitchTab('create');
        ModalManager.open('createGroupModal');
    });
    ModalManager.registerCloseButton('closeCreateGroupModal', 'createGroupModal', fieldIds);
    ModalManager.registerOverlayClose('createGroupModal', fieldIds);
    ModalManager.registerEscapeKey('createGroupModal', fieldIds);
    
    // Also register cancel button
    document.getElementById('cancelCreateGroupBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        ModalManager.reset(modalId, fieldIds);
    });

    // Handle form submission
    document.getElementById('submitCreateGroupBtn')?.addEventListener('click', async () => {
        const submitBtn = document.getElementById('submitCreateGroupBtn');
        const name = document.getElementById('groupNameInput').value.trim();
        const repoFullName = document.getElementById('groupRepoInput').value.trim();

        // Validation
        if (!name) {
            alert('Group name is required');
            return;
        }

        // Show loading state
        ModalManager.setButtonLoading(submitBtn, true, 'Creating...');

        try {
            const res = await fetch('/api/groups/create', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    repoFullName: repoFullName || null
                })
            });

            const data = await res.json();

            if (res.ok) {
                window.location.reload()
                alert('Group created successfully!');
                ModalManager.reset(modalId, fieldIds);
                
                // Call success callback if provided
                if (onSuccess) onSuccess(data.group);
            } else {
                alert('Error: ' + (data.error || 'Failed to create group'));
            }
        } catch (err) {
            console.error('Error creating group:', err);
            alert('Error: ' + err.message);
        } finally {
            ModalManager.setButtonLoading(submitBtn, false);
        }
    });
}

// ── CREATE REPOSITORY MODAL ───────────────────────────────────

/**
 * Initialize Create Repository Modal
 * @param {Function} onSuccess - Callback function when repo is created successfully
 */
function initCreateRepoModal(onSuccess) {
    const modalId = 'createRepoModal';
    const fieldIds = [
        'repoNameInput',
        'repoDescriptionInput',
        'repoPrivateCheckbox',
        'repoAutoInitCheckbox',
        'repoGitignoreSelect',
        'repoLicenseSelect'
    ];

    // Register standard modal controls
    ModalManager.registerModal(
        modalId,
        'newRepoSidebarBtn',       // open button
        'closeCreateRepoModal',    // close button
        fieldIds                   // fields to clear on close
    );

    // Also register cancel button
    document.getElementById('cancelCreateRepoBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        ModalManager.reset(modalId, fieldIds);
    });

    // Handle form submission
    document.getElementById('submitCreateRepoBtn')?.addEventListener('click', async () => {
        const submitBtn = document.getElementById('submitCreateRepoBtn');
        const name = document.getElementById('repoNameInput').value.trim();
        const description = document.getElementById('repoDescriptionInput').value.trim();
        const isPrivate = document.getElementById('repoPrivateCheckbox').checked;
        const autoInit = document.getElementById('repoAutoInitCheckbox').checked;
        const gitignore = document.getElementById('repoGitignoreSelect').value;
        const license = document.getElementById('repoLicenseSelect').value;

        // Validation
        if (!name) {
            alert('Repository name is required');
            return;
        }

        // Show loading state
        ModalManager.setButtonLoading(submitBtn, true, 'Creating...');

        try {
            const res = await fetch('/api/repos/create', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    description: description || undefined,
                    private: isPrivate,
                    auto_init: autoInit,
                    gitignore_template: gitignore || undefined,
                    license_template: license || undefined
                })
            });

            const data = await res.json();

            if (res.ok) {
                alert('Repository created successfully!');
                ModalManager.reset(modalId, fieldIds);
                
                // Call success callback if provided
                if (onSuccess) onSuccess(data);
            } else {
                alert('Error: ' + (data.error || 'Failed to create repository'));
            }
        } catch (err) {
            console.error('Error creating repository:', err);
            alert('Error: ' + err.message);
        } finally {
            ModalManager.setButtonLoading(submitBtn, false);
        }
    });
}

// ── JOIN GROUP MODAL ──────────────────────────────────────────

/**
 * Initialize Join Group Modal
 * @param {Function} onSuccess - Callback function when group is joined successfully
 */
function initJoinGroupModal(onSuccess) {
    const modalId = 'joinGroupModal';
    const fieldIds = ['joinGroupCodeInput'];

    // Join btn opens the combined modal on the Join tab
    document.getElementById('joinGroupSidebarBtn')?.addEventListener('click', () => {
        groupModalSwitchTab('join');
        ModalManager.open('createGroupModal');
    });
    ModalManager.registerCloseButton('closeJoinGroupModal', 'createGroupModal', fieldIds);
    ModalManager.registerOverlayClose('createGroupModal', fieldIds);
    ModalManager.registerEscapeKey('createGroupModal', fieldIds);    // Also register cancel button

    document.getElementById('cancelJoinGroupBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        ModalManager.reset(modalId, fieldIds);
    });

    // Handle form submission
    document.getElementById('submitJoinGroupBtn')?.addEventListener('click', async () => {
        const submitBtn = document.getElementById('submitJoinGroupBtn');
        const inviteCode = document.getElementById('joinGroupCodeInput').value.trim();

        // Validation
        if (!inviteCode) {
            alert('Invite code is required');
            return;
        }

        // Show loading state
        ModalManager.setButtonLoading(submitBtn, true, 'Joining...');

        try {
            const res = await fetch(`/api/groups/join/${encodeURIComponent(inviteCode)}`, {
                method: 'POST',
                credentials: 'include'
            });

            const data = await res.json();

            if (res.ok) {
                window.location.reload()
                alert('Joined group successfully!');
                ModalManager.reset(modalId, fieldIds);
                
                // Call success callback if provided
                if (onSuccess) onSuccess(data);
            } else {
                alert('Error: ' + (data.error || 'Failed to join group'));
            }
        } catch (err) {
            console.error('Error joining group:', err);
            alert('Error: ' + err.message);
        } finally {
            ModalManager.setButtonLoading(submitBtn, false);
        }
    });
}

// handler to show craete group modal
function showModal() {
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return;
    const modal = overlay.querySelector('.modal');
    overlay.classList.remove('hidden');
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

// Create group button
document.getElementById('createGroupBtn')?.addEventListener('click', showModal);

// Modal close buttons
document.getElementById('closeModal')?.addEventListener('click', hideModal);
document.getElementById('cancelBtn')?.addEventListener('click', hideModal);
document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') hideModal();
});

// Submit handler
document.getElementById('submitGroup')?.addEventListener('click', async () => {
    const btn = document.getElementById('submitGroup');
    const name = document.getElementById('groupName').value.trim();
    const repoFullName = document.getElementById('repoName').value.trim();
    if (!name) return alert('Group name is required');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Creating...';
    try {
        const res = await fetch('/api/groups/create', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, repoFullName: repoFullName || null })
        });
        const data = await res.json();
        if (res.ok) {
            alert('Group created');
            document.getElementById('groupName').value = '';
            document.getElementById('repoName').value = '';
            hideModal();
            loadGroups();
        } else {
            alert('Error: ' + (data.error || 'Failed'));
        }
    } catch (err) {
        console.error(err);
        alert('Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
});

// Sidebar toggle
(function () {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!toggle || !sidebar || !overlay) return;

    function openSidebar() {
        sidebar.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    toggle.addEventListener('click', () => {
        sidebar.classList.contains('active') ? closeSidebar() : openSidebar();
    });

    overlay.addEventListener('click', closeSidebar);

    // Close sidebar when link is clicked
    document.querySelectorAll('.sidebar-link').forEach((link) => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
})();

// ── ATTACH REPOSITORY MODAL ───────────────────────────────────

/**
 * Initialize Attach Repository Modal
 * @param {Function} onSuccess - Callback function when repo is attached successfully
 */
function initAttachRepoModal(onSuccess) {
    const modalId = 'attachRepoModal';
    const fieldIds = ['attachRepoNameInput'];

    // Register standard modal controls
    ModalManager.registerModal(
        modalId,
        'attachRepoSidebarBtn',    // open button
        'closeAttachRepoModal',    // close button
        fieldIds                   // fields to clear on close
    );

    // Also register cancel button
    document.getElementById('cancelAttachRepoBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        ModalManager.reset(modalId, fieldIds);
    });

    // Handle form submission
    document.getElementById('submitAttachRepoBtn')?.addEventListener('click', async () => {
        const submitBtn = document.getElementById('submitAttachRepoBtn');
        const repoFullName = document.getElementById('attachRepoNameInput').value.trim();

        // Validation
        if (!repoFullName) {
            alert('Repository is required');
            return;
        }

        // Get current group ID (should be set globally or passed via data attribute)
        const groupId = window.currentGroupId;
        if (!groupId) {
            alert('Please select a group first');
            return;
        }

        // Show loading state
        ModalManager.setButtonLoading(submitBtn, true, 'Attaching...');

        try {
            const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/repos`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoFullName })
            });

            const data = await res.json();

            if (res.ok) {
                alert('Repository attached successfully!');
                ModalManager.reset(modalId, fieldIds);
                
                // Call success callback if provided
                if (onSuccess) onSuccess(data);
            } else {
                alert('Error: ' + (data.error || 'Failed to attach repository'));
            }
        } catch (err) {
            console.error('Error attaching repository:', err);
            alert('Error: ' + err.message);
        } finally {
            ModalManager.setButtonLoading(submitBtn, false);
        }
    });
    
}
// ── Auto-initialize all modals ────────────────────────────────

// ── Messages Settings Dropdown ────────────────────────
function initSettingsDropdown() {
    const btn = document.getElementById('settingsButton');
    const menu = document.getElementById('settingsDropdown');
    const backdrop = document.getElementById('settingsBackdrop');
    const logoutBtn = document.getElementById('logoutButton');

    if (!btn || !menu || !backdrop) return;

    function open() {
        menu.classList.add('show');
        backdrop.classList.add('show');
    }

    function close() {
        menu.classList.remove('show');
        backdrop.classList.remove('show');
    }

    btn.addEventListener('click', () => {
        menu.classList.contains('show') ? close() : open();
    });

    backdrop.addEventListener('click', close);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#settingsDropdown') && !e.target.closest('#settingsButton')) {
            close();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/auth/logout', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (res.ok) {
                    if (typeof clearKeyCache === 'function') clearKeyCache();
                    if (typeof roomSecrets !== 'undefined' && roomSecrets instanceof Map) roomSecrets.clear();
                    window.location.href = '/login';
                } else {
                    const data = await res.json();
                    alert(data.message || 'Logout failed. Please try again.');
                }
            } catch (err) {
                console.error('Logout error:', err);
                alert('An error occurred during logout. Please try again.');
            }
        });
    }
}




/**
 * Initialize all modals on page load
 * Call this function after loading modals.html
 */
function initializeAllModals() {
    if (window._modalHandlersInitialized) return;
    window._modalHandlersInitialized = true;

    // Initialize each modal with optional success callbacks
    initCreateGroupModal(() => {
        // Refresh group list if function is available
        if (typeof loadGroups === 'function') loadGroups();
    });

    initCreateRepoModal(() => {
        // Refresh repo list if function is available
        if (typeof renderRepos === 'function') {
            renderRepos(false);
        }
    });

    initJoinGroupModal(() => {
        // Refresh group list if function is available
        if (typeof loadGroups === 'function') loadGroups();
    });

    initAttachRepoModal(() => {
        // Refresh group details if function is available
        if (typeof refreshCurrentGroupDetails === 'function') {
            refreshCurrentGroupDetails();
        }
    });
}
