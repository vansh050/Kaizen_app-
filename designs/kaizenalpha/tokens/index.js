/**
 * kaizenalpha variant token bundle.
 *
 * Re-exports the canonical token implementations from `src/theme/` (so colors,
 * spacing, typography, radii, shadows keep flowing from upstream and stay
 * advisor-overridable via ConfigContext) and overrides only the asset slot
 * with the Kaizen Alpha brand logo via `./assets`.
 *
 * To override another token family (e.g. variant-specific spacing), replace
 * the corresponding `from '../../../src/theme/<file>'` line with a local
 * `from './<file>'` and add the file under this folder.
 */

export {
    DEFAULT_TOKENS as DEFAULT_COLORS,
    buildColors,
    isValidColor,
} from '../../../src/theme/colors';

export { DEFAULT_SPACING, buildSpacing } from '../../../src/theme/spacing';
export { DEFAULT_TYPOGRAPHY, buildTypography } from '../../../src/theme/typography';
export { DEFAULT_RADII, buildRadii } from '../../../src/theme/radii';
export { DEFAULT_SHADOWS, buildShadows } from '../../../src/theme/shadows';

export { DEFAULT_ASSETS, buildAssets } from './assets';
