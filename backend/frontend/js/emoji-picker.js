const EMOJIS = ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '💪', '🙏', '✍️', '💅', '🤳', '💃', '🕺', '👯', '🧘', '🛀', '🛌', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⭐', '🌟', '💫', '✨', '🔥', '💯', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝'];

let pickerEl = null;

function createEmojiPicker() {
    const picker = document.createElement('div');
    picker.className = 'emoji-picker hidden';
    picker.innerHTML = `
        <div class="emoji-picker__grid">
            ${EMOJIS.map(e => `<button class="emoji-btn" type="button">${e}</button>`).join('')}
        </div>
    `;
    return picker;
}

function initEmojiPicker() {
    const emojiToggle = document.querySelector('.composer .icon-button[aria-label="Insert emoji"]');
    const composer = document.querySelector('.composer');
    const input = document.querySelector('.composer__input');

    if (!emojiToggle || !composer || !input) return;

    pickerEl = createEmojiPicker();
    composer.appendChild(pickerEl);

    emojiToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        pickerEl.classList.toggle('hidden');
    });

    pickerEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('emoji-btn')) {
            const emoji = e.target.textContent;
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const text = input.value;
            input.value = text.slice(0, start) + emoji + text.slice(end);
            input.selectionStart = input.selectionEnd = start + emoji.length;
            input.focus();
            pickerEl.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!pickerEl.contains(e.target) && e.target !== emojiToggle) {
            pickerEl.classList.add('hidden');
        }
    });
}

document.addEventListener('DOMContentLoaded', initEmojiPicker);
