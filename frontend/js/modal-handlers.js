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
function initCreateGroupModal(onSuccess) {
    const modalId = 'createGroupModal';
    const fieldIds = ['groupNameInput', 'groupRepoInput'];

    // Register standard modal controls
    ModalManager.registerModal(
        modalId,
        'newGroupSidebarBtn',      // open button
        'closeCreateGroupModal',   // close button
        fieldIds                   // fields to clear on close
    );

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

    // Register standard modal controls
    ModalManager.registerModal(
        modalId,
        'joinGroupSidebarBtn',     // open button
        'closeJoinGroupModal',     // close button
        fieldIds                   // fields to clear on close
    );

    // Also register cancel button
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

/**
 * Initialize all modals on page load
 * Call this function after loading modals.html
 */
function initializeAllModals() {
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
