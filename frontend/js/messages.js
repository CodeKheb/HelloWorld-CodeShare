import { io } from "https://cdn.socket.io/4.5.4/socket.io.esm.min.js";

const socket = io("http://localhost:3000", {
    withCredentials: true
});

socket.on("connect", () => {
    console.log("Connected to server with ID:", socket.id);
    socket.emit("client_ID", socket.id);
});

// group messages 
socket.on("server-group-text", (message) => {
    console.log("Received group message:", message);
    displayMessage(message);
});

// incoming messages
socket.on("server-direct-text", (message) => {
    console.log("Received direct message:", message);
    displayMessage(message);
});

// server errors
socket.on("server-error", (error) => {
    console.error("Server error:", error);
    alert(`Error: ${error.reason}`);
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-route]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const route = e.currentTarget.getAttribute('data-route');
            window.location.href = `${route}`;
        });
    });

    initializeResizablePanel();
    initializeMessagesView();
    initializeMessageComposer();
    initializeSidebar();
    initializeCommitsModal();

    // Allow inline HTML script to refresh panel after attach-repo modal submit
    window.refreshCurrentGroupDetails = async () => {
        if (window.currentGroupId) {
            await loadGroupDetails(window.currentGroupId);
        }
    };
});

async function initializeMessagesView() {
    try {
        const userRes = await fetch('/api/user', {
            credentials: 'include' // Important for sending cookies
        });
        const userData = await userRes.json();

        if (userData.authenticated) {
            document.getElementById('user-avatar').src = userData.user.avatar;
            document.getElementById('user-name').innerText = userData.user.displayName || userData.user.username;
            document.getElementById('user-login').innerText = `@${userData.user.username}`;

            // Store user data
            window.currentUser = userData.user;

            // Load sidebar groups and contacts from the server
            await fetchAndRenderSidebar();

            console.log('User initialized:', window.currentUser);
        }
    } catch (error) {
        console.error("Messages view load failed:", error);
        window.location.href = '/login';
    }
}

// Fetch groups from backend and render up to 5 groups and 5 contacts
async function fetchAndRenderSidebar() {
    try {
        const res = await fetch('/api/groups', { credentials: 'include' });
        if (!res.ok) return console.error('Failed to load groups for sidebar');
        const payload = await res.json();
        const groups = (payload && payload.groups) || [];

        // Render up to 4 groups
        const groupsList = document.getElementById('sidebar-groups');
        if (groupsList) {
            groupsList.innerHTML = '';
            groups.slice(0,4).forEach((g, idx) => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.className = 'sidebar-link';
                a.href = '#';
                a.dataset.groupId = g.id;
                a.innerHTML = `<span class="material-symbols-outlined">tag</span><span>${escapeHtml(g.name)}</span>`;
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    // Update header quickly from the list data (if available)
                    updateGroupHeaderFromMembers(g);
                    selectGroup(g);
                });
                li.appendChild(a);
                groupsList.appendChild(li);
                // Auto-select the first group if none selected yet
                if (idx === 0 && !window.currentGroupId) {
                  // Pre-fill header from fetched list to avoid temporary empty state
                  updateGroupHeaderFromMembers(g);
                  selectGroup(g);
                }
            });
            if (groups.length === 0) {
                groupsList.innerHTML = '<li class="muted" style="padding:8px 12px;color:#8b949e">No groups yet</li>';
            }
        }

        // Build contacts by aggregating members across groups, dedupe by id
        const contactsMap = new Map();
        groups.forEach(g => {
            if (Array.isArray(g.members)) {
                g.members.forEach(m => {
                    if (!m || !m.id) return;
                    if (m.id === window.currentUser.id) return; // skip self
                    if (!contactsMap.has(m.id)) contactsMap.set(m.id, m);
                });
            }
        });

        const contacts = Array.from(contactsMap.values()).slice(0,4);
        const contactsList = document.getElementById('sidebar-contacts');
        if (contactsList) {
            contactsList.innerHTML = '';
            contacts.forEach(c => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.className = 'sidebar-link';
                a.href = '#';
                const avatar = `<div class="avatar avatar--small"><img src="${escapeAttr(c.avatar_url || '/default-avatar.png')}" alt="${escapeAttr(c.username)}"/></div>`;
                a.innerHTML = `${avatar}<span>${escapeHtml(c.username)}</span>`;
                li.appendChild(a);
                contactsList.appendChild(li);
            });
            if (contacts.length === 0) contactsList.innerHTML = '<li class="muted" style="padding:8px 12px;color:#8b949e">No contacts yet</li>';
        }
    } catch (err) {
        console.error('Error populating sidebar:', err);
    }
}

// Update the header avatar stack and member count using available group data
function updateGroupHeaderFromMembers(group) {
    if (!group) return;
    const members = Array.isArray(group.members) ? group.members : [];
    const stack = document.querySelector('.avatar-stack');
    if (stack) {
        stack.innerHTML = '';
        const show = members.slice(0,3);
        show.forEach(m => {
            const img = document.createElement('img');
            img.className = 'avatar avatar--stacked';
            img.alt = m.username || m.id || 'member';
            img.src = m.avatar_url || '/default-avatar.png';
            stack.appendChild(img);
        });
        if (members.length > show.length) {
            const more = document.createElement('div');
            more.className = 'avatar avatar-more';
            more.textContent = `+${members.length - show.length}`;
            stack.appendChild(more);
        }
    }
    const countEl = document.querySelector('.member-count');
    if (countEl) {
        const count = members.length || (group.member_count ? Number(group.member_count) : 0);
        countEl.textContent = `${count} members`;
    }
}

async function selectGroup(group) {
    if (!group) return;
    // Leave previous group if set
    if (window.currentGroupId) socket.emit('leave-group', window.currentGroupId);
    window.currentGroupId = group.id;
    // Update header UI
    const titleEl = document.querySelector('.chat-channel');
    if (titleEl) titleEl.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">tag</span> ${escapeHtml(group.name)}`;
    // Emit join
    socket.emit('join-group', group.id);

    // Load persisted history for this group
    await Promise.all([
        loadGroupMessages(group.id),
        loadGroupDetails(group.id)
    ]);
}

async function loadGroupDetails(groupId) {
    try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            console.error('Failed to load group details');
            return;
        }

        const payload = await response.json();
        const group = payload?.group;
        if (!group) return;

        const members = Array.isArray(group.members) ? group.members : [];
        const repos = Array.isArray(group.repos) ? group.repos : [];

        // Keep header in sync with full group details
        updateGroupHeaderFromMembers({ ...group, members });

        const introTitle = document.querySelector('.group-panel__intro h3');
        if (introTitle) introTitle.textContent = group.name || 'Group';

        const introText = document.querySelector('.group-panel__intro p');
        if (introText) {
            introText.textContent = repos.length > 0
                ? `${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'} linked to this group.`
                : 'No repository linked yet. Attach one to start receiving repository updates.';
        }

        renderMemberList(members);
        renderRepoList(repos);
    } catch (error) {
        console.error('Error loading group details:', error);
    }
}

function renderMemberList(members) {
    const list = document.getElementById('group-member-list') || document.querySelector('.member-list');
    if (!list) return;

    list.innerHTML = '';

    if (!members || members.length === 0) {
        list.innerHTML = '<li class="member-item"><span class="member-muted">No members found.</span></li>';
        return;
    }

    members.forEach((m) => {
        const li = document.createElement('li');
        li.className = 'member-item';
        li.innerHTML = `
            <div class="status-avatar">
                <img alt="${escapeAttr(m.username || 'Member')}" class="avatar avatar--small" src="${escapeAttr(m.avatar_url || '/default-avatar.png')}"/>
                <span class="presence-dot presence-dot--online"></span>
            </div>
            <span>${escapeHtml(m.username || 'Unknown')}</span>
        `;
        list.appendChild(li);
    });
}

function renderRepoList(repos) {
    const list = document.getElementById('group-repo-list') || document.querySelector('.repo-list');
    if (!list) return;

    list.innerHTML = '';

    if (!repos || repos.length === 0) {
        list.innerHTML = '<article class="repo-card"><div class="repo-card__title"><span class="material-symbols-outlined" aria-hidden="true">folder_off</span><span>No attached repositories</span></div><div class="repo-card__meta">Attach one from the header button</div></article>';
        return;
    }

    repos.forEach((repo) => {
        const card = document.createElement('article');
        card.className = 'repo-card';
        const addedAt = repo.added_at ? new Date(repo.added_at).toLocaleDateString() : 'Recently';
        card.innerHTML = `
            <div class="repo-card__content">
                <div class="repo-card__title">
                    <span class="material-symbols-outlined" aria-hidden="true">folder</span>
                    <span>${escapeHtml(repo.repo_full_name)}</span>
                </div>
                <div class="repo-card__meta">Added ${escapeHtml(addedAt)}</div>
            </div>
            <div class="repo-card__actions">
                <button class="repo-card__download" aria-label="Download repository" title="Download as ZIP">
                    <span class="material-symbols-outlined" aria-hidden="true">download</span>
                </button>
            </div>
        `;
        const downloadBtn = card.querySelector('.repo-card__download');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const [owner, repoName] = repo.repo_full_name.split('/');
            const downloadUrl = `https://github.com/${owner}/${repoName}/archive/HEAD.zip`;
            window.location.href = downloadUrl;
        });
        card.addEventListener('click', () => {
            window.open(`https://github.com/${escapeHtml(repo.repo_full_name)}`, '_blank');
        });
        list.appendChild(card);
    });
}

// small helpers for escaping attributes
function escapeAttr(s) {
    if (!s) return '';
    return String(s).replace(/"/g, '&quot;');
}

function initializeMessageComposer() {
    const sendButton = document.querySelector('.composer__send');
    const messageInput = document.querySelector('.composer__input');

    if (!sendButton || !messageInput) {
        console.error('Composer elements not found');
        return;
    }

    sendButton.addEventListener('click', () => {
        sendMessage(messageInput.value);
    });

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(messageInput.value);
        }
    });

    function sendMessage(text) {
        if (!text.trim()) return;

        if (!window.currentGroupId) {
            alert('Please select a group first');
            return;
        }

        if (!window.currentUser) {
            alert('Please log in to send messages');
            return;
        }

        // Send to active group. The server persists and broadcasts the saved message.
        socket.emit("client-message", {
            text: text.trim(),
            groupId: window.currentGroupId
        });

        // Clear input
        messageInput.value = '';
        messageInput.style.height = 'auto';
    }
}

async function loadGroupMessages(groupId) {
    try {
        const messageFeed = document.querySelector('.message-feed');
        if (!messageFeed) return;

        messageFeed.innerHTML = '';

        const response = await fetch(`/api/messages/group/${encodeURIComponent(groupId)}?limit=100`, {
            credentials: 'include'
        });

        if (!response.ok) {
            console.error('Failed to load group messages');
            return;
        }

        const payload = await response.json();
        const messages = Array.isArray(payload.messages) ? payload.messages : [];

        messages.forEach((m) => {
            displayMessage({
                id: m.id,
                text: m.content,
                type: m.type,
                timestamp: m.created_at,
                author: m.sender_username || 'Unknown',
                authorName: m.sender_username || 'Unknown',
                avatar: m.sender_avatar_url || '/default-avatar.png',
                senderId: m.sender_id
            });
        });
    } catch (error) {
        console.error('Error loading persisted messages:', error);
    }
}


function displayMessage(messageData) {
    const messageFeed = document.querySelector('.message-feed');

    if (!messageFeed) {
        console.error('Message feed not found');
        return;
    }

    const messageElement = document.createElement('article');
    messageElement.className = 'message message--standard';

    const now = new Date(messageData.timestamp || Date.now());
    const timeString = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    messageElement.innerHTML = `
        <img alt="${escapeHtml(messageData.authorName || messageData.author)}" 
             class="avatar avatar--message" 
             src="${messageData.fromAvatar || messageData.avatar || '/default-avatar.png'}"/>
        <div class="message__body">
            <div class="message__meta">
                <span class="message__author">${escapeHtml(messageData.authorName || messageData.from || messageData.author)}</span>
                <span class="message__time">${timeString}</span>
            </div>
            <p class="message__text">${escapeHtml(messageData.text)}</p>
        </div>
    `;

    messageFeed.appendChild(messageElement);

    // Scroll to bottom
    messageFeed.scrollTop = messageFeed.scrollHeight;
}


function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getReceiverSocketId() {
    // TODO: receiver socket ID 
    return null;
}

function initializeResizablePanel() {
    // Intentionally left empty; resizing is handled in-page (messages.html) to keep behavior local to the document.
}

function initializeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (!sidebar || !toggleBtn) {
        console.warn('Sidebar or toggle button not found');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    const openSidebar = () => {
        sidebar.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    const closeSidebar = () => {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    };

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.contains('active') ? closeSidebar() : openSidebar();
    });

    overlay.addEventListener('click', closeSidebar);

    sidebar.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
}

// Add after the initializeSidebar function

let selectedCommits = new Set();

function initializeCommitsModal() {
    const summarizeBtn = document.querySelector('.primary-button.action-button');
    const commitsOverlay = document.getElementById('commitsOverlay');
    const closeBtn = document.getElementById('closeCommits');
    const repoSelect = document.getElementById('commitRepoSelect');
    const compareBtn = document.getElementById('compareCommitsBtn');

    if (!summarizeBtn || !commitsOverlay) {
        console.warn('Summarize button or commits overlay not found');
        return;
    }

    // Open commits modal when Summarize is clicked
    summarizeBtn.addEventListener('click', () => {
        if (!window.currentGroupId) {
            alert('Please select a group first');
            return;
        }
        showCommitsModal();
    });

    // Close modal
    closeBtn?.addEventListener('click', hideCommitsModal);
    commitsOverlay?.addEventListener('click', (e) => {
        if (e.target.id === 'commitsOverlay') hideCommitsModal();
    });

    // Repository selection
    repoSelect?.addEventListener('change', async (e) => {
        const repoFullName = e.target.value;
        if (repoFullName) {
            await loadCommits(repoFullName);
        } else {
            hideCommitsContainer();
        }
    });

    // Compare commits button
    compareBtn?.addEventListener('click', async () => {
        const commits = Array.from(selectedCommits);
        if (commits.length !== 2) {
            alert('Please select exactly 2 commits to compare');
            return;
        }
        await compareCommits(commits[0], commits[1]);
    });
}

function showCommitsModal() {
    const overlay = document.getElementById('commitsOverlay');
    if (!overlay) return;

    // Reset state
    selectedCommits.clear();
    document.getElementById('commitRepoSelect').value = '';
    hideCommitsContainer();

    // Load repositories for the current group
    loadGroupRepositories();

    const modal = overlay.querySelector('.modal');
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
        overlay.classList.add('anim-open');
        if (modal) modal.classList.add('open');
    });
}

function hideCommitsModal() {
    const overlay = document.getElementById('commitsOverlay');
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

async function loadGroupRepositories() {
    try {
        const response = await fetch(`/api/groups/${encodeURIComponent(window.currentGroupId)}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to load group details');
        }

        const payload = await response.json();
        const repos = Array.isArray(payload?.group?.repos) ? payload.group.repos : [];

        const repoSelect = document.getElementById('commitRepoSelect');
        if (!repoSelect) return;

        // Clear and populate select
        repoSelect.innerHTML = '<option value="">-- Select a repository --</option>';
        
        repos.forEach(repo => {
            const option = document.createElement('option');
            option.value = repo.repo_full_name;
            option.textContent = repo.repo_full_name;
            repoSelect.appendChild(option);
        });

        if (repos.length === 0) {
            repoSelect.innerHTML = '<option value="">No repositories attached</option>';
        }
    } catch (error) {
        console.error('Error loading repositories:', error);
        showCommitsError('Failed to load repositories');
    }
}

async function loadCommits(repoFullName) {
    const [owner, repo] = repoFullName.split('/');
    
    if (!owner || !repo) {
        showCommitsError('Invalid repository name');
        return;
    }

    showCommitsLoading();
    hideCommitsError();
    selectedCommits.clear();

    try {
        const response = await fetch(`/api/repos/${owner}/${repo}/commits?per_page=20`, {
            credentials: 'include'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch commits');
        }

        const data = await response.json();
        displayCommits(data.commits, repoFullName);
    } catch (error) {
        console.error('Error loading commits:', error);
        showCommitsError(error.message);
    } finally {
        hideCommitsLoading();
    }
}

function displayCommits(commits, repoFullName) {
    const container = document.getElementById('commitsContainer');
    const list = document.getElementById('commitsList');
    const repoNameEl = document.getElementById('selectedRepoName');

    if (!container || !list || !repoNameEl) return;

    // Update header
    repoNameEl.innerHTML = `<span class="material-symbols-outlined">folder</span>${escapeHtml(repoFullName)}`;

    // Clear list
    list.innerHTML = '';

    if (!commits || commits.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No commits found</p></div>';
        container.classList.remove('hidden');
        return;
    }

    // Render commits
    commits.forEach(commit => {
        const item = createCommitElement(commit, repoFullName);
        list.appendChild(item);
    });

    container.classList.remove('hidden');
    updateCompareButton();
}

function createCommitElement(commit, repoFullName) {
    const div = document.createElement('div');
    div.className = 'commit-item';
    div.dataset.sha = commit.sha;
    div.dataset.repo = repoFullName;

    const shortSha = commit.sha.substring(0, 7);
    const commitDate = new Date(commit.author.date);
    const timeAgo = getTimeAgo(commitDate);

    div.innerHTML = `
        <div class="commit-checkbox">
            <input type="checkbox" data-sha="${commit.sha}" aria-label="Select commit ${shortSha}">
        </div>
        <div class="commit-avatar">
            <img src="${escapeAttr(commit.author.avatar_url || '/default-avatar.png')}" 
                 alt="${escapeAttr(commit.author.name)}">
        </div>
        <div class="commit-content">
            <p class="commit-message">${escapeHtml(commit.message.split('\n')[0])}</p>
            <div class="commit-meta">
                <span class="commit-author">${escapeHtml(commit.author.name)}</span>
                <span class="commit-sha">${shortSha}</span>
                <span class="commit-date">
                    <span class="material-symbols-outlined" style="font-size: 1rem;">schedule</span>
                    ${timeAgo}
                </span>
            </div>
        </div>
    `;

    // Handle checkbox selection
    const checkbox = div.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', (e) => {
        const sha = e.target.dataset.sha;
        
        if (e.target.checked) {
            if (selectedCommits.size >= 2) {
                e.target.checked = false;
                alert('You can only select 2 commits to compare');
                return;
            }
            selectedCommits.add(sha);
            div.classList.add('selected');
        } else {
            selectedCommits.delete(sha);
            div.classList.remove('selected');
        }
        
        updateCompareButton();
    });

    return div;
}

function updateCompareButton() {
    const compareBtn = document.getElementById('compareCommitsBtn');
    if (!compareBtn) return;

    if (selectedCommits.size === 2) {
        compareBtn.disabled = false;
        compareBtn.textContent = 'Compare Selected';
    } else {
        compareBtn.disabled = true;
        compareBtn.textContent = `Compare Selected (${selectedCommits.size}/2)`;
    }
}

async function compareCommits(sha1, sha2) {
    const repoFullName = document.getElementById('commitRepoSelect').value;
    const [owner, repo] = repoFullName.split('/');

    if (!owner || !repo) return;

    try {
        // Fetch both commits
        const [commit1Response, commit2Response] = await Promise.all([
            fetch(`/api/repos/${owner}/${repo}/commits/${sha1}`, { credentials: 'include' }),
            fetch(`/api/repos/${owner}/${repo}/commits/${sha2}`, { credentials: 'include' })
        ]);

        if (!commit1Response.ok || !commit2Response.ok) {
            throw new Error('Failed to fetch commit details');
        }

        const commit1 = await commit1Response.json();
        const commit2 = await commit2Response.json();

        // Display diff in message feed
        displayCommitDiff(commit1, commit2, repoFullName);

        // Close modal
        hideCommitsModal();
    } catch (error) {
        console.error('Error comparing commits:', error);
        alert('Failed to compare commits: ' + error.message);
    }
}

function displayCommitDiff(commit1, commit2, repoFullName) {
    const messageFeed = document.querySelector('.message-feed');
    if (!messageFeed) return;

    const diffElement = document.createElement('article');
    diffElement.className = 'message message--diff';

    const shortSha1 = commit1.sha.substring(0, 7);
    const shortSha2 = commit2.sha.substring(0, 7);

    // Calculate total stats
    const totalAdditions = commit1.stats.additions + commit2.stats.additions;
    const totalDeletions = commit1.stats.deletions + commit2.stats.deletions;

    // Get unique files from both commits
    const filesMap = new Map();
    
    commit1.files.forEach(file => {
        filesMap.set(file.filename, { ...file, commit: 1 });
    });
    
    commit2.files.forEach(file => {
        if (filesMap.has(file.filename)) {
            const existing = filesMap.get(file.filename);
            filesMap.set(file.filename, {
                ...file,
                commit: 'both',
                patch: `${existing.patch || ''}\n\n${file.patch || ''}`
            });
        } else {
            filesMap.set(file.filename, { ...file, commit: 2 });
        }
    });

    const filesHtml = Array.from(filesMap.values()).map(file => `
        <div class="diff-file">
            <div class="diff-file-header">
                ${escapeHtml(file.filename)}
                <span style="margin-left: 1rem; color: #8b949e;">
                    ${file.status} 
                    (+${file.additions} -${file.deletions})
                </span>
            </div>
            <div class="diff-file-content">
                ${formatPatch(file.patch)}
            </div>
        </div>
    `).join('');

    diffElement.innerHTML = `
        <div class="diff-header">
            <div class="diff-title">
                <span class="material-symbols-outlined" style="vertical-align: middle;">compare_arrows</span>
                Comparing commits in ${escapeHtml(repoFullName)}
                <br>
                <small style="color: #8b949e; font-weight: 400;">
                    ${shortSha1} (${escapeHtml(commit1.message.split('\n')[0])}) 
                    ↔ 
                    ${shortSha2} (${escapeHtml(commit2.message.split('\n')[0])})
                </small>
            </div>
            <div class="diff-stats">
                <span class="diff-stat diff-stat--additions">
                    +${totalAdditions}
                </span>
                <span class="diff-stat diff-stat--deletions">
                    -${totalDeletions}
                </span>
            </div>
        </div>
        <div class="diff-files">
            ${filesHtml}
        </div>
    `;

    messageFeed.appendChild(diffElement);
    messageFeed.scrollTop = messageFeed.scrollHeight;
}

function formatPatch(patch) {
    if (!patch) return '<div class="diff-line diff-line--context">No changes</div>';
    
    return patch.split('\n').map(line => {
        if (line.startsWith('+')) {
            return `<div class="diff-line diff-line--addition">${escapeHtml(line)}</div>`;
        } else if (line.startsWith('-')) {
            return `<div class="diff-line diff-line--deletion">${escapeHtml(line)}</div>`;
        } else {
            return `<div class="diff-line diff-line--context">${escapeHtml(line)}</div>`;
        }
    }).join('');
}

function showCommitsLoading() {
    document.getElementById('commitsLoading')?.classList.remove('hidden');
    document.getElementById('commitsContainer')?.classList.add('hidden');
}

function hideCommitsLoading() {
    document.getElementById('commitsLoading')?.classList.add('hidden');
}

function showCommitsError(message) {
    const errorEl = document.getElementById('commitsError');
    const errorText = document.getElementById('commitsErrorText');
    if (errorEl && errorText) {
        errorText.textContent = message;
        errorEl.classList.remove('hidden');
    }
}

function hideCommitsError() {
    document.getElementById('commitsError')?.classList.add('hidden');
}

function hideCommitsContainer() {
    document.getElementById('commitsContainer')?.classList.add('hidden');
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return `${interval} ${unit}${interval !== 1 ? 's' : ''} ago`;
        }
    }
    
    return 'just now';
}

