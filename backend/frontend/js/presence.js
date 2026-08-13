/**
 * Presence client — tracks which users are online via socket.io.
 *
 * Exposes:
 *   window.onlineUserIds      -> Set of online user ids (string)
 *   window.isUserOnline(id)   -> boolean
 *   window.refreshPresenceDots() -> re-tints every [data-presence-user] element
 *
 * Pages render presence dots as:
 *   <span class="presence-dot presence-dot--offline" data-presence-user="123"></span>
 * and presence.js keeps them in sync (green = online, gray = offline).
 *
 * Requires the socket.io client (`io`) to be loaded first.
 */
(function () {
    const onlineUserIds = new Set();
    window.onlineUserIds = onlineUserIds;

    window.isUserOnline = function isUserOnline(userId) {
        if (userId == null) return false;
        return onlineUserIds.has(String(userId));
    };

    window.refreshPresenceDots = function refreshPresenceDots() {
        document.querySelectorAll('[data-presence-user]').forEach((el) => {
            const online = window.isUserOnline(el.getAttribute('data-presence-user'));
            el.classList.toggle('presence-dot--online', online);
            el.classList.toggle('presence-dot--offline', !online);
        });
    };

    function applyOnlineList(ids) {
        onlineUserIds.clear();
        (ids || []).forEach((id) => onlineUserIds.add(String(id)));
        window.refreshPresenceDots();
        window.dispatchEvent(new CustomEvent('presence:update'));
    }

    // Determine socket URL based on current environment
    const getSocketUrl = () => {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return `http://${window.location.hostname}:${window.location.port || 3000}`;
        }
        return window.location.origin;
    };

    let socket = null;
    try {
        socket = io(getSocketUrl(), { withCredentials: true });
    } catch (err) {
        console.error('[presence] socket.io client not loaded:', err);
    }

    if (socket) {
        socket.on('connect', () => {
            socket.emit('client_ID', socket.id);
        });

        socket.on('presence:update', (data) => {
            applyOnlineList(data && data.online);
        });
    }

    // Seed initial presence state (then the socket stream keeps it fresh)
    fetch('/api/users/online', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
            if (data && data.success) applyOnlineList(data.online);
        })
        .catch(() => {});
})();
