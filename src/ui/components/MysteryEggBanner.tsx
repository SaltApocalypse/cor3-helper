/**
 * Card-local easter egg banner. It intentionally shows no payout details:
 * only the message and the dramatic styling. The Chinese line is the meme and
 * stays untranslated.
 */
export function MysteryEggBanner() {
    return (
        <div class="v2-mystery-egg" role="status" aria-live="polite">
            <span class="v2-mystery-egg-aura" aria-hidden="true" />
            <strong class="v2-mystery-egg-text">我从地狱里回来了！</strong>
        </div>
    );
}
