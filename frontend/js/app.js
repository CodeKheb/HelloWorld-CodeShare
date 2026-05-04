document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-route]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const route = e.currentTarget.getAttribute('data-route');
            window.location.href = `/${route}`;
        });
    });
});

let allRepos = []; // Store all repos globally
let showingAll = false; // Track current display state

async function initializeDashboard() {
    try {
        // 1. Fetch User Data
        const userRes = await fetch('/api/auth/user');
        const userData = await userRes.json();
        if (userData.authenticated) {
            document.getElementById('user-avatar').src = userData.user.avatar || userData.user.avatar_url || '';
            document.getElementById('user-name').innerText = userData.user.displayName || userData.user.username;
            document.getElementById('user-login').innerText = `@${userData.user.username}`;
        }
        
        // 2. Fetch Repositories
        const repoRes = await fetch('/api/auth/repos');
        allRepos = await repoRes.json();
        
        // 3. Render initial 3 repos
        renderRepos(false);
        
        // 4. Setup "View all" link click handler
        setupViewAllHandler();
        
    } catch (error) {
        console.error("Dashboard load failed:", error);
        document.getElementById('repo-grid').innerHTML = "<p>Error loading repositories.</p>";
    }
}

function renderRepos(showAll) {
    const repoGrid = document.getElementById('repo-grid');
    const reposToShow = showAll ? allRepos : allRepos.slice(0, 3);
    
    if (reposToShow.length === 0) {
        repoGrid.innerHTML = "<p>No repositories found.</p>";
        return;
    }
    
    repoGrid.innerHTML = reposToShow.map(repo => `
        <article class="group-card">
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
                        <strong>${repo.language || 'Code'}</strong>
                    </span>
                    <span>Updated ${new Date(repo.updated_at).toLocaleDateString()}</span>
                </div>
                <a href="${repo.html_url}" target="_blank" class="secondary-button" style="text-decoration:none; font-size: 12px; padding: 4px 8px;">View</a>
            </div>
        </article>
    `).join('');
}

function setupViewAllHandler() {
    const viewAllLink = document.querySelector('.section-heading a[href="#"]');
    
    if (viewAllLink) {
        viewAllLink.addEventListener('click', (e) => {
            e.preventDefault();
            showingAll = !showingAll;
            renderRepos(showingAll);
            
            // Update link text
            viewAllLink.textContent = showingAll ? 'Show less' : 'View all';
        });
        
        // Hide "View all" link if there are 3 or fewer repos
        if (allRepos.length <= 3) {
            viewAllLink.style.display = 'none';
        }
    }
}

initializeDashboard();
