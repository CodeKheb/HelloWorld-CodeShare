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
                    clearKeyCache();
                    roomSecrets.clear()
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

// ── Load Modals ──────────────────────────────
// Load the modals.html file and inject it into the page
(async function loadModals() {
    try {
        const response = await fetch('/modals.html');
        const html = await response.text();
        
        // Create container and inject modals
        const container = document.createElement('div');
        container.id = 'modalsContainer';
        container.innerHTML = html;
        document.body.appendChild(container);

        // Initialize all modal handlers after modals are loaded
        initializeAllModals();
    } catch (error) {
        console.error('Failed to load modals:', error);
    }
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
                <a href="/api/repos/${repo.owner.login}/${repo.name}/download" class="btn-download" onclick="event.stopPropagation()" aria-label="Download">
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
