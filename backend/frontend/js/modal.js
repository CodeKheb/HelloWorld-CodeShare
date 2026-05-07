/**
 * ========================================
 * MODAL MANAGEMENT SYSTEM
 * ========================================
 * 
 * This module provides reusable modal functionality for the application.
 * It handles opening, closing, and managing modal overlays across all pages.
 * 
 * USAGE:
 *   ModalManager.open('modalId');      // Open a modal
 *   ModalManager.close('modalId');     // Close a modal
 *   ModalManager.registerHandler(...); // Register event handlers
 */

const ModalManager = (() => {
    // ── Core Modal Functions ──────────────────────────────────────
    
    /**
     * Opens a modal by ID
     * @param {string} modalId - The ID of the modal overlay to open
     */
    function open(modalId) {
        const overlay = document.getElementById(modalId);
        if (!overlay) {
            return;
        }

        const modal = overlay.querySelector('.modal');
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
        
        requestAnimationFrame(() => {
            overlay.classList.add('anim-open');
            if (modal) modal.classList.add('open');
        });
    }

    /**
     * Closes a modal by ID
     * @param {string} modalId - The ID of the modal overlay to close
     */
    function close(modalId) {
        const overlay = document.getElementById(modalId);
        if (!overlay) {
            return;
        }

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

    /**
     * Toggles a modal (open if closed, close if open)
     * @param {string} modalId - The ID of the modal overlay to toggle
     */
    function toggle(modalId) {
        const overlay = document.getElementById(modalId);
        if (!overlay) return;
        
        if (overlay.classList.contains('hidden')) {
            open(modalId);
        } else {
            close(modalId);
        }
    }

    /**
     * Clears all input fields within a modal
     * @param {string} modalId - The ID of the modal overlay
     * @param {string[]} fieldIds - Array of field IDs to clear
     */
    function clearFields(modalId, fieldIds) {
        const overlay = document.getElementById(modalId);
        if (!overlay) return;

        fieldIds.forEach(fieldId => {
            const field = overlay.querySelector(`#${fieldId}`);
            if (!field) return;

            if (field.type === 'checkbox' || field.type === 'radio') {
                field.checked = false;
            } else {
                field.value = '';
            }
        });
    }

    /**
     * Resets a modal to its initial state (close and clear fields)
     * @param {string} modalId - The ID of the modal overlay
     * @param {string[]} fieldIds - Array of field IDs to clear
     */
    function reset(modalId, fieldIds = []) {
        clearFields(modalId, fieldIds);
        close(modalId);
    }

    // ── Event Listener Registration ───────────────────────────────

    /**
     * Register open button for a modal
     * @param {string} buttonId - The ID of the button that opens the modal
     * @param {string} modalId - The ID of the modal to open
     */
    function registerOpenButton(buttonId, modalId) {
        const btn = document.getElementById(buttonId);
        if (!btn) {
            return;
        }
        
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            open(modalId);
        });
    }

    /**
     * Register close button for a modal
     * @param {string} buttonId - The ID of the button that closes the modal
     * @param {string} modalId - The ID of the modal to close
     * @param {string[]} fieldIds - Optional field IDs to clear on close
     */
    function registerCloseButton(buttonId, modalId, fieldIds = []) {
        const btn = document.getElementById(buttonId);
        if (!btn) {
            return;
        }
        
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            reset(modalId, fieldIds);
        });
    }

    /**
     * Register overlay click handler (close on background click)
     * @param {string} modalId - The ID of the modal overlay
     * @param {string[]} fieldIds - Optional field IDs to clear on close
     */
    function registerOverlayClose(modalId, fieldIds = []) {
        const overlay = document.getElementById(modalId);
        if (!overlay) {
            return;
        }

        overlay.addEventListener('click', (e) => {
            if (e.target.id === modalId) {
                reset(modalId, fieldIds);
            }
        });
    }

    /**
     * Register Escape key to close modal
     * @param {string} modalId - The ID of the modal to close
     * @param {string[]} fieldIds - Optional field IDs to clear on close
     */
    function registerEscapeKey(modalId, fieldIds = []) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const overlay = document.getElementById(modalId);
                if (overlay && !overlay.classList.contains('hidden')) {
                    reset(modalId, fieldIds);
                }
            }
        });
    }

    /**
     * Complete modal setup with all standard behaviors
     * @param {string} modalId - The ID of the modal overlay
     * @param {string} openBtnId - The ID of the open button
     * @param {string} closeBtnId - The ID of the close button
     * @param {string[]} fieldIds - Array of field IDs to clear on close
     */
    function registerModal(modalId, openBtnId, closeBtnId, fieldIds = []) {
        registerOpenButton(openBtnId, modalId);
        registerCloseButton(closeBtnId, modalId, fieldIds);
        registerOverlayClose(modalId, fieldIds);
        registerEscapeKey(modalId, fieldIds);
    }

    // ── Form Submission Handler ───────────────────────────────────

    /**
     * Helper to disable/enable button during submission
     * @param {HTMLElement} button - The button element
     * @param {boolean} loading - True to show loading state, false to restore
     * @param {string} loadingText - Text to show during loading
     */
    function setButtonLoading(button, loading, loadingText = 'Loading...') {
        if (loading) {
            button.disabled = true;
            button.dataset.originalText = button.textContent;
            button.textContent = loadingText;
        } else {
            button.disabled = false;
            button.textContent = button.dataset.originalText || 'Submit';
        }
    }

    // ── Public API ────────────────────────────────────────────────
    return {
        open,
        close,
        toggle,
        reset,
        clearFields,
        registerOpenButton,
        registerCloseButton,
        registerOverlayClose,
        registerEscapeKey,
        registerModal,
        setButtonLoading
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModalManager;
}
