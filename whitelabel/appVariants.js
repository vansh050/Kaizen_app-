/**
 * ============================================================================
 * whitelabel/appVariants — TENANT CONFIG ROOT (fork: kaizenalpha)
 * ============================================================================
 *
 * 🔴 PER-FORK FILE. NOT BYTE-IDENTICAL ACROSS REPOS. 🔴
 *
 * Colors sourced from kaizen_alpha web repo:
 *   src/SeperateDesigns/LandingPageDesigns/KaizenLandingPage.jsx
 *   CSS variables: --purple #A199FF, --black #000000, --near-black #0A0A0A,
 *   --dark #1A1A1A, --yellow #F2F261, --purple-dark #8B82F0
 * ============================================================================
 */

import KaizenAlphaLogo from '../src/assets/AppLogo/kaizenalpha.png';

const APP_VARIANTS = {
  kaizenalpha: {
    // ── Brand colors (dark purple + black, from KaizenLandingPage.jsx CSS vars) ──
    themeColor: '#A199FF',        // --purple (primary accent)
    logo: KaizenAlphaLogo,
    toolbarlogo: KaizenAlphaLogo,
    homeScreenLayout: 'layout2',
    mainColor: '#0A0A0A',         // --near-black (primary background)
    secondaryColor: '#FFFFFF',    // --white
    gradient1: '#0A0A0A',         // near-black (login bg top)
    gradient2: '#2D2B5A',         // dark purple-black (login bg bottom)
    placeholderText: '#999999',   // --light-gray

    // ── Cards ──
    CardborderWidth: 0,
    cardElevation: 3,
    cardverticalmargin: 3,

    // ── Bottom tab bar ──
    tabIconColor: '#FFFFFF',
    bottomTabBorderTopWidth: 1,
    bottomTabbg: '#0A0A0A',       // --near-black
    selectedTabcolor: '#A199FF',  // --purple

    // ── Basket/portfolio colors ──
    basketcolor: '#2D2B5A',       // dark purple
    basketsymbolbg: '#A199FF',    // --purple
    basket1: '#1A1840',           // deep dark purple
    basket2: '#2D2B5A',           // medium dark purple

    // ── Auth ──
    googleWebClientId: '174847117466-0e6dhmt698bm7suh3n2ani4h98bq1mm5.apps.googleusercontent.com',
    subdomain: 'kaizenalpha',
    advisorRaCode: 'kaizenalpha',

    // ── Payment modal ──
    paymentModal: {
      headerBg: '#A199FF',
      stepActiveColor: '#A199FF',
      stepCompletedColor: '#8B82F0',
      buttonPrimaryBg: '#A199FF',
      buttonSecondaryBg: '#8B82F0',
      accentColor: '#A199FF',
      checkboxActiveColor: '#A199FF',
      linkColor: '#A199FF',
      progressBarColor: '#A199FF',
    },
  },

  EmptyStateUi: {
    backgroundColor: '#2D2B5A',     // dark purple
    darkerColor: '#1A1840',
    mediumColor: '#252350',
    brighterColor: '#A199FF',       // --purple
    mutedColor: '#6B68C0',
    lightColor: '#EDEAFF',          // --purple-subtle
    mediumLightShade: '#C8C3FF',    // --purple-light
    lightWarmColor: '#F2EEDF',      // --eggshell
  },
};

export default APP_VARIANTS;
