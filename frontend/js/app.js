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
        const repoRes = await fetch('/api/repos');
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
        <article class="group-card" style="cursor: pointer;" onclick="if(!event.target.closest('.btn-download')) window.open('${repo.html_url}', '_blank')">
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
                        <span class="lang-color-dot" style="background-color: ${getLangColor(repo.language)}; width: 12px; height: 12px; border-radius: 50%; display: inline-block; margin-right: 6px;"></span>
                        <strong>${repo.language || 'Code'}</strong>
                    </span>
                    <span>Updated ${new Date(repo.updated_at).toLocaleDateString()}</span>
                </div>
                <a href="/api/repos/${repo.owner.login}/${repo.name}/download" class="btn-download" onclick="event.stopPropagation()">
                    <span class="material-symbols-outlined">download</span>
                </a>
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

function getLangColor(lang) {
    const colors = {
        // Web Development
        'JavaScript': '#f1e05a',
        'TypeScript': '#3178c6',
        'HTML': '#e34c26',
        'CSS': '#563d7c',
        'SCSS': '#c6538c',
        'Vue': '#41b883',
        'PHP': '#4F5D95',

        // Systems & General Purpose
        'Python': '#3572A5',
        'Java': '#b07219',
        'C#': '#178600',
        'C++': '#f34b7d',
        'C': '#555555',
        'Go': '#00ADD8',
        'Rust': '#dea584',
        'Swift': '#ffac45',
        'Kotlin': '#A97BFF',
        'Objective-C': '#438eff',

        // Data & Scripting
        'R': '#198CE7',
        'SQL': '#e38c00',
        'Shell': '#89e051',
        'PowerShell': '#012456',
        'Perl': '#0298c3',
        'Lua': '#000080',

        // Functional & Others
        'Haskell': '#5e5086',
        'Scala': '#c22d40',
        'Elixir': '#6e4a7e',
        'Dart': '#00B4AB',
        'Ruby': '#701516',
        'Clojure': '#db5855',
        'CoffeeScript': '#244776',
        'Erlang': '#B83998'
    };

    // Return the specific color or a default GitHub-style gray
    return colors[lang] || '#8b949e';
}

// Modal show/hide with simple animation
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

// Open modal - select the "Create Group" button in the topbar
const createGroupBtn = document.querySelector('.topbar-actions .secondary-button');
if (createGroupBtn) {
  createGroupBtn.addEventListener('click', () => {
    showModal();
  });
}

// Close modal function
function closeModal() {
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

initializeDashboard();
