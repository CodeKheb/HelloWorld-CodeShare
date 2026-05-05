(function initSidebar() {
    const toggleBtn = document.getElementById('mobileMenuOpen');
    const sidebar   = document.getElementById('mainSidebar');
    const overlay   = document.getElementById('sidebarOverlay');
    if (!toggleBtn || !sidebar || !overlay) return;

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

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.contains('active') ? closeSidebar() : openSidebar();
    });

    overlay.addEventListener('click', closeSidebar);

    // Close sidebar when a nav link is tapped on mobile
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
})();

// ── Settings Dropdown ────────────────────────
(function initSettingsDropdown() {
    const btn      = document.getElementById('settingsButton');
    const menu     = document.getElementById('settingsDropdown');
    const backdrop = document.getElementById('settingsBackdrop');
    const logoutBtn = document.getElementById('logoutButton');
    if (!btn || !menu || !backdrop) return;

    document.body.appendChild(menu);

    function open() {
        menu.classList.add('show');
        backdrop.classList.add('show');
    }

    function close() {
        menu.classList.remove('show');
        backdrop.classList.remove('show');
    }

    btn.addEventListener('click', (e) => {
        menu.classList.contains('show') ? close() : open();
    });

    backdrop.addEventListener('click', close);

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (
            !e.target.closest('#settingsDropdown') &&
            !e.target.closest('#settingsButton')
        ) {
            close();
        }
    })
    // Close on Escape
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
})();

// ── Modal Helper ─────────────────────────────
function showModal(modalId) {
    const overlay = document.getElementById(modalId);
    if (!overlay) return;
    const modal = overlay.querySelector('.modal');
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
        overlay.classList.add('anim-open');
        if (modal) modal.classList.add('open');
    });
}

function hideModal(modalId) {
    const overlay = document.getElementById(modalId);
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

// ── Create Group Modal ───────────────────────
(function initGroupModal() {
    const openBtn   = document.getElementById('createGroupBtn');
    const closeBtn  = document.getElementById('closeModal');
    const cancelBtn = document.getElementById('cancelBtn');
    const submitBtn = document.getElementById('submitGroup');
    const overlay   = document.getElementById('modalOverlay');
    if (!overlay) return;

    function close() {
        document.getElementById('groupName').value = '';
        document.getElementById('repoName').value  = '';
        hideModal('modalOverlay');
    }

    openBtn?.addEventListener('click',  () => showModal('modalOverlay'));
    closeBtn?.addEventListener('click', close);
    cancelBtn?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') close(); });

    submitBtn?.addEventListener('click', async () => {
        const name        = document.getElementById('groupName').value.trim();
        const repoFullName = document.getElementById('repoName').value.trim();
        if (!name) return alert('Group name is required');

        submitBtn.disabled = true;
        const orig = submitBtn.textContent;
        submitBtn.textContent = 'Creating...';

        try {
            const res  = await fetch('/api/groups/create', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, repoFullName: repoFullName || null })
            });
            const data = await res.json();
            if (res.ok) {
                alert('Group created successfully!');
                close();
            } else {
                alert('Error: ' + (data.error || 'Failed to create group'));
            }
        } catch (err) {
            console.error('Error creating group:', err);
            alert('Error: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = orig;
        }
    });
})();

// ── Create Repository Modal ──────────────────
(function initRepoModal() {
    // Sidebar button
    const sidebarBtn = document.getElementById('newRepoSidebarBtn');
    const closeBtn   = document.getElementById('closeRepoModal');
    const cancelBtn  = document.getElementById('cancelRepoBtn');
    const submitBtn  = document.getElementById('submitRepo');
    const overlay    = document.getElementById('repoModalOverlay');
    if (!overlay) return;

    function close() {
        document.getElementById('newRepoName').value        = '';
        document.getElementById('newRepoDescription').value = '';
        document.getElementById('newRepoPrivate').checked   = false;
        document.getElementById('newRepoAutoInit').checked  = true;
        document.getElementById('newRepoGitignore').value   = '';
        document.getElementById('newRepoLicense').value     = '';
        hideModal('repoModalOverlay');
    }

    sidebarBtn?.addEventListener('click', () => showModal('repoModalOverlay'));
    closeBtn?.addEventListener('click',  close);
    cancelBtn?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target.id === 'repoModalOverlay') close(); });

    submitBtn?.addEventListener('click', async () => {
        const name        = document.getElementById('newRepoName').value.trim();
        const description = document.getElementById('newRepoDescription').value.trim();
        const isPrivate   = document.getElementById('newRepoPrivate').checked;
        const autoInit    = document.getElementById('newRepoAutoInit').checked;
        const gitignore   = document.getElementById('newRepoGitignore').value;
        const license     = document.getElementById('newRepoLicense').value;
        if (!name) return alert('Repository name is required');

        submitBtn.disabled = true;
        const orig = submitBtn.textContent;
        submitBtn.textContent = 'Creating...';

        try {
            const res  = await fetch('/api/repos/create', {
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
                close();
                // Refresh repo list
                const repoRes = await fetch('/api/repos');
                allRepos = await repoRes.json();
                renderRepos(showingAll);
            } else {
                alert('Error: ' + (data.error || 'Failed to create repository'));
            }
        } catch (err) {
            console.error('Error creating repository:', err);
            alert('Error: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = orig;
        }
    });
})();

// ── Route Links ──────────────────────────────
document.querySelectorAll('[data-route]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const route = e.currentTarget.getAttribute('data-route');
        window.location.href = `/${route}`;
    });
});

// ============================================
// DASHBOARD DATA
// ============================================

let allRepos   = [];
let showingAll = false;

async function initializeDashboard() {
    try {
        // 1. User data
        const userRes  = await fetch('/api/auth/user');
        const userData = await userRes.json();
        if (userData.authenticated) {
            document.getElementById('user-avatar').src    = userData.user.avatar || userData.user.avatar_url || '';
            document.getElementById('user-name').innerText = userData.user.displayName || userData.user.username;
            document.getElementById('user-login').innerText = `@${userData.user.username}`;
        }

        // 2. Repositories
        const repoRes = await fetch('/api/repos');
        allRepos      = await repoRes.json();

        // 3. Render first 3
        renderRepos(false);

        // 4. "View all" toggle
        setupViewAllHandler();

    } catch (err) {
        console.error('Dashboard load failed:', err);
        document.getElementById('repo-grid').innerHTML = '<p style="color:var(--muted)">Error loading repositories.</p>';
    }
}

function renderRepos(showAll) {
    const grid        = document.getElementById('repo-grid');
    const reposToShow = showAll ? allRepos : allRepos.slice(0, 3);

    if (reposToShow.length === 0) {
        grid.innerHTML = '<p style="color:var(--muted)">No repositories found.</p>';
        return;
    }

    grid.innerHTML = reposToShow.map(repo => `
        <article class="group-card" onclick="if(!event.target.closest('.btn-download')) window.open('${repo.html_url}', '_blank')">
            <div class="group-card__header">
                <div class="group-title-row">
                    <span class="material-symbols-outlined group-icon">folder</span>
                    <h3>${repo.name}</h3>
                </div>
                <span class="badge ${repo.private ? '' : 'badge--public'}">
                    ${repo.private ? 'Private' : 'Public'}
                </span>
            </div>
            <p class="group-card__description">
                ${repo.description || 'No description provided for this repository.'}
            </p>
            <div class="group-card__footer">
                <div class="meta-row">
                    <span class="meta-stat">
                        <span class="material-symbols-outlined meta-icon">star</span>
                        ${repo.stargazers_count || 0}
                    </span>
                    <span class="meta-stat">
                        <span class="lang-color-dot" style="background-color:${getLangColor(repo.language)};width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:4px;"></span>
                        <strong>${repo.language || 'Code'}</strong>
                    </span>
                    <span>Updated ${new Date(repo.updated_at).toLocaleDateString()}</span>
                </div>
                <a href="/api/repos/${repo.owner.login}/${repo.name}/download" class="btn-download icon-button" onclick="event.stopPropagation()" aria-label="Download">
                    <span class="material-symbols-outlined">download</span>
                </a>
            </div>
        </article>
    `).join('');
}

function setupViewAllHandler() {
    const link = document.querySelector('.section-heading a[href="#"]');
    if (!link) return;

    if (allRepos.length <= 3) {
        link.style.display = 'none';
        return;
    }

    link.addEventListener('click', (e) => {
        e.preventDefault();
        showingAll = !showingAll;
        renderRepos(showingAll);
        link.textContent = showingAll ? 'Show less' : 'View all';
    });
}

function getLangColor(lang) {
    const colors = {
        'JavaScript': '#f1e05a', 'TypeScript': '#3178c6', 'HTML': '#e34c26',
        'CSS': '#563d7c', 'SCSS': '#c6538c', 'Vue': '#41b883', 'PHP': '#4F5D95',
        'Python': '#3572A5', 'Java': '#b07219', 'C#': '#178600', 'C++': '#f34b7d',
        'C': '#555555', 'Go': '#00ADD8', 'Rust': '#dea584', 'Swift': '#ffac45',
        'Kotlin': '#A97BFF', 'Objective-C': '#438eff', 'R': '#198CE7',
        'SQL': '#e38c00', 'Shell': '#89e051', 'PowerShell': '#012456',
        'Perl': '#0298c3', 'Lua': '#000080', 'Haskell': '#5e5086',
        'Scala': '#c22d40', 'Elixir': '#6e4a7e', 'Dart': '#00B4AB',
        'Ruby': '#701516', 'Clojure': '#db5855', 'CoffeeScript': '#244776',
        'Erlang': '#B83998'
    };
    return colors[lang] || '#8b949e';
}

initializeDashboard();
