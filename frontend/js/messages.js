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

            // Join the current group/channel
            // TODO: CHANGE THIS LOGIC groupId from db
            const groupId = 'frontend-architecture'; 
            socket.emit('join-group', groupId);

            console.log('User initialized:', window.currentUser);
        }
    } catch (error) {
        console.error("Messages view load failed:", error);
        window.location.href = '/login';
    }
}

function initializeMessageComposer() {
    const sendButton = document.querySelector('.composer__send');
    const messageInput = document.querySelector('.composer__input');

    if (!sendButton || !messageInput) {
        console.error('Composer elements not found');
        return;
    }

    // Get current group/channel ID from page context
    const groupId = 'frontend-architecture'; // TODO: Get this dynamically

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

        if (!window.currentUser) {
            alert('Please log in to send messages');
            return;
        }

        const messageData = {
            text: text.trim(),
            author: window.currentUser.username,
            authorName: window.currentUser.displayName || window.currentUser.username,
            avatar: window.currentUser.avatar,
            timestamp: new Date().toISOString()
        };

        console.log('Sending message:', messageData);

        // Send to group
        socket.emit("client-message", messageData);

        displayMessage(messageData);

        // Clear input
        messageInput.value = '';
        messageInput.style.height = 'auto';
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
    const resizeHandle = document.querySelector('.resize-handle');
    const panel = document.querySelector('.group-panel');

    if (!resizeHandle || !panel) return;

    let isResizing = false;
    let lastMouseX = 0;

    const savedWidth = localStorage.getItem('groupPanelWidth');
    if (savedWidth) {
        panel.style.setProperty('--panel-width', `${savedWidth}px`);
    }

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizeHandle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        // Prevent text selection while dragging
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaX = e.clientX - lastMouseX;
        const newWidth = parseInt(panel.style.getPropertyValue('--panel-width'), 10) + deltaX;

        // Constraints
        if (newWidth >= 250 && newWidth <= 600) {
            panel.style.setProperty('--panel-width', `${newWidth}px`);
        }

        lastMouseX = e.clientX;
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;

        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Save the exact computed width
        const finalWidth = panel.offsetWidth;
        localStorage.setItem('groupPanelWidth', finalWidth);

        // Smooth scroll to bottom when resizing
        panel.scrollTop = panel.scrollHeight;
    });
}
