/**
 * OnboardingScreen — phone-first login flow (Tier 1)
 *
 * Ported from arfs_app's original pre-sync flow (2026-07-17, see
 * arfs_app git tag `pre-fullsync-20260717`) and upstreamed into Alphab2bapp
 * as a fleet-wide, config-gated feature. Gated end-to-end by
 * `config.phoneFirstLoginEnabled` (default OFF) — SplashScreen only routes
 * here when the advisor has opted in. See ConfigContext.js +
 * Models/AdvisorConfigModel.js `phone_first_login_enabled` (aq_backend_github).
 *
 * De-tenanting: the arfs original hardcoded 4 arfs-branded video clips.
 * This version reads the slide list from `useTokens().assets.onboardingSlides`
 * so a variant can override the whole carousel via its own
 * `designs/<variant>/tokens/assets.js` (see theme/assets.js header comment
 * for the default-set caveat — the shipped defaults are arfs's own clips,
 * not yet verified branding-neutral for other tenants).
 */
import React, {useState, useRef, useEffect} from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  StatusBar,
  FlatList,
} from 'react-native';
import Video from 'react-native-video';
import {useNavigation} from '@react-navigation/native';
import useTokens from '../../theme/useTokens';

const {width, height} = Dimensions.get('window');

const AUTO_ADVANCE_INTERVAL = 5000; // 5 seconds

const OnboardingScreen = () => {
  const navigation = useNavigation();
  const tokens = useTokens();
  const slides = tokens?.assets?.onboardingSlides || [];
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef(null);
  const autoAdvanceTimer = useRef(null);

  // Navigate to PhoneLogin first for phone verification.
  // After phone capture, user proceeds to Login for email/password or Google.
  const loginScreen = 'PhoneLogin';

  // Auto-advance slides, navigate to login after last slide
  useEffect(() => {
    if (!slides.length) {
      // No slides resolved (shouldn't happen — theme/assets.js always ships
      // a default set) — don't strand the user on a blank carousel.
      navigation.replace(loginScreen);
      return undefined;
    }

    autoAdvanceTimer.current = setInterval(() => {
      if (currentIndex < slides.length - 1) {
        flatListRef.current?.scrollToIndex({
          index: currentIndex + 1,
          animated: true,
        });
      } else {
        // Last slide finished, go to login
        clearInterval(autoAdvanceTimer.current);
        navigation.replace(loginScreen);
      }
    }, AUTO_ADVANCE_INTERVAL);

    return () => {
      if (autoAdvanceTimer.current) {
        clearInterval(autoAdvanceTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, navigation, loginScreen, slides.length]);

  const handleLoginPress = () => {
    try {
      navigation.replace(loginScreen);
    } catch (error) {
      console.error('Navigation error:', error);
    }
  };

  const onViewableItemsChanged = useRef(({viewableItems}) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index || 0);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const renderSlide = ({item, index}) => {
    // Only render video for current and adjacent slides to prevent memory issues
    const shouldRenderVideo = Math.abs(currentIndex - index) <= 1;

    return (
      <View style={styles.slide}>
        {shouldRenderVideo ? (
          <Video
            source={item.video}
            style={styles.video}
            resizeMode="cover"
            repeat={true}
            muted={true}
            paused={currentIndex !== index}
            onError={(error) => console.log('Video error:', error)}
            bufferConfig={{
              minBufferMs: 2500,
              maxBufferMs: 5000,
              bufferForPlaybackMs: 2500,
              bufferForPlaybackAfterRebufferMs: 2500,
            }}
          />
        ) : (
          <View style={[styles.video, {backgroundColor: '#1a1a2e'}]} />
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" />

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderSlide}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        bounces={false}
      />

      {/* Invisible touchable area over "Login to get started" text in video */}
      <TouchableOpacity
        style={styles.loginTouchArea}
        onPress={handleLoginPress}
        activeOpacity={1}>
        <View />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  slide: {
    width: width,
    height: height,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: width,
    height: height,
  },
  loginTouchArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: height * 0.18,
    backgroundColor: 'transparent',
  },
});

export default OnboardingScreen;
