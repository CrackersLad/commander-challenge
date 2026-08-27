// Booster Pack Opening Reveal Animation

export function playBoosterPackReveal(containerEl, onRevealed, playSound) {
    if (!containerEl) {
        if (onRevealed) onRevealed();
        return;
    }

    if (playSound) playSound('sfx-choose');

    const packWrapper = document.createElement('div');
    packWrapper.className = 'pack-opening-overlay';
    packWrapper.innerHTML = `
        <div class="booster-pack-3d">
            <div class="booster-foil-sheen"></div>
            <div class="booster-art-card">
                <div class="booster-set-logo">⚡ COMMANDER DRAFT ⚡</div>
                <div class="booster-subtext">Cracking Booster Pack...</div>
            </div>
            <div class="booster-tear-strip"></div>
        </div>
    `;

    containerEl.appendChild(packWrapper);

    // Trigger opening sequence
    setTimeout(() => {
        packWrapper.classList.add('is-tearing');
        if (playSound) playSound('sfx-click');
    }, 400);

    setTimeout(() => {
        packWrapper.classList.add('is-bursting');
        if (onRevealed) onRevealed();
    }, 900);

    setTimeout(() => {
        packWrapper.classList.add('fade-out');
        setTimeout(() => packWrapper.remove(), 400);
    }, 1300);
}
