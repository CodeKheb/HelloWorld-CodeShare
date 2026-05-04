const socket = io("http://localhost:3000")

socket.on("connect", () => {
    socket.emit("client_ID", socket.id)
})

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
});

async function initializeMessagesView() {
    try {
        const userRes = await fetch('/api/auth/user');
        const userData = await userRes.json();
        
        if (userData.authenticated) {
            document.getElementById('user-avatar').src = userData.user.avatar;
            document.getElementById('user-name').innerText = userData.user.displayName || userData.user.username;
            document.getElementById('user-login').innerText = `@${userData.user.username}`;
        }
    } catch (error) {
        console.error("Messages view load failed:", error);
        document.getElementById('user-name').innerText = 'CodeShare';
        document.getElementById('user-login').innerText = 'Engineering Team';
    }
}

function initializeResizablePanel() {
    const resizeHandle = document.querySelector('.resize-handle');
    const panel = document.querySelector('.group-panel');
    
    if (!resizeHandle || !panel) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    // Load saved width from localStorage
    const savedWidth = localStorage.getItem('groupPanelWidth');
    if (savedWidth) {
        panel.style.setProperty('--panel-width', savedWidth + 'px');
    }

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

        const diff = startX - e.clientX;
        const newWidth = Math.max(250, Math.min(600, startWidth + diff));
        
        panel.style.setProperty('--panel-width', newWidth + 'px');
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Save width to localStorage
            const currentWidth = panel.offsetWidth;
            localStorage.setItem('groupPanelWidth', currentWidth);
        }
    });
}
