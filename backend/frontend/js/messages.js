import { io } from "https://cdn.socket.io/4.5.4/socket.io.esm.min.js";
import { encryptMessage, 
    decryptMessage, 
    clearKeyCache } from './encryption.js';

// Room secrets stored in memory only — never persisted
const roomSecrets = new Map();

async function fetchRoomSecret(groupId) {
    if (roomSecrets.has(groupId)) return roomSecrets.get(groupId);

    const res = await fetch(`/api/auth/room-secret/${groupId}`, {
        credentials: 'include'
    });

    if (!res.ok) throw new Error('Failed to fetch room secret');

    const { roomSecret } = await res.json();
    roomSecrets.set(groupId, roomSecret);
    return roomSecret;
}

// Determine socket URL based on current environment
const getSocketUrl = () => {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // Local development
        return `http://${window.location.hostname}:${window.location.port || 3000}`;
    }
    // Production
    return window.location.origin;
};

const socket = io("https://helloworld-codeshare.onrender.com", {
    withCredentials: true
});

window.pendingSubscribeGroupIds = new Set();
window.pendingSubscribeDmIds = new Set();
window.unreadSidebarGroupIds = new Set();
window.unreadSidebarDmGroupIds = new Set();

// Member list toggle state
let allGroupMembers = [];
let showAllMembers = false;

function emitPendingSubscriptions() {
    if (!socket || !socket.connected) return;
    window.pendingSubscribeGroupIds.forEach((groupId) => socket.emit('subscribe-group', groupId));
    window.pendingSubscribeDmIds.forEach((dmGroupId) => socket.emit('subscribe-dm', dmGroupId));
}

socket.on("connect", () => {
    socket.emit("client_ID", socket.id);
    emitPendingSubscriptions();
});

// Connection errors (useful when testing locally)
socket.on('connect_error', (err) => {
    console.error('Socket connect_error:', err && err.message ? err.message : err);
});
socket.on('error', (err) => {
    console.error('Socket error:', err && err.message ? err.message : err);
});

// Helper to wait for socket connection
function waitForSocketConnection() {
    return new Promise((resolve) => {
        if (socket.connected) {
            resolve();
        } else {
            socket.once('connect', resolve);
        }
    });
}

function isAppTabVisible() {
    return document.visibilityState === 'visible' && document.hasFocus();
}

function playNotificationSound() {
    if (isAppTabVisible()) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const audioCtx = new AudioContext();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(650, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.12);

    oscillator.onended = () => {
        audioCtx.close().catch(() => {});
    };
}

function shouldPlayMessageNotification(message) {
    if (!message || !window.currentUser) return false;
    if (String(message.senderId) === String(window.currentUser.id)) return false;
    return !isAppTabVisible();
}

function showUnreadIndicator(anchor) {
    if (!anchor) return;
    anchor.classList.add('has-unread');
}

function clearUnreadIndicator(anchor) {
    if (!anchor) return;
    anchor.classList.remove('has-unread');
}

function markGroupUnread(groupId) {
    if (!groupId || String(groupId) === String(window.currentGroupId)) return;
    window.unreadSidebarGroupIds.add(String(groupId));
    showUnreadIndicator(document.querySelector(`[data-group-id="${groupId}"]`));
}

function markDmUnread(dmGroupId) {
    if (!dmGroupId || String(dmGroupId) === String(window.currentGroupId)) return;
    window.unreadSidebarDmGroupIds.add(String(dmGroupId));
    showUnreadIndicator(document.querySelector(`[data-dm-group-id="${dmGroupId}"]`));
}

function clearUnreadForGroup(groupId) {
    if (!groupId) return;
    window.unreadSidebarGroupIds.delete(String(groupId));
    clearUnreadIndicator(document.querySelector(`[data-group-id="${groupId}"]`));
}

function clearUnreadForDm(dmGroupId) {
    if (!dmGroupId) return;
    window.unreadSidebarDmGroupIds.delete(String(dmGroupId));
    clearUnreadIndicator(document.querySelector(`[data-dm-group-id="${dmGroupId}"]`));
}

function clearUnreadForCurrentChat() {
    if (!window.currentGroupId) return;
    clearUnreadForGroup(window.currentGroupId);
    clearUnreadForDm(window.currentGroupId);
}

function subscribeToAllGroupRooms(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return;
    groups.forEach((group) => {
        if (!group || !group.id) return;
        window.pendingSubscribeGroupIds.add(String(group.id));
        if (socket.connected) socket.emit('subscribe-group', group.id);
    });
}

function subscribeToAllDmRooms(dmGroups) {
    if (!Array.isArray(dmGroups) || dmGroups.length === 0) return;
    dmGroups.forEach((group) => {
        if (!group || !group.id) return;
        window.pendingSubscribeDmIds.add(String(group.id));
        if (socket.connected) socket.emit('subscribe-dm', group.id);
    });
}

// Respect ?groupId=... and ?contactId=... in the URL
const _urlParams = new URLSearchParams(window.location.search);
window.requestedGroupId = _urlParams.get('groupId');
window.requestedGroupName = _urlParams.get('groupName');
window.requestedContactId = _urlParams.get('contactId');
let allSidebarContacts = [];
let showingAllSidebarContacts = false;

// group messages 
socket.on("server-group-text", async (message) => {
    const messageGroupId = message?.groupId;
    const isActiveGroup = String(messageGroupId) === String(window.currentGroupId) && !window.currentIsDm;

    if (isActiveGroup) {
        displayMessage(message);
        clearUnreadForGroup(messageGroupId);
        if (shouldPlayMessageNotification(message)) {
            playNotificationSound();
        }
    } else {
        markGroupUnread(messageGroupId);
        if (shouldPlayMessageNotification(message)) {
            playNotificationSound();
        }
    }
});

socket.on("repo-attached", async ({ groupId, repo }) => {
    if (!groupId) return;
    if (String(groupId) !== String(window.currentGroupId)) return;

    if (window.currentIsDm) {
        await loadDmDetails(groupId);
    } else {
        await loadGroupDetails(groupId);
    }
});

//Checks for members leaving
socket.on("member-leave", (data) => {
    // Only update UI if it's the currently viewed group
    if (String(data.groupId) === String(window.currentGroupId)) {
        loadGroupDetails(data.groupId);
    }
});

//Checks for new members
socket.on("member-joined", (data) => {
    // Only update UI if it's the currently viewed group
    if (String(data.groupId) === String(window.currentGroupId)) {
        loadGroupDetails(data.groupId);
    }
});

// incoming messages
socket.on("server-direct-text", async (message) => {
    const dmGroupId = message.DmId || message.dmGroupId || message.groupId;
    const isActiveDm = window.currentIsDm && String(dmGroupId) === String(window.currentGroupId);

    if (isActiveDm) {
        displayMessage(message);
        clearUnreadForDm(dmGroupId);
        if (shouldPlayMessageNotification(message)) {
            playNotificationSound();
        }
    } else {
        markDmUnread(dmGroupId);
        if (shouldPlayMessageNotification(message)) {
            playNotificationSound();
        }
    }
});

// server errors
socket.on("server-error", (error) => {
    alert(`Error: ${error.reason}`);
});

socket.on("dm-ready", async ({ dmGroupId, receiverId }) => {
    window.currentGroupId = dmGroupId;
    window.currentIsDm = true;
    clearUnreadForDm(dmGroupId);
    // Persist current conversation in URL so refresh keeps it
    try { history.replaceState(null, '', `/messages?groupId=${encodeURIComponent(dmGroupId)}`); } catch (e) {}
    await Promise.all([
        loadDmMessages(dmGroupId),
        loadDmDetails(dmGroupId)
    ]);
});

// Group deleted by owner — kick everyone out
socket.on("group-deleted", ({ groupId }) => {
    if (String(groupId) === String(window.currentGroupId)) {
        window.currentGroupId = null;
        window.currentInviteCode = null;

        const messageFeed = document.querySelector('.message-feed');
        if (messageFeed) {
            messageFeed.innerHTML = `
                <div class="empty-feed-notice">
                    <span class="material-symbols-outlined">group_off</span>
                    <p>This group has been deleted.</p>
                </div>`;
        }

        const titleEl = document.querySelector('.chat-channel');
        if (titleEl) titleEl.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">tag</span> deleted-group`;

        // Re-render sidebar to remove the deleted group
        fetchAndRenderSidebar();
    }
});

async function loadDmMessages(dmGroupId) {
    try {
        const messageFeed = document.querySelector('.message-feed');
        if (!messageFeed) return;

        messageFeed.innerHTML = '';

        const response = await fetch(`/api/messages/group/${encodeURIComponent(dmGroupId)}?limit=100`, {
            credentials: 'include'
        });

        if (!response.ok) {
            return;
        }

        const payload = await response.json();
        const messages = Array.isArray(payload.messages) ? payload.messages.slice().reverse() : [];
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
    }
}

async function loadDmDetails(dmGroupId) {
    try {
        const response = await fetch(`/api/groups/${encodeURIComponent(dmGroupId)}`, {
            credentials: 'include'
        });

        if (!response.ok) return;

        const payload = await response.json();
        const members = payload?.group?.members || [];
        const repos = Array.isArray(payload?.group?.repos) ? payload.group.repos : [];

        // Find the other person (not the current user)
        const other = members.find(m => m.id !== window.currentUser.id);
        if (!other) return;

        updateDmHeader(other);
        updateDmPanel(other, repos); 

    } catch (error) {
    }
}

// Collapse sidebar on mobile
function collapseSidebarOnMobile() {
    if (window.innerWidth <= 768) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        if (sidebar) sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-route]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const route = e.currentTarget.getAttribute('data-route');
            // If user explicitly opened the Messages view from the sidebar nav,
            // record that so the messages page can show an empty "no conversation"
            // prompt instead of auto-selecting the first group.
            try {
                if (route === '/messages') sessionStorage.setItem('messages-opened-from-nav', '1');
            } catch (ex) {
                // sessionStorage may be unavailable in some contexts - ignore
            }
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
            if (window.currentIsDm) {
                await loadDmDetails(window.currentGroupId);
            } else {
                await loadGroupDetails(window.currentGroupId);
            }
        }
    };
}); 

async function initializeMessagesView() {
    try {
        const userRes = await fetch('/api/user', {
            credentials: 'include'
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
        }
    } catch (error) {
        window.location.href = '/login';
    }
}

// Fetch groups from backend and render up to 5 groups and 5 contacts
async function fetchAndRenderSidebar() {
    try {
        const res = await fetch('/api/groups', { credentials: 'include' });
        if (!res.ok) return;
        const payload = await res.json();
        const allGroups = (payload && payload.groups) || [];

        const groups = allGroups.filter(g => !g.is_direct);
        const dmGroups = allGroups.filter(g => g.is_direct);

        const messageFeed = document.querySelector('.message-feed');
        const composerEl = document.querySelector('.composer');
        const titleEl = document.querySelector('.chat-channel');

        if ((groups.length === 0) && (dmGroups.length === 0)) {
            if (messageFeed) {
                messageFeed.innerHTML = `
                    <div class="empty-feed-notice">
                        <span class="material-symbols-outlined">groups</span>
                        <p>You are not a member of any groups yet. Create one or ask someone for an invite to start chatting.</p>
                    </div>`;
            }
            if (composerEl) composerEl.style.display = 'none';
            if (titleEl) titleEl.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">tag</span> No groups`;
        } else {
            if (composerEl) composerEl.style.display = '';
        }

        const groupsList = document.getElementById('sidebar-groups');
        if (groupsList) {
            groupsList.innerHTML = '';
            groups.slice(0, 4).forEach((g) => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.className = 'sidebar-link';
                a.href = '#';
                a.dataset.groupId = g.id;
                a.innerHTML = `
                    <span class="material-symbols-outlined">tag</span>
                    <span>${escapeHtml(g.name)}</span>
                    <span class="unread-dot" aria-hidden="true"></span>
                `;

                if (window.unreadSidebarGroupIds.has(String(g.id))) {
                    a.classList.add('has-unread');
                }

                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('sidebar-link--active'));
                    a.classList.add('sidebar-link--active');
                    updateGroupHeaderFromMembers(g);
                    selectGroup(g);
                    clearUnreadForGroup(g.id);
                    collapseSidebarOnMobile();
                });

                li.appendChild(a);
                groupsList.appendChild(li);
            });

            if (groups.length === 0) {
                groupsList.innerHTML = '<li class="muted" style="padding:8px 12px;color:#8b949e">No groups yet</li>';
                showNoGroupsView();
            }
        }

        subscribeToAllGroupRooms(groups);
        subscribeToAllDmRooms(dmGroups);

        const contactsMap = new Map();
        groups.forEach(g => {
            if (!Array.isArray(g.members)) return;
            g.members.forEach(m => {
                if (!m || !m.id) return;
                if (String(m.id) === String(window.currentUser.id)) return;
                if (!contactsMap.has(m.id)) contactsMap.set(m.id, m);
            });
        });

        dmGroups.forEach(g => {
            if (!Array.isArray(g.members)) return;
            g.members.forEach(m => {
                if (!m || !m.id) return;
                if (String(m.id) === String(window.currentUser.id)) return;
                contactsMap.set(m.id, { ...m, existingDmGroupId: g.id });
            });
        });

        const contacts = Array.from(contactsMap.values())
            .sort((left, right) => (left.username || '').localeCompare(right.username || ''))
            .slice(0, 4);

        const contactsList = document.getElementById('sidebar-contacts');
        if (contactsList) {
            contactsList.innerHTML = '';

            contacts.forEach(c => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.className = 'sidebar-link';
                a.href = '#';
                const avatar = `<div class="avatar avatar--small"><img src="${escapeAttr(c.avatar_url || '/default-avatar.png')}" alt="${escapeAttr(c.username)}"/></div>`;
                a.innerHTML = `${avatar}<span>${escapeHtml(c.username)}</span><span class="unread-dot" aria-hidden="true"></span>`;
                a.dataset.userId = c.id;
                a.dataset.dmGroupId = c.existingDmGroupId || '';

                if (c.existingDmGroupId && window.unreadSidebarDmGroupIds.has(String(c.existingDmGroupId))) {
                    a.classList.add('has-unread');
                }

                a.addEventListener('click', async (e) => {
                    e.preventDefault();
                    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('sidebar-link--active'));
                    a.classList.add('sidebar-link--active');
                    window.currentIsDm = true;

                    if (c.existingDmGroupId) {
                        window.currentGroupId = c.existingDmGroupId;
                        try { history.replaceState(null, '', `/messages?groupId=${encodeURIComponent(c.existingDmGroupId)}`); } catch (e2) {}
                        clearUnreadForDm(c.existingDmGroupId);
                        await Promise.all([
                            loadDmMessages(c.existingDmGroupId),
                            loadDmDetails(c.existingDmGroupId)
                        ]);
                        updateDmHeader(c);
                        collapseSidebarOnMobile();
                    } else {
                        await waitForSocketConnection();
                        socket.emit('direct-connect', c.id);
                        collapseSidebarOnMobile();
                    }
                });

                li.appendChild(a);
                contactsList.appendChild(li);
            });

            if (contacts.length === 0) {
                contactsList.innerHTML = '<li class="muted" style="padding:8px 12px;color:#8b949e">No contacts yet</li>';
            }
        }

        // Conversation selection precedence:
        // 1) explicit group in URL
        // 2) explicit contact in URL
        // 3) opened from nav -> show empty prompt
        // 4) default first group
        let openedFromNav = false;
        try {
            openedFromNav = sessionStorage.getItem('messages-opened-from-nav') === '1';
        } catch (e3) {
            openedFromNav = false;
        }

        if (window.requestedGroupId) {
            const target = allGroups.find(g => String(g.id) === String(window.requestedGroupId));
            if (target) {
                updateGroupHeaderFromMembers(target);
                await selectGroup(target);
            } else {
                try {
                    const singleRes = await fetch(`/api/groups/${encodeURIComponent(window.requestedGroupId)}`, { credentials: 'include' });
                    if (singleRes.ok) {
                        const p = await singleRes.json();
                        if (p && p.group) {
                            updateGroupHeaderFromMembers(p.group);
                            await selectGroup(p.group);
                        }
                    }
                } catch (ignoreErr) {
                }
            }
            window.requestedGroupId = null;
        } else if (window.requestedContactId) {
            const contactToOpen = Array.from(contactsMap.values())
                .find(c => String(c.id) === String(window.requestedContactId));

            if (contactToOpen && contactToOpen.existingDmGroupId) {
                window.currentGroupId = contactToOpen.existingDmGroupId;
                window.currentIsDm = true;
                try { history.replaceState(null, '', `/messages?groupId=${encodeURIComponent(contactToOpen.existingDmGroupId)}`); } catch (e4) {}
                clearUnreadForDm(contactToOpen.existingDmGroupId);
                await Promise.all([
                    loadDmMessages(contactToOpen.existingDmGroupId),
                    loadDmDetails(contactToOpen.existingDmGroupId)
                ]);
                updateDmHeader(contactToOpen);
            } else {
                await waitForSocketConnection();
                socket.emit('direct-connect', window.requestedContactId);
            }

            window.requestedContactId = null;
        } else if (openedFromNav) {
            try { sessionStorage.removeItem('messages-opened-from-nav'); } catch (e5) {}
            showNoConversationSelected();
        } else if (!window.currentGroupId && groups.length > 0) {
            const first = groups[0];
            updateGroupHeaderFromMembers(first);
            await selectGroup(first);
        }

        if ((!groups || groups.length === 0) && (!dmGroups || dmGroups.length === 0)) {
            showNoGroupsView();
        }
    } catch (err) {
    }
}

function showNoGroupsView() {
    // Message feed
    const messageFeed = document.querySelector('.message-feed');
    if (messageFeed) {
        messageFeed.innerHTML = `
            <div class="empty-feed-notice">
                <span class="material-symbols-outlined">waving_hand</span>
                <p>Welcome — you have no groups yet. Create one or attach a repository to start receiving updates.</p>
            </div>`;
    }

    // Group panel intro
    const introTitle = document.querySelector('.group-panel__intro h3');
    if (introTitle) introTitle.textContent = 'No group selected';
    const introText = document.querySelector('.group-panel__intro p');
    if (introText) introText.textContent = 'Select or create a group to view messages and repositories.';

    // Repo list fallback
    const repoList = document.getElementById('group-repo-list') || document.querySelector('.repo-list');
    if (repoList) repoList.innerHTML = '<article class="repo-card"><div class="repo-card__title"><span class="material-symbols-outlined">folder_off</span><span>No attached repositories</span></div><div class="repo-card__meta">Attach one from the header button</div></article>';
}

function showNoConversationSelected() {
    const messageFeed = document.querySelector('.message-feed');
    const composerEl = document.querySelector('.composer');
    const titleEl = document.querySelector('.chat-channel');

    if (messageFeed) {
        messageFeed.innerHTML = `
            <div class="empty-feed-notice">
                <span class="material-symbols-outlined">chat</span>
                <p>No conversation selected — pick a person or group on the left to view messages.</p>
            </div>`;
    }
    if (composerEl) composerEl.style.display = 'none';
    if (titleEl) titleEl.innerText = 'No conversation selected';
}

function updateDmHeader(contact) {
    const titleEl = document.querySelector('.chat-channel');
    if (titleEl) {
        titleEl.innerHTML = `
            <img src="${escapeAttr(contact.avatar_url || '/default-avatar.png')}"
                 class="avatar avatar--small"
                 alt="${escapeHtml(contact.username)}"/>
            ${escapeHtml(contact.username)}
        `;
    }
    const stack = document.querySelector('.avatar-stack');
    const count = document.querySelector('.member-count');
    if (stack) stack.style.display = 'none';
    if (count) count.style.display = 'none';
}

function updateDmPanel(contact, repos = []) {
    const introTitle = document.querySelector('.group-panel__intro h3');
    const introText = document.querySelector('.group-panel__intro p');
    if (introTitle) introTitle.textContent = contact.username;
    if (introText) introText.textContent = 'Direct message conversation.';
    
    // Hide Members section for DMs
    const membersSection = document.getElementById('members-section');
    if (membersSection) membersSection.style.display = 'none';
    
    renderRepoList(repos); 
    renderGroupActions(null); // No leave/delete for DMs
}

function updateGroupHeaderFromMembers(group) {
    if (!group) return;

    const stack = document.querySelector('.avatar-stack');
    const countEl = document.querySelector('.member-count');
    if (stack) stack.style.display = '';
    if (countEl) countEl.style.display = '';

    const members = Array.isArray(group.members) ? group.members : [];
    if (stack) {
        stack.innerHTML = '';
        const show = members.slice(0, 3);
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
    if (countEl) {
        const count = members.length || (group.member_count ? Number(group.member_count) : 0);
        countEl.textContent = `${count} members`;
    }
}

async function selectGroup(group) {
    if (!group) return;

    // If this is a DM group, delegate to DM handlers instead
    if (group.is_direct) {
        window.currentIsDm = true;
        window.currentGroupId = group.id;
        clearUnreadForDm(group.id);
        await Promise.all([
            loadDmMessages(group.id),
            loadDmDetails(group.id)
        ]);
        return;
    }

    window.currentIsDm = false;
    if (window.currentInviteCode) socket.emit('leave-group', window.currentInviteCode);
    window.currentGroupId = group.id;
    window.currentInviteCode = group.invite_code;
    clearUnreadForGroup(group.id);

    const titleEl = document.querySelector('.chat-channel');
    if (titleEl) titleEl.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">tag</span> ${escapeHtml(group.name)}`;

    const stack = document.querySelector('.avatar-stack');
    const count = document.querySelector('.member-count');
    if (stack) stack.style.display = '';
    if (count) count.style.display = '';

    socket.emit('join-group', group.id);

    // Persist current conversation in URL so a refresh preserves it
    try { history.replaceState(null, '', `/messages?groupId=${encodeURIComponent(group.id)}`); } catch (e) {}

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
            return;
        }

        const payload = await response.json();
        const group = payload?.group;
        if (!group) return;

        const members = Array.isArray(group.members) ? group.members : [];
        const repos = Array.isArray(group.repos) ? group.repos : [];

        updateGroupHeaderFromMembers({ ...group, members });

        const introTitle = document.querySelector('.group-panel__intro h3');
        if (introTitle) introTitle.textContent = group.name || 'Group';

        const introText = document.querySelector('.group-panel__intro p');
        if (introText) {
            introText.textContent = repos.length > 0
                ? `${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'} linked to this group.`
                : 'No repository linked yet. Attach one to start receiving repository updates.';
        }

        // Show Members section for groups
        const membersSection = document.getElementById('members-section');
        if (membersSection) membersSection.style.display = '';

        // Reset member toggle state for new group
        showAllMembers = false;
        renderMemberList(members);
        setupMemberToggle();
        renderRepoList(repos);
        renderGroupActions(group);
    } catch (error) {
    }
}

function renderMemberList(members) {
    const list = document.getElementById('group-member-list') || document.querySelector('.member-list');
    if (!list) return;

    // Store all members for toggle functionality
    allGroupMembers = members || [];
    
    // Determine how many members to show (5 default, all if expanded)
    const membersToShow = showAllMembers ? allGroupMembers : allGroupMembers.slice(0, 5);
    
    list.innerHTML = '';
    
    // Apply scrollable class when expanded
    if (showAllMembers && allGroupMembers.length > 5) {
        list.classList.add('member-list--expanded');
    } else {
        list.classList.remove('member-list--expanded');
    }

    if (!membersToShow || membersToShow.length === 0) {
        list.innerHTML = '<li class="member-item"><span class="member-muted">No members found.</span></li>';
        updateMemberToggle();
        return;
    }

    membersToShow.forEach((m) => {
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
    
    updateMemberToggle();
}

function setupMemberToggle() {
    const toggle = document.getElementById('memberViewToggle');
    if (!toggle) return;

    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        if (allGroupMembers.length <= 5) return;
        showAllMembers = !showAllMembers;
        renderMemberList(allGroupMembers);
    });

    updateMemberToggle();
}

function updateMemberToggle() {
    const toggle = document.getElementById('memberViewToggle');
    if (!toggle) return;

    if (allGroupMembers.length <= 5) {
        toggle.style.display = 'none';
        return;
    }

    toggle.style.display = '';
    toggle.textContent = showAllMembers ? 'Show less' : 'View all';
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
                <div class="repo-card__meta">Added on ${escapeHtml(addedAt)}</div>
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

// ── Leave / Delete group actions in the side panel ───────────────────────────

function renderGroupActions(group) {
    // Find or create the actions section at the bottom of the panel body
    let actionsSection = document.getElementById('group-actions-section');
    if (!actionsSection) {
        actionsSection = document.createElement('section');
        actionsSection.id = 'group-actions-section';
        actionsSection.className = 'panel-section panel-section--actions';
        const panelBody = document.querySelector('.group-panel__body');
        if (panelBody) panelBody.appendChild(actionsSection);
    }

    // No group (e.g. DM view) — hide the section entirely
    if (!group) {
        actionsSection.innerHTML = '';
        actionsSection.style.display = 'none';
        return;
    }

    actionsSection.style.display = '';

    const isOwner = window.currentUser && String(group.created_by) === String(window.currentUser.id);

    actionsSection.innerHTML = `
    <div class="panel-section__header" id="dangerZoneToggle" style="cursor:pointer;">
        <h4>Danger Zone</h4>
        <span class="material-symbols-outlined" id="dangerZoneChevron" style="color:var(--muted);font-size:18px;transition:transform 0.2s;">expand_more</span>
    </div>
    <div class="group-actions" id="dangerZoneBody" style="display:none;">
            ${!isOwner ? `
                <button id="leaveGroupBtn" class="danger-button danger-button--outline" type="button">
                    <span class="material-symbols-outlined" aria-hidden="true">logout</span>
                    Leave Group
                </button>` : ''}
            ${isOwner ? `
                <button id="deleteGroupBtn" class="danger-button" type="button">
                    <span class="material-symbols-outlined" aria-hidden="true">delete_forever</span>
                    Delete Group
                </button>` : ''}
        </div>
    `;

    document.getElementById('leaveGroupBtn')?.addEventListener('click', () => handleLeaveGroup(group));
    document.getElementById('deleteGroupBtn')?.addEventListener('click', () => handleDeleteGroup(group));
    document.getElementById('dangerZoneToggle')?.addEventListener('click', () => {
        const body = document.getElementById('dangerZoneBody');
        const chevron = document.getElementById('dangerZoneChevron');
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    });
}

async function handleLeaveGroup(group) {
    const confirmed = confirm(`Leave "${group.name}"? You'll need an invite code to rejoin.`);
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/groups/${encodeURIComponent(group.id)}/leave`, {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.error || 'Failed to leave group.');
            return;
        }

        // Clear current group state
        window.currentGroupId = null;
        window.currentInviteCode = null;

        // Clear message feed
        const messageFeed = document.querySelector('.message-feed');
        if (messageFeed) {
            messageFeed.innerHTML = `
                <div class="empty-feed-notice">
                    <span class="material-symbols-outlined">waving_hand</span>
                    <p>You left <strong>${escapeHtml(group.name)}</strong>.</p>
                </div>`;
        }

        // Refresh sidebar to remove the group
        await fetchAndRenderSidebar();

    } catch (err) {
        alert('Something went wrong. Please try again.');
    }
}

async function handleDeleteGroup(group) {
    const confirmed = confirm(`Permanently delete "${group.name}"? This cannot be undone — all messages and repos will be removed.`);
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/groups/${encodeURIComponent(group.id)}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.error || 'Failed to delete group.');
            return;
        }

        // Clear current group state
        window.currentGroupId = null;
        window.currentInviteCode = null;

        // Clear message feed
        const messageFeed = document.querySelector('.message-feed');
        if (messageFeed) {
            messageFeed.innerHTML = `
                <div class="empty-feed-notice">
                    <span class="material-symbols-outlined">delete_forever</span>
                    <p><strong>${escapeHtml(group.name)}</strong> has been deleted.</p>
                </div>`;
        }

        // Refresh sidebar
        await fetchAndRenderSidebar();

    } catch (err) {
        alert('Something went wrong. Please try again.');
    }
}

function escapeAttr(s) {
    if (!s) return '';
    return String(s).replace(/"/g, '&quot;');
}

function formatTimeInPhilippines(date) {
    try {
        return date.toLocaleString('en-US', {
            timeZone: 'Asia/Manila',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }
}

function parseServerTimestamp(value) {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);

    const raw = String(value).trim();

    // ISO with explicit zone (Z or +/-hh:mm)
    if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) {
        const zoned = new Date(raw);
        if (!Number.isNaN(zoned.getTime())) return zoned;
    }

    // PostgreSQL "timestamp without time zone" values are treated as UTC in this app.
    // Support both "YYYY-MM-DD HH:mm:ss" and "YYYY-MM-DDTHH:mm:ss" with optional milliseconds.
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (match) {
        const [, y, mo, d, h, mi, s, ms = '0'] = match;
        const utcDate = new Date(Date.UTC(
            Number(y),
            Number(mo) - 1,
            Number(d),
            Number(h),
            Number(mi),
            Number(s),
            Number(ms.padEnd(3, '0'))
        ));
        if (!Number.isNaN(utcDate.getTime())) return utcDate;
    }

    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

function initializeMessageComposer() {
    const sendButton = document.querySelector('.composer__send');
    const messageInput = document.querySelector('.composer__input');

    if (!sendButton || !messageInput) {
        return;
    }

    sendButton.addEventListener('click', async () => {
        sendMessage(messageInput.value);
    });

    messageInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(messageInput.value);
        }
    });

    async function sendMessage(text) {
        if (!text.trim()) return;

        if (!window.currentGroupId) {
            alert('Please select a group first');
            return;
        }

        if (!window.currentUser) {
            alert('Please log in to send messages');
            return;
        }

        
        socket.emit("client-message", {
            text: text.trim(),
            groupId: window.currentGroupId
        });

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
            return;
        }

        const payload = await response.json();
        const messages = Array.isArray(payload.messages) ? payload.messages.slice().reverse() : [];
        
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
    }
}

function displayMessage(messageData) {
    const messageFeed = document.querySelector('.message-feed');

    if (!messageFeed) {
        return;
    }

    const messageElement = document.createElement('article');

    const timestamp = parseServerTimestamp(messageData.created_at || messageData.timestamp || Date.now());
    const timeString = formatTimeInPhilippines(timestamp);

    if (messageData.type === 'system') {
        messageElement.className = 'message message--system';
        messageElement.innerHTML = `
            <div class="message__system-pill" role="status" aria-live="polite">
                <span class="message__system-text">${escapeHtml(messageData.content || messageData.text || '')}</span>
                <span class="message__system-time">${timeString}</span>
            </div>
        `;
    } else {
        messageElement.className = 'message message--standard';
        messageElement.innerHTML = `
            <img alt="${escapeHtml(messageData.authorName || messageData.author)}" 
                 class="avatar avatar--message" 
                 src="${messageData.fromAvatar || messageData.avatar || '/default-avatar.png'}"/>
            <div class="message__body">
                <div class="message__meta">
                    <span class="message__author">${escapeHtml(messageData.authorName || messageData.from || messageData.author || messageData.sender_username)}</span>
                    <span class="message__time">${timeString}</span>
                </div>
                <p class="message__text">${escapeHtml(messageData.content || messageData.text)}</p>
            </div>
        `;
    }

    messageFeed.appendChild(messageElement);
    messageFeed.scrollTop = messageFeed.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function initializeResizablePanel() {
    const resizeHandle = document.querySelector('.resize-handle');
    const panel = document.querySelector('.group-panel');
    const mobileToggle = document.getElementById('mobileGroupInfoToggle');
    const mobileOverlay = document.getElementById('groupPanelOverlay');

    if (!panel) return;

    if (resizeHandle && window.innerWidth > 768) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        const savedWidth = localStorage.getItem('groupPanelWidth');
        if (savedWidth) panel.style.setProperty('--panel-width', `${savedWidth}px`);

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            resizeHandle.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            let newWidth = startWidth - (e.clientX - startX);
            newWidth = Math.min(600, Math.max(250, newWidth));
            panel.style.setProperty('--panel-width', `${newWidth}px`);
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;

            isResizing = false;
            resizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            localStorage.setItem('groupPanelWidth', panel.offsetWidth);
            panel.scrollTop = panel.scrollHeight;
        });
    }

    if (!mobileToggle || !mobileOverlay) return;

    const isMobile = () => window.innerWidth <= 768;

    const closePanel = () => {
        panel.classList.remove('active');
        panel.classList.remove('dragging');
        mobileOverlay.classList.remove('active');
        document.body.style.overflow = '';
        panel.style.transition = '';
        panel.style.transform = '';
    };

    const openPanel = () => {
        if (!isMobile()) return;

        panel.classList.add('active');
        mobileOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        panel.style.transition = '';
        panel.style.transform = '';
    };

    mobileToggle.addEventListener('click', () => {
        panel.classList.contains('active') ? closePanel() : openPanel();
    });

    mobileOverlay.addEventListener('click', closePanel);

    const dragSources = [
        document.querySelector('.group-panel-drag-handle'),
        panel.querySelector('.group-panel__intro'),
    ].filter(Boolean);

    let dragState = null;

    const startDrag = (clientY) => {
        if (!panel.classList.contains('active') || !isMobile()) return;

        dragState = {
            startY: clientY,
            lastY: clientY,
            threshold: Math.max(80, Math.round(panel.offsetHeight * 0.2))
        };

        panel.classList.add('dragging');
        panel.style.transition = 'none';
    };

    const updateDrag = (clientY) => {
        if (!dragState) return;

        const delta = Math.max(0, clientY - dragState.startY);
        dragState.lastY = clientY;
        panel.style.transform = `translateY(${delta}px)`;
    };

    const finishDrag = () => {
        if (!dragState) return;

        const delta = Math.max(0, dragState.lastY - dragState.startY);
        const shouldClose = delta > dragState.threshold;

        dragState = null;
        panel.classList.remove('dragging');
        panel.style.transition = '';
        panel.style.transform = '';

        if (shouldClose) {
            closePanel();
        }
    };

    dragSources.forEach((source) => {
        source.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            if (!touch) return;

            startDrag(touch.clientY);
        }, { passive: true });

        source.addEventListener('touchmove', (e) => {
            if (!dragState) return;

            const touch = e.touches[0];
            if (!touch) return;

            updateDrag(touch.clientY);
            e.preventDefault();
        }, { passive: false });

        source.addEventListener('touchend', (e) => {
            if (!dragState) return;

            const touch = e.changedTouches[0];
            if (touch) updateDrag(touch.clientY);
            finishDrag();
        }, { passive: true });

        source.addEventListener('touchcancel', finishDrag, { passive: true });
    });
}

function initializeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (!sidebar || !toggleBtn) {
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

// ── Commits Modal ────────────────────────────────────────────────────────────

let selectedCommits = new Set();

// Track which "view" the commits modal is showing: 'list' | 'diff'
let commitsModalView = 'list';

function initializeCommitsModal() {
    const summarizeBtn = document.querySelector('.primary-button.action-button');
    const commitsOverlay = document.getElementById('commitsOverlay');
    const closeBtn = document.getElementById('closeCommits');
    const repoSelect = document.getElementById('commitRepoSelect');
    const compareBtn = document.getElementById('compareCommitsBtn');
    const backBtn = document.getElementById('diffBackBtn');

    if (!summarizeBtn || !commitsOverlay) {
        return;
    }

    summarizeBtn.addEventListener('click', () => {
        if (!window.currentGroupId) {
            alert('Please select a group first');
            return;
        }
        showCommitsModal();
    });

    closeBtn?.addEventListener('click', hideCommitsModal);
    commitsOverlay?.addEventListener('click', (e) => {
        if (e.target.id === 'commitsOverlay') hideCommitsModal();
    });

    repoSelect?.addEventListener('change', async (e) => {
        const repoFullName = e.target.value;
        if (repoFullName) {
            await loadCommits(repoFullName);
        } else {
            hideCommitsContainer();
        }
    });

    compareBtn?.addEventListener('click', async () => {
        const commits = Array.from(selectedCommits);
        if (commits.length !== 2) {
            alert('Please select exactly 2 commits to compare');
            return;
        }
        await compareCommits(commits[0], commits[1]);
    });

    // Back button: return from diff view to list view
    backBtn?.addEventListener('click', () => {
        showCommitsList();
    });
}

function showCommitsModal() {
    const overlay = document.getElementById('commitsOverlay');
    if (!overlay) return;

    selectedCommits.clear();
    document.getElementById('commitRepoSelect').value = '';
    hideCommitsContainer();
    showCommitsList(); // ensure we start on list view
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

// Switch modal body to show commit list / selector
function showCommitsList() {
    commitsModalView = 'list';
    const listView = document.getElementById('commitsListView');
    const diffView = document.getElementById('commitsDiffView');
    const modalTitle = document.getElementById('commitsModalTitle');
    const backBtn = document.getElementById('diffBackBtn');

    if (listView) listView.style.display = '';
    if (diffView) diffView.style.display = 'none';
    if (modalTitle) modalTitle.textContent = 'Repository Commits';
    if (backBtn) backBtn.style.display = 'none';
}

// Switch modal body to show diff result
function showDiffView(diffHtml, title, subtitle, statsHtml) {
    commitsModalView = 'diff';
    const listView = document.getElementById('commitsListView');
    const diffView = document.getElementById('commitsDiffView');
    const modalTitle = document.getElementById('commitsModalTitle');
    const backBtn = document.getElementById('diffBackBtn');
    const diffTitle = document.getElementById('diffViewTitle');
    const diffSubtitle = document.getElementById('diffViewSubtitle');
    const diffStats = document.getElementById('diffViewStats');
    const diffContent = document.getElementById('diffViewContent');

    if (listView) listView.style.display = 'none';
    if (diffView) diffView.style.display = '';
    if (modalTitle) modalTitle.textContent = 'Commit Comparison';
    if (backBtn) backBtn.style.display = 'inline-flex';
    if (diffTitle) diffTitle.textContent = title;
    if (diffSubtitle) diffSubtitle.innerHTML = subtitle;
    if (diffStats) diffStats.innerHTML = statsHtml;
    if (diffContent) diffContent.innerHTML = diffHtml;
}

async function loadGroupRepositories() {
    try {
        const response = await fetch(`/api/groups/${encodeURIComponent(window.currentGroupId)}`, {
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to load group details');

        const payload = await response.json();
        const repos = Array.isArray(payload?.group?.repos) ? payload.group.repos : [];

        const repoSelect = document.getElementById('commitRepoSelect');
        if (!repoSelect) return;

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
    } 
        finally {
        hideCommitsLoading();
    }
}

function displayCommits(commits, repoFullName) {
    const container = document.getElementById('commitsContainer');
    const list = document.getElementById('commitsList');
    const repoNameEl = document.getElementById('selectedRepoName');

    if (!container || !list || !repoNameEl) return;

    repoNameEl.innerHTML = `<span class="material-symbols-outlined">folder</span>${escapeHtml(repoFullName)}`;
    list.innerHTML = '';

    if (!commits || commits.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No commits found</p></div>';
        container.classList.remove('hidden');
        return;
    }

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

    // Show loading state inside the modal
    const compareBtn = document.getElementById('compareCommitsBtn');
    if (compareBtn) {
        compareBtn.disabled = true;
        compareBtn.textContent = 'Loading diff...';
    }

    try {
        const [commit1Response, commit2Response] = await Promise.all([
            fetch(`/api/repos/${owner}/${repo}/commits/${sha1}`, { credentials: 'include' }),
            fetch(`/api/repos/${owner}/${repo}/commits/${sha2}`, { credentials: 'include' })
        ]);

        if (!commit1Response.ok || !commit2Response.ok) {
            throw new Error('Failed to fetch commit details');
        }

        const commit1 = await commit1Response.json();
        const commit2 = await commit2Response.json();

        renderDiffInModal(commit1, commit2, repoFullName);
    } catch (error) {
        alert('Failed to compare commits: ' + error.message);
        updateCompareButton();
    }
}

// ── Render diff inside the modal (replaces displayCommitDiff) ────────────────

function renderDiffInModal(commit1, commit2, repoFullName) {
    const shortSha1 = commit1.sha.substring(0, 7);
    const shortSha2 = commit2.sha.substring(0, 7);

    const totalAdditions = commit1.stats.additions + commit2.stats.additions;
    const totalDeletions = commit1.stats.deletions + commit2.stats.deletions;

    // Merge files from both commits
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

    // Build files HTML
    const filesHtml = Array.from(filesMap.values()).map(file => `
        <div class="diff-file">
            <div class="diff-file-header">
                <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:6px;color:#8b949e;">description</span>
                ${escapeHtml(file.filename)}
                <span class="diff-file-badge diff-file-badge--${file.status || 'modified'}">
                    ${file.status || 'modified'}
                </span>
                <span style="margin-left:auto;font-size:11px;color:#8b949e;font-weight:400;">
                    <span style="color:#3fb950;">+${file.additions}</span>
                    &nbsp;
                    <span style="color:#f85149;">-${file.deletions}</span>
                </span>
            </div>
            <div class="diff-file-content">
                ${formatPatch(file.patch)}
            </div>
        </div>
    `).join('');

    const statsHtml = `
        <span class="diff-stat diff-stat--additions">
            <span class="material-symbols-outlined" style="font-size:14px;">add</span>
            ${totalAdditions} additions
        </span>
        <span class="diff-stat diff-stat--deletions">
            <span class="material-symbols-outlined" style="font-size:14px;">remove</span>
            ${totalDeletions} deletions
        </span>
        <span class="diff-stat" style="color:#8b949e;">
            <span class="material-symbols-outlined" style="font-size:14px;">description</span>
            ${filesMap.size} file${filesMap.size !== 1 ? 's' : ''}
        </span>
    `;

    const subtitleHtml = `
        <code class="diff-sha-pill">${shortSha1}</code>
        <span class="diff-sha-label">${escapeHtml(commit1.message.split('\n')[0])}</span>
        <span class="material-symbols-outlined" style="font-size:16px;color:#8b949e;flex-shrink:0;">compare_arrows</span>
        <code class="diff-sha-pill">${shortSha2}</code>
        <span class="diff-sha-label">${escapeHtml(commit2.message.split('\n')[0])}</span>
    `;

    showDiffView(
        filesHtml,
        repoFullName,
        subtitleHtml,
        statsHtml
    );
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
