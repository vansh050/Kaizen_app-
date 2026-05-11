
import React, { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Config from '../utils/safeConfig';
import APP_VARIANTS from '../utils/Config';
import { generateToken } from '../utils/SecurityTokenManager';

const ConfigContext = createContext();

export const useConfig = () => {
    return useContext(ConfigContext);
};

// Default variant for this fork. This repo ships only the kaizenalpha
// tenant; if APP_VARIANT is missing or unrecognised, fall back to
// kaizenalpha so we never silently render a foreign brand.
const DEFAULT_VARIANT = 'kaizenalpha';

export const ConfigProvider = ({ children }) => {
    const selectedVariant = Config?.APP_VARIANT || DEFAULT_VARIANT;
    // Ensure the variant exists in APP_VARIANTS; otherwise fall back
    // to DEFAULT_VARIANT (alphaquark) — never to a variant whose
    // sharedUIConfig contains foreign branding.
    const validVariant = APP_VARIANTS[selectedVariant] ? selectedVariant : DEFAULT_VARIANT;
    if (!Config?.APP_VARIANT) {
        // Loud warning so a missing env var is visible during dev /
        // staging builds rather than silently picking the default.
        // eslint-disable-next-line no-console
        console.warn(
            '[ConfigContext] APP_VARIANT not set in .env — defaulting to',
            DEFAULT_VARIANT,
            '. Set APP_VARIANT=kaizenalpha in .env to suppress this warning.',
        );
    }
    const initialConfig = { ...APP_VARIANTS[validVariant], selectedVariant: validVariant };
    const [config, setConfig] = useState(initialConfig);
    const [loading, setLoading] = useState(true);

    // 2026-05-07: hydrate the theme/branding from AsyncStorage on
    // mount BEFORE the API fetch runs. This way if the API call fails
    // on a relaunch (intermittent network, server slow, DNS hiccup),
    // the UI still renders with the last-known-good production theme
    // from cache instead of falling back to the bare static
    // APP_VARIANTS defaults — those defaults are intentionally
    // generic (`gradient1/2: '#F0F0F0'`, `placeholderText: '#FFFFFF'`)
    // and produce a near-blank washed-out home screen for any
    // production tenant whose theme has been loaded before.
    //
    // The fresh API response in fetchConfig below still wins the
    // moment it lands; this only affects the first-paint window.
    useEffect(() => {
        const hydrateFromCache = async () => {
            try {
                const cachedJson = await AsyncStorage.getItem('@app:configThemeCache');
                if (!cachedJson) return;
                const cached = JSON.parse(cachedJson);
                // Only adopt cache for the SAME variant to avoid
                // showing tenant A's theme briefly to tenant B's
                // build (e.g. dev switching between APP_VARIANTs).
                if (cached?.selectedVariant && cached.selectedVariant !== validVariant) return;
                console.log('[ConfigContext] hydrated theme from AsyncStorage cache');
                setConfig(prev => ({ ...prev, ...cached }));
            } catch (e) {
                console.warn('[ConfigContext] hydrateFromCache error:', e?.message);
            }
        };
        hydrateFromCache();
    }, [validVariant]);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                // Get base URL and subdomain from environment variables
                const baseUrl = Config.REACT_APP_NODE_SERVER_API_URL || 'http://localhost:8001/';
                const subdomain = Config.REACT_APP_ADVISOR_SUBDOMAIN || Config.REACT_APP_HEADER_NAME || 'kaizenalpha';

                // Construct the API URL
                const apiUrl = `${baseUrl}api/app-advisor/get?appSubdomain=${subdomain}`;

                console.log('🔍 Fetching config from:', apiUrl);

                // Prepare headers with authentication
                const headers = {
                    'Content-Type': 'application/json',
                    'X-Advisor-Subdomain': Config.REACT_APP_X_ADVISOR_SUBDOMAIN || Config.REACT_APP_HEADER_NAME || subdomain,
                    'aq-encrypted-key': Config.REACT_APP_AQ_ENCRYPTED_KEY || generateToken(
                        Config.REACT_APP_AQ_KEYS,
                        Config.REACT_APP_AQ_SECRET
                    ),
                };

                console.log('🔍 Request headers:', {
                    'X-Advisor-Subdomain': headers['X-Advisor-Subdomain'],
                    'aq-encrypted-key': headers['aq-encrypted-key'] ? 'SET' : 'MISSING',
                });

                const response = await axios.get(apiUrl, { headers });

                console.log('API Response:', response.data);

                if (response.data && response.data.data) {
                    const apiData = response.data.data; // API returns data nested under response.data.data

                    console.log('✅ API Data received from database:', {
                        appName: apiData.appName,
                        subdomain: apiData.subdomain,
                        themeColor: apiData.themeColor,
                        mainColor: apiData.mainColor,
                        gradient1: apiData.gradient1,
                        gradient2: apiData.gradient2,
                        secondaryColor: apiData.secondaryColor,
                        hasApiKeys: !!apiData.apiKeys,
                        advisorSpecificTag: apiData.apiKeys?.advisorSpecificTag,
                        advisorRaCode: apiData.apiKeys?.advisorRaCode,
                        brokerConnectRedirectUrl: apiData.brokerConnectRedirectUrl,
                        customDomain: apiData.customDomain,
                    });
                    console.log('[ConfigContext] Redirect URL resolution:', {
                        fromAPI: apiData.brokerConnectRedirectUrl,
                        fromEnv: Config.REACT_APP_BROKER_CONNECT_REDIRECT_URL,
                        final: apiData.brokerConnectRedirectUrl || Config.REACT_APP_BROKER_CONNECT_REDIRECT_URL || '',
                    });

                    // Map API response to APP_VARIANTS structure
                    // Priority: API data first, then fallback to static APP_VARIANTS for UI-specific fields
                    const newConfig = {
                        // Start with static UI defaults (colors, gradients, layout settings)
                        ...initialConfig,

                        // Override with API data (this is the primary source)
                        selectedVariant: validVariant, // Add selectedVariant to the config

                        // ============================================================================
                        // BASIC INFO
                        // ============================================================================
                        appName: apiData.appName || initialConfig.appName,
                        subdomain: apiData.subdomain || initialConfig.subdomain,

                        // ============================================================================
                        // CONTACT INFO
                        // ============================================================================
                        email: apiData.email || apiData.contactEmail || initialConfig.email,
                        supportEmail: apiData.supportEmail || apiData.contactEmail || initialConfig.supportEmail,
                        contactEmail: apiData.contactEmail || initialConfig.contactEmail,
                        adminEmail: apiData.adminEmail || initialConfig.adminEmail,

                        // ============================================================================
                        // AUTHENTICATION
                        // ============================================================================
                        // Backend (apiData) wins over the static Config.js fallback for
                        // googleWebClientId. Defensive `.trim()` because the backend has been
                        // observed returning the value with trailing whitespace
                        // (`'713385591555-…googleusercontent.com '`), which Google Sign-In
                        // rejects with DEVELOPER_ERROR if passed verbatim.
                        googleWebClientId:
                            initialConfig.googleWebClientId ||
                            (typeof apiData.googleWebClientId === 'string'
                                ? apiData.googleWebClientId.trim()
                                : apiData.googleWebClientId),

                        // ============================================================================
                        // DIGIO CONFIGURATION
                        // Backend stores in nested digioConfig object, so we extract from there
                        // digioCheck: 'beforePayment' or 'afterPayment'
                        // ============================================================================
                        digioCheck: apiData.digioConfig?.digioCheck || apiData.digioCheck || apiData.REACT_APP_DIGIO_CHECK || Config.REACT_APP_DIGIO_CHECK || 'beforePayment',
                        digioEnabled: apiData.digioConfig?.digioEnabled !== undefined
                            ? apiData.digioConfig.digioEnabled
                            : (apiData.digioEnabled !== undefined ? apiData.digioEnabled : true),
                        otpBasedAuthentication: apiData.digioConfig?.otpBasedAuthentication || apiData.otpBasedAuthentication || apiData.REACT_APP_OTP_BASED_AUTHENTICATION || false,
                        aadhaarBasedAuthentication: apiData.digioConfig?.aadhaarBasedAuthentication !== undefined
                            ? apiData.digioConfig.aadhaarBasedAuthentication
                            : true,

                        // ============================================================================
                        // FEATURE FLAGS
                        // Backend stores in nested featureFlags object
                        // ============================================================================
                        modelPortfolioEnabled: apiData.featureFlags?.modelPortfolioEnabled !== undefined
                            ? apiData.featureFlags.modelPortfolioEnabled
                            : (apiData.modelPortfolioEnabled !== undefined ? apiData.modelPortfolioEnabled : true),
                        bespokePlansEnabled: apiData.featureFlags?.bespokePlansEnabled !== undefined
                            ? apiData.featureFlags.bespokePlansEnabled
                            : (apiData.bespokePlansEnabled !== undefined ? apiData.bespokePlansEnabled : true),
                        brokerConnectEnabled: apiData.featureFlags?.brokerConnectEnabled !== undefined
                            ? apiData.featureFlags.brokerConnectEnabled
                            : true,
                        // When true, the client-side 09:15–15:30 IST gate is bypassed so
                        // advisors can queue orders after hours (broker decides accept/AMO).
                        // Default true — gate is bypassed unless an admin explicitly sets
                        // this flag to false on the advisor config record.
                        allowAfterHoursOrders: apiData.featureFlags?.allowAfterHoursOrders !== undefined
                            ? apiData.featureFlags.allowAfterHoursOrders
                            : (apiData.allowAfterHoursOrders !== undefined ? apiData.allowAfterHoursOrders : true),

                        // ============================================================================
                        // PAYMENT CONFIGURATION
                        // Supported platforms: 'razorpay', 'cashfree', 'payu'
                        // ============================================================================
                        paymentPlatform: apiData.paymentPlatform || 'cashfree',
                        razorpayKey: apiData.razorpayKey || '',
                        cashfreeAppId: apiData.cashfreeAppId || '',
                        payuMerchantKey: apiData.payuMerchantKey || '',

                        // ============================================================================
                        // BRANDING & THEME COLORS
                        // Static config (whitelabel/appVariants.js) wins over backend for all
                        // branding fields — this is a dedicated whitelabel fork so the bundled
                        // branding is authoritative. Backend values are only used as fallback.
                        // ============================================================================
                        themeColor: initialConfig.themeColor || apiData.themeColor,
                        logo: initialConfig.logo || apiData.logo,
                        toolbarlogo: initialConfig.toolbarlogo || apiData.toolbarlogo,
                        backgroundLogo: apiData.backgroundLogo || null,
                        showBackgroundLogo: apiData.showBackgroundLogo !== undefined ? apiData.showBackgroundLogo : true,
                        mainColor: initialConfig.mainColor || apiData.mainColor,
                        secondaryColor: initialConfig.secondaryColor || apiData.secondaryColor,
                        gradient1: initialConfig.gradient1 || apiData.gradient1,
                        gradient2: initialConfig.gradient2 || apiData.gradient2,
                        placeholderText: initialConfig.placeholderText || apiData.placeholderText,

                        // ============================================================================
                        // LAYOUT CONFIGURATION
                        // ============================================================================
                        homeScreenLayout: initialConfig.homeScreenLayout || apiData.homeScreenLayout,

                        // ============================================================================
                        // CARD STYLING
                        // Note: API uses camelCase (cardBorderWidth), static config uses CardborderWidth
                        // ============================================================================
                        CardborderWidth: initialConfig.CardborderWidth ?? apiData.cardBorderWidth ?? apiData.CardborderWidth,
                        cardElevation: initialConfig.cardElevation ?? apiData.cardElevation,
                        cardverticalmargin: initialConfig.cardverticalmargin ?? apiData.cardVerticalMargin ?? apiData.cardverticalmargin,

                        // ============================================================================
                        // BOTTOM TAB / NAVIGATION STYLING
                        // Note: API uses camelCase, static config uses mixed case
                        // ============================================================================
                        tabIconColor: initialConfig.tabIconColor || apiData.tabIconColor,
                        bottomTabBorderTopWidth: initialConfig.bottomTabBorderTopWidth ?? apiData.bottomTabBorderTopWidth,
                        bottomTabbg: initialConfig.bottomTabbg || apiData.bottomTabBg || apiData.bottomTabbg,
                        selectedTabcolor: initialConfig.selectedTabcolor || apiData.selectedTabColor || apiData.selectedTabcolor,

                        // ============================================================================
                        // BASKET COLORS (for stock basket cards)
                        // Note: API uses camelCase, static config uses lowercase
                        // ============================================================================
                        basket1: initialConfig.basket1 || apiData.basket1,
                        basket2: initialConfig.basket2 || apiData.basket2,
                        basketcolor: initialConfig.basketcolor || apiData.basketColor || apiData.basketcolor,
                        basketsymbolbg: initialConfig.basketsymbolbg || apiData.basketSymbolBg || apiData.basketsymbolbg,

                        // ============================================================================
                        // API KEYS (nested object) - API data takes priority
                        // ============================================================================
                        apiKeys: {
                            ...(initialConfig.apiKeys || {}),
                            ...(apiData.apiKeys || {}),
                        },

                        // ============================================================================
                        // BROKER API KEYS - Legacy format for backward compatibility
                        // These are exposed at config root level for components that use
                        // configData.config.REACT_APP_* format
                        // ============================================================================
                        REACT_APP_ANGEL_ONE_API_KEY: apiData.apiKeys?.angelOneApiKey || Config.REACT_APP_ANGEL_ONE_API_KEY || '',
                        REACT_APP_ZERODHA_API_KEY: apiData.apiKeys?.zerodhaApiKey || Config.REACT_APP_ZERODHA_API_KEY || '',
                        REACT_APP_BROKER_CONNECT_REDIRECT_URL: apiData.brokerConnectRedirectUrl || Config.REACT_APP_BROKER_CONNECT_REDIRECT_URL || '',

                        // ============================================================================
                        // PAYMENT MODAL UI CUSTOMIZATION
                        // ============================================================================
                        paymentModal: {
                            ...(initialConfig.paymentModal || {}),
                            ...(apiData.paymentModal || {}),
                        },

                        // ============================================================================
                        // EMPTY STATE UI COLORS
                        // ============================================================================
                        EmptyStateUi: {
                            ...(APP_VARIANTS.EmptyStateUi || {}),
                            ...(apiData.EmptyStateUi || apiData.emptyStateUi || {}),
                        },

                        // ============================================================================
                        // SEMANTIC COLOR TOKENS (optional advisor override)
                        // Nested object — partial overrides of the default semantic palette
                        // defined in src/theme/colors.js. See docs/COLOR_TOKENS.md for the
                        // full token catalog.
                        // ============================================================================
                        colorTokens: apiData.colorTokens || {},

                        // ============================================================================
                        // TENANT TAGLINES (optional advisor override)
                        // ============================================================================
                        // Hero copy + trust badges shown on auth screens. The alphanomy
                        // variant reads these to override its built-in tenant copy
                        // ("Folios · Research", "Your Alpha, Engineered.", "SEBI Registered",
                        // etc.) — see designs/alphanomy/screens/LoginScreen.js +
                        // SignupScreen.js. Falls back to the hardcoded variant copy when
                        // a field is missing.
                        //
                        // Backend shape (`appadvisors.taglines`):
                        //   {
                        //     login: {
                        //       brandSubtag,   // string — sub-tag under brand name
                        //       heroTitle,     // string — main hero heading (allows \n)
                        //       heroSubtitle,  // string — supporting copy
                        //       trustBadges,   // [{ icon: 'check'|'shield'|...,  label: string }]
                        //     },
                        //     signup: {
                        //       brandSubtag,
                        //       heroTitle,
                        //       heroSubtitle,    // careful with claims like "50,000+ investors"
                        //                        // — legal/compliance review per tenant
                        //     },
                        //     home: {
                        //       recommendationsSubtitle,    // string — under "Recommendations" section
                        //       modelPortfoliosSubtitle,    // string — under "Model Portfolios" section
                        //       bespokePlansSubtitle,       // string — under "Top Bespoke Plans" section
                        //     }
                        //   }
                        //
                        // Compliance note: any quantitative claim (investor counts, returns,
                        // performance numbers) must be tenant-approved before going live.
                        // Surfacing taglines via backend lets legal vary copy per tenant
                        // without a code change.
                        taglines: apiData.taglines || null,
                    };

                    console.log('✅ Using newConfig from API for APP_VARIANTS:', {
                        // Basic Info
                        appName: newConfig.appName,
                        subdomain: newConfig.subdomain,
                        // Theme & Branding
                        themeColor: newConfig.themeColor,
                        mainColor: newConfig.mainColor,
                        homeScreenLayout: newConfig.homeScreenLayout,
                        // Authentication
                        googleWebClientId: newConfig.googleWebClientId,
                        // Digio Config
                        digioCheck: newConfig.digioCheck,
                        digioEnabled: newConfig.digioEnabled,
                        // Feature Flags
                        modelPortfolioEnabled: newConfig.modelPortfolioEnabled,
                        bespokePlansEnabled: newConfig.bespokePlansEnabled,
                        // API Keys
                        advisorSpecificTag: newConfig.apiKeys?.advisorSpecificTag,
                        advisorRaCode: newConfig.apiKeys?.advisorRaCode,
                    });

                    setConfig(newConfig);

                    // Sync fresh config to AsyncStorage so TradeContext also gets updated values
                    try {
                        const storedJson = await AsyncStorage.getItem('@app:advisorConfig');
                        if (storedJson) {
                            const stored = JSON.parse(storedJson);
                            const updatedStored = {
                                ...stored,
                                config: {
                                    ...(stored.config || {}),
                                    REACT_APP_BROKER_CONNECT_REDIRECT_URL: newConfig.REACT_APP_BROKER_CONNECT_REDIRECT_URL,
                                    REACT_APP_ANGEL_ONE_API_KEY: newConfig.REACT_APP_ANGEL_ONE_API_KEY,
                                    REACT_APP_ZERODHA_API_KEY: newConfig.REACT_APP_ZERODHA_API_KEY,
                                },
                            };
                            await AsyncStorage.setItem('@app:advisorConfig', JSON.stringify(updatedStored));
                            console.log('[ConfigContext] Synced fresh config to AsyncStorage');
                        }
                    } catch (syncErr) {
                        console.warn('[ConfigContext] Failed to sync to AsyncStorage:', syncErr.message);
                    }
                }
            } catch (error) {
                console.error('❌ Error fetching app config:', error);
                console.error('❌ Error details:', {
                    message: error.message,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    responseData: error.response?.data,
                });
                // Fallback to default config is already set in initial state
            } finally {
                setLoading(false);
            }
        };

        fetchConfig();
    }, []); // Empty dependency array - run only once on mount

    return (
        <ConfigContext.Provider value={{ ...config, configLoading: loading }}>
            {children}
        </ConfigContext.Provider>
    );
};
