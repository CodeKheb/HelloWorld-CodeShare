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
            <div class="repo-card__title">
                <span class="material-symbols-outlined" aria-hidden="true">folder</span>
                <span>${escapeHtml(repo.repo_full_name)}</span>
            </div>
            <div class="repo-card__meta">Added ${escapeHtml(addedAt)}</div>
        `;
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
