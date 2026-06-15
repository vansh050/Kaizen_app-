/**
 * _AppHeader — kaizenalpha variant helper (NOT a registry surface).
 *
 * Top bar rendered above the HomeScreen body: Kaizen logo + greeting + bell +
 * avatar + a horizontally-scrollable Nifty/Sensex/BankNifty ticker strip.
 * Underscore prefix + folder collocation keep this private to the variant.
 *
 * Live data wiring:
 *   - `tickers` (from `home.tickers`, fed by `useHomeMarketSummary`)
 *     drives the strip. When the array is empty or all rows still show the
 *     '—' placeholder (WebSocket warmup), the strip falls back to a static
 *     SAMPLE_TICKERS list so the header still looks complete during boot.
 *
 * Matches the alphanomy variant's _AppHeader pattern (Phase E.3, 2026-05-04)
 * so all variant additions stay self-contained.
 */

import React from 'react';
import {
    View,
    Text,
    Image,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Bell } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';

const KAIZEN_LOGO = require('../assets/logo.png');

// Kaizen Alpha brand palette (sourced from the web landing page
// /Users/pratik/PycharmProjects/kaizen_alpha/src/SeperateDesigns/
// LandingPageDesigns/KaizenLandingPage.jsx).
const PURPLE = '#A199FF';
const PURPLE_DARK = '#8B82F0';
const NEAR_BLACK = '#0A0A0A';
const DARK = '#1A1A1A';
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_MUTED = 'rgba(255,255,255,0.55)';
const SURFACE_SUBTLE = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.10)';
const DANGER = '#FF6B72';
const SUCCESS = '#3DFFA0';

const SAMPLE_TICKERS = [
    { name: 'Nifty 50', value: '23,995.7', change: '▼ 97.00 (0.40%)', dir: 'down' },
    { name: 'Sensex', value: '76,886.9', change: '▼ 416.72 (0.54%)', dir: 'down' },
    { name: 'BankNifty', value: '55,400', change: '▼ 0.80%', dir: 'down' },
];

const todayLabel = () => {
    try {
        return new Date().toLocaleDateString('en-GB', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return '';
    }
};

const initialsFrom = (raw = '') => {
    const local = (raw || '').split('@')[0] || 'You';
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return ((local[0] || 'Y') + (local[1] || '')).toUpperCase();
};

const greetingFrom = (raw = '') => {
    const local = (raw || '').split('@')[0] || 'there';
    const first = local.split(/[._-]+/)[0] || local;
    return first.charAt(0).toUpperCase() + first.slice(1);
};

const AppHeader = ({ userEmail = '', userName = '', config, tickers }) => {
    const ref = userEmail || config?.advisorRaCode || '';
    const greeting = userName
        ? userName.trim().split(/\s+/)[0]
        : greetingFrom(ref);
    const initials = userName
        ? userName
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((p) => p[0].toUpperCase())
              .join('')
        : initialsFrom(ref);

    const hasLiveData =
        Array.isArray(tickers) &&
        tickers.length > 0 &&
        tickers.some((t) => t?.value && t.value !== '—');
    const data = hasLiveData ? tickers : SAMPLE_TICKERS;

    const navigation = useNavigation();
    const canNavigate =
        navigation && typeof navigation.navigate === 'function';
    const onBellPress = () => {
        if (canNavigate) navigation.navigate('NotificationListScreen');
    };
    const onAvatarPress = () => {
        if (!canNavigate) return;
        const parent = navigation.getParent?.();
        if (parent && typeof parent.navigate === 'function') {
            parent.navigate('More');
        } else {
            navigation.navigate('More');
        }
    };

    return (
        <LinearGradient
            colors={[NEAR_BLACK, DARK, '#221E5C']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
        >
            <View style={styles.row1}>
                <View style={styles.logoWrap}>
                    <Image
                        source={KAIZEN_LOGO}
                        style={styles.headMark}
                        resizeMode="contain"
                    />
                    <View>
                        <Text style={styles.greeting}>Hello, {greeting} 👋</Text>
                        <Text style={styles.subDate}>{todayLabel()}</Text>
                    </View>
                </View>
                <View style={styles.actions}>
                    <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={onBellPress}
                        style={styles.iconCircle}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Bell size={18} color={TEXT_PRIMARY} strokeWidth={1.8} />
                        <View style={styles.notifDot} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={onAvatarPress}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <LinearGradient
                            colors={[PURPLE, PURPLE_DARK]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.avatar}
                        >
                            <Text style={styles.avatarText}>{initials}</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </View>
            </View>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tickerStrip}
                contentContainerStyle={styles.tickerStripContent}
            >
                {data.map((t) => (
                    <View key={t.name} style={styles.chip}>
                        <Text style={styles.tickerName}>{t.name}</Text>
                        <Text style={styles.tickerVal}>{t.value}</Text>
                        <Text
                            style={[
                                styles.tickerChg,
                                {
                                    color: t.dir === 'down' ? DANGER : SUCCESS,
                                },
                            ]}
                        >
                            {t.change}
                        </Text>
                    </View>
                ))}
            </ScrollView>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: 18,
        paddingTop: 8,
        paddingBottom: 16,
    },
    row1: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 8,
        paddingBottom: 14,
    },
    logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headMark: {
        width: 44,
        height: 44,
        borderRadius: 13,
        backgroundColor: '#FFFFFF',
    },
    greeting: {
        fontSize: 16,
        fontWeight: '700',
        color: TEXT_PRIMARY,
    },
    subDate: {
        fontSize: 11,
        color: TEXT_MUTED,
        marginTop: 2,
    },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    iconCircle: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: SURFACE_SUBTLE,
        borderWidth: 1,
        borderColor: BORDER,
        alignItems: 'center',
        justifyContent: 'center',
    },
    notifDot: {
        position: 'absolute',
        top: 9,
        right: 9,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: DANGER,
        borderWidth: 1.5,
        borderColor: NEAR_BLACK,
    },
    avatar: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarText: {
        fontSize: 13,
        color: '#0A0A0A',
        letterSpacing: 0.5,
        fontWeight: '800',
    },
    tickerStrip: { paddingBottom: 2 },
    tickerStripContent: { gap: 10, paddingRight: 18 },
    chip: {
        backgroundColor: SURFACE_SUBTLE,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 13,
        paddingHorizontal: 14,
        paddingVertical: 9,
    },
    tickerName: {
        fontSize: 10,
        fontWeight: '600',
        color: TEXT_MUTED,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    tickerVal: {
        fontSize: 14,
        fontWeight: '700',
        color: TEXT_PRIMARY,
        marginVertical: 3,
        letterSpacing: -0.2,
        fontVariant: ['tabular-nums'],
    },
    tickerChg: {
        fontSize: 10,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
});

export default AppHeader;
