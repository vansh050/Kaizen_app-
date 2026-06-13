/**
 * kaizenalpha variant asset overrides.
 *
 * Re-exports `DEFAULT_ASSETS` from the upstream `src/theme/assets.js` contract
 * with Kaizen Alpha's brand logo. Only the logo is overridden; the faded
 * watermark falls through to upstream's default until we ship a faded variant.
 *
 * See docs/WHITELABEL_RECIPE.md § "Adding a new whitelabel" step 4.
 */

const merge = (base, override) => {
    if (!override || typeof override !== 'object') return base;
    const out = { ...base };
    for (const key of Object.keys(override)) {
        const value = override[key];
        if (value === undefined || value === null) continue;
        out[key] = value;
    }
    return out;
};

export const DEFAULT_ASSETS = {
    logoPng: require('../assets/logo.png'),
    logoFadedPng: require('../../../src/assets/fadedlogo.png'),
};

export const buildAssets = (config) => merge(DEFAULT_ASSETS, config?.assetTokens);

export default buildAssets;
