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