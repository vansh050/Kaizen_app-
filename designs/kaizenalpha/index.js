/**
 * ============================================================================
 * designs/kaizenalpha — KAIZEN ALPHA VARIANT ROOT
 * ============================================================================
 *
 * Thin overlay on the `default` variant. Today this overrides only the asset
 * slot (logo). All primitives / composites / screens fall through to default
 * via the registry's variant-resolution chain — that means every upstream
 * feature lands in this fork automatically on the next src/ sync.
 *
 * To override a screen, composite, or SDK widget:
 *   1. Add the file under `designs/kaizenalpha/<layer>/<Name>.js`
 *   2. Import it here and register the same dot-namespaced key used by the
 *      default variant (e.g. `'screens.HomeScreen'`, `'composites.BasketCard'`).
 *
 * Keep this folder small. Anything that's a generic improvement belongs
 * upstream, not here. See docs/WHITELABEL_RECIPE.md § "What stays in
 * upstream vs the fork".
 * ============================================================================
 */

import * as tokens from './tokens';

const variant = {
    name: 'kaizenalpha',
    tokens,
    components: {
        // No component overrides yet — defaults flow through automatically.
    },
    // No SDK widget overrides yet — default's `sdk/` bundle flows through
    // via the registry's `sdk` fallback. Override individual slots by
    // registering them on a `sdk: { ... }` map here.
};

export default variant;
