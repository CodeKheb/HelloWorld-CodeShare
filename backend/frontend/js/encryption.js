const keyCache = new Map();

export async function deriveKey(roomSecret) {
    if (keyCache.has(roomSecret)) return keyCache.get(roomSecret);

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(String(roomSecret)),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: new TextEncoder().encode('codeshare-salt-v1'),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );

    keyCache.set(roomSecret, key);
    return key;
}

export async function encryptMessage(text, roomSecret) {
    const key = await deriveKey(roomSecret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...combined));
}

export async function decryptMessage(encryptedBase64, roomSecret) {
    try {
        const key = await deriveKey(roomSecret);
        const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );

        return new TextDecoder().decode(decrypted);
    } catch {
        // Fallback for messages stored before encryption was added
        return encryptedBase64;
    }
}

export function clearKeyCache() {
    keyCache.clear();
}