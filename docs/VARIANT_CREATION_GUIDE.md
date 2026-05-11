# Variant Creation Guide — Build a New App on the AlphaQuark Stack

> **Audience**: Developers creating a new tenant app (different brand,
> different UI) on the AlphaQuark B2B platform. This guide covers both
> app-level design customization (DesignProvider) and SDK widget
> customization (component passthrough).

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Your App (new variant)                              │
│                                                      │
│  designs/yourcompany/                                │
│  ├── tokens/        ← colors, fonts, spacing         │
│  ├── primitives/    ← Button, Card, Input (optional) │
│  ├── composites/    ← OrderRow, TermsModal (optional)│
│  ├── screens/       ← HomeScreen, LoginScreen, etc   │
│  └── index.js       ← registry (what you override)   │
│                                                      │
│  Renders via: useComponent('screens.HomeScreen')     │
│  Resolution: yourcompany → default → error           │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│  Shared Logic (never changes)                        │
│                                                      │
│  src/screens/       ← containers (hooks, state, API) │
│  src/components/    ← business logic components      │
│  src/utils/         ← helpers, formatters            │
│  src/context/       ← React contexts                 │
│  src/services/      ← API services                   │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│  @alphaquark/mobile-sdk                              │
│                                                      │
│  Broker connect, trade execution, sell-auth,         │
│  rebalance — themed via SdkTheme + components prop   │
└─────────────────────────────────────────────────────┘
```

**Principle**: Logic is shared. Rendering is swappable. You design,
the platform orchestrates.

---

## 2. Quick Start (30 minutes to first screen)

```bash
# 1. Create your variant folder
mkdir -p designs/yourcompany/{tokens,screens}

# 2. Copy and customize tokens
cp designs/default/tokens/index.js designs/yourcompany/tokens/index.js
# Edit: change colors, fonts, spacing to your brand

# 3. Create your registry
cat > designs/yourcompany/index.js << 'EOF'
import tokens from './tokens';

export default {
  tokens,
  components: {
    // Override specific screens here. Everything else
    // falls through to designs/default/.
  },
};
EOF

# 4. Register your variant
# In designs/registry.js, add:
#   import yourcompany from './yourcompany';
#   export default { default: defaultVariant, yourcompany };

# 5. Set env vars
echo "DESIGN_VARIANT=yourcompany" >> .env
echo "APP_VARIANT=yourcompany" >> .env

# 6. Run — your tokens apply immediately to every screen
npx react-native start
```

---

## 3. What You Can Override (per layer)

### Layer 1: Tokens (instant brand change)

Edit `designs/yourcompany/tokens/index.js`:

```js
export default {
  colors: {
    brand: { primary: '#FF6B00', gradientStart: '#FF6B00', gradientEnd: '#FF8533' },
    text: { primary: '#1A1A2E', secondary: '#6B7280', muted: '#9CA3AF' },
    surface: { card: '#FFFFFF', background: '#F3F4F6', modal: '#FFFFFF' },
    pnl: { profit: '#00D68F', profitBg: '#E6FFF5', loss: '#FF3D71', lossBg: '#FFE6EC' },
    status: { success: '#00D68F', warning: '#FFB020', error: '#FF3D71' },
  },
  typography: {
    heading: { fontFamily: 'YourFont-Bold', fontSize: 24, fontWeight: '700' },
    title: { fontFamily: 'YourFont-SemiBold', fontSize: 18, fontWeight: '600' },
    body: { fontFamily: 'YourFont-Regular', fontSize: 14 },
    caption: { fontFamily: 'YourFont-Regular', fontSize: 12 },
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radii: { sm: 4, md: 8, lg: 12, pill: 999 },
  shadows: {
    card: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  },
};
```

Effect: every `useTokens()` call across every screen + primitive picks
up your values. Zero code changes.

### Layer 2: Primitives (change base components)

Override only the ones you want different. Each primitive receives
standard props:

```js
// designs/yourcompany/primitives/Button.js
export default function Button({ label, onPress, variant, disabled, style }) {
  // Your custom button implementation
  // variant: 'primary' | 'secondary' | 'ghost' | 'destructive'
}
```

Available primitives: `Text`, `Button`, `Card`, `Input`, `Spinner`,
`Icon`, `Pill`, `Divider`, `Toast`, `ModalShell`.

### Layer 3: Screens (change full layouts)

Each screen receives `({ viewModel, actions })`. The viewModel shape
is documented per screen:

```js
// designs/yourcompany/screens/HomeScreen.js
export default function HomeScreen({ viewModel, actions }) {
  const { advices, portfolios, broker, funds, tabs, modals, userName } = viewModel;
  const { onTabChange, onAdviceTap, onRefresh, onPortfolioTap } = actions;

  return (
    <YourLayout>
      <YourHeader user={userName} />
      <YourTabBar tabs={tabs} onSelect={actions.onTabChange} />
      <YourAdviceList data={advices} onTap={actions.onAdviceTap} />
    </YourLayout>
  );
}
```

### Layer 4: SDK Widgets (change trade/broker/sell-auth UX)

SDK widgets are overridden from `designs/<variant>/sdk/` — same
folder structure as screens. No separate configuration needed:

```
designs/yourcompany/sdk/
├── TradeReviewSheet.js       ← your trade review UI
├── SellAuthGate.js           ← your DDPI/EDIS prompt
├── BrokerCredentialForm.js   ← your broker credential form
└── index.js                  ← exports the overrides
```

```js
// designs/yourcompany/sdk/index.js
import TradeReviewSheet from './TradeReviewSheet';
import SellAuthGate from './SellAuthGate';
export default { tradeReviewSheet: TradeReviewSheet, sellAuthGate: SellAuthGate };
```

The `SdkProviderRoot` reads `designs/<variant>/sdk/` automatically
via `useDesign().sdk` and passes it to `<AqSdkProvider components={...}>`.

10 overridable slots: tradeReviewSheet, tradeExecutionProgress,
tradeResultModal, sellAuthGate, brokerCredentialForm,
brokerWebViewHeader, brokerSelectionList, modifyInvestmentSheet,
rebalancePnlChoice, kitePublisherHeader.

See `docs/SDK_DESIGN_PASSTHROUGH.md § 9` for the full props contract
per slot.

You can also pass overrides directly if you prefer:

```jsx
<AqSdkProvider
  client={client}
  userRef={email}
  theme={{ colors: { primary: '#FF6B00' } }}
  components={{
    tradeReviewSheet: YourReviewSheet,
    tradeResultModal: YourResultModal,
    sellAuthGate: YourSellAuth,
  }}
>
```

---

## 4. Migrated Surfaces (what's swappable today)

### Screens (22 surfaces)

| Screen | Registry Key | Container Location |
|---|---|---|
| HomeScreen | `screens.HomeScreen` | `src/screens/Home/HomeScreen.js` |
| OrderScreen | `screens.OrderScreen` | `src/screens/Home/OrderScreen.js` |
| LoginScreen | `screens.LoginScreen` | `src/screens/Authentication/LoginScreen.js` |
| SignupScreen | `screens.SignupScreen` | `src/screens/Authentication/SignupScreen.js` |
| ResetPassword | `screens.ResetPassword` | `src/screens/Authentication/ResetPassword.js` |
| EmailScreenAppleLogin | `screens.EmailScreenAppleLogin` | `src/screens/Authentication/EmailScreenAppleLogin.js` |
| PhoneNumberScreen | `screens.PhoneNumberScreen` | `src/screens/Authentication/PhoneNumberScreen.js` |
| SignUpRADetails | `screens.SignUpRADetails` | `src/screens/Authentication/SignUpRADetails.js` |
| LogOutScreen | `screens.LogOutScreen` | `src/screens/Authentication/LogOutScreen.js` |
| ChangeAdvisor | `screens.ChangeAdvisor` | `src/screens/AccountSettingScreen/ChangeAdvisor.js` |
| PrivacyPolicyScreen | `screens.PrivacyPolicyScreen` | `src/screens/Drawer/PrivacyPolicyScreen.js` |
| TermandConditionsScreen | `screens.TermandConditionsScreen` | `src/screens/Drawer/TermandConditionsScreen.js` |
| ProductCatalogScreen | `screens.ProductCatalogScreen` | `src/screens/Drawer/ProductCatalogScreen.js` |
| ReviewScreen | `screens.ReviewScreen` | `src/screens/Drawer/ReviewScreen.js` |
| CustomTabBarOrder | `screens.CustomTabBarOrder` | `src/screens/Drawer/CustomTabbarOrder.js` |
| PaymentHistoryScreen | `screens.PaymentHistoryScreen` | `src/screens/Drawer/PaymentHistoryScreen.js` |
| DistributionRowGrid | `screens.DistributionRowGrid` | `src/screens/Drawer/DistributionRowGrid.js` |
| AccountSettingsScreen | `screens.AccountSettingsScreen` | `src/screens/Home/AccountSettingsScreen.js` |
| BespokePerformanceScreen | `screens.BespokePerformanceScreen` | `src/screens/Drawer/BespokePerformanceScreen.js` |
| BlogScreen | `screens.BlogScreen` | `src/components/HomeScreenComponents/KnowledgeHubScreen/BlogScreen.js` |
| VideoScreen | `screens.VideoScreen` | `src/components/HomeScreenComponents/KnowledgeHubScreen/VideoScreen.js` |
| PdfScreen | `screens.PdfScreen` | `src/components/HomeScreenComponents/KnowledgeHubScreen/PdfScreen.js` |
| IgnoreTradesScreen | `screens.IgnoreTradesScreen` | `src/screens/Drawer/IgnoreTradesScreen.js` |
| WatchlistScreen | `screens.WatchlistScreen` | `src/screens/Home/WatchlistScreen.js` |
| ModelPortfolioScreen | `screens.ModelPortfolioScreen` | `src/screens/Drawer/ModelPortfolioScreen.js` |
| MPPerformanceScreen | `screens.MPPerformanceScreen` | `src/screens/Drawer/MPPerformanceScreen.js` |
| MPInvestNowModal | `screens.MPInvestNowModal` | `src/components/ModelPortfolioComponents/MPInvestNowModal.js` |

### Composites (17 surfaces)

| Composite | Registry Key |
|---|---|
| OrderRow | `composites.OrderRow` |
| RebalanceDetailsModal | `composites.RebalanceDetailsModal` |
| TermsModal | `composites.TermsModal` |
| DeleteAdviceModal | `composites.DeleteAdviceModal` |
| GttDetailsModal | `composites.GttDetailsModal` |
| GttSuccessModal | `composites.GttSuccessModal` |
| HoldingsMigrationModal | `composites.HoldingsMigrationModal` |
| BasketTradeModal | `composites.BasketTradeModal` |
| BrokerSelectionModal | `composites.BrokerSelectionModal` |
| StockCard | `composites.StockCard` |
| BasketCard | `composites.BasketCard` |
| CustomTabbarMPPerformance | `composites.CustomTabbarMPPerformance` |
| EmptyStateMP | `composites.EmptyStateMP` |
| ModelPFCard | `composites.ModelPFCard` |
| MPCard | `composites.MPCard` |

### Primitives (10 surfaces)

Text, Button, Card, Input, Spinner, Icon, Pill, Divider, Toast, ModalShell

### SDK Widgets (10 overridable slots via `designs/sdk/`)

tradeReviewSheet, tradeExecutionProgress, tradeResultModal,
sellAuthGate, brokerCredentialForm, brokerWebViewHeader,
brokerSelectionList, modifyInvestmentSheet, rebalancePnlChoice,
kitePublisherHeader

tradeReviewSheet, tradeResultModal, sellAuthGate, tradeExecutionProgress

---

## 5. SDK-Replaced Surfaces (customized via `designs/sdk/`, not `designs/screens/`)

These surfaces are owned by the SDK orchestrator, NOT the design
system. They're customizable via `designs/<variant>/sdk/`:

| Surface | SDK Widget Slot | Why SDK-owned |
|---|---|---|
| MPReviewTradeModal (trade review) | `tradeReviewSheet` | SDK `executeAdvice` renders it |
| RebalanceModal (trade review) | `tradeReviewSheet` | Same — SDK renders review |
| RecommendationSuccessModal (result) | `tradeResultModal` | SDK renders result |
| DDPI/EDIS modals (6 modals) | `sellAuthGate` | SDK renders sell-auth gate |
| Trade progress spinner | `tradeExecutionProgress` | SDK renders during polling |
| Broker credential form | `brokerCredentialForm` | SDK renders on connect |

To customize these, put your components in `designs/<variant>/sdk/`
(not `designs/<variant>/screens/`). See § 4 Layer 4.

**MPInvestNowModal** is the one exception — it's in `designs/screens/`
because payment gateways stay app-owned. The plan selection / pricing /
wizard UI is customizable; payment callbacks are container-only.

**All phases (A–I) are complete.** Every app screen and modal is in
the design system. New surfaces follow the same pattern.

---

## 6. Config & Env Variables

| Variable | Purpose |
|---|---|
| `DESIGN_VARIANT` | Which `designs/<variant>/` folder to load |
| `APP_VARIANT` | Fallback if `DESIGN_VARIANT` not set; also selects backend config |
| `REACT_APP_SDK_INTEGRATION` | Mount SDK provider (true/false) |
| `REACT_APP_USE_SDK_BROKER_FLOW` | Route broker connect through SDK |
| `REACT_APP_USE_SDK_EXECUTE_ADVICE` | Route trade execution through SDK |
| `REACT_APP_ZERODHA_API_KEY` | Kite Publisher basket (or resolved from DB via fetchConfig) |

---

## 7. Testing Your Variant

```bash
# Run with your variant
DESIGN_VARIANT=yourcompany npx react-native start

# Verify token resolution
# In any component: const tokens = useTokens();
# console.log(tokens.colors.brand.primary); // should be YOUR color

# Verify screen resolution
# Navigate to any migrated screen — should render YOUR presentation
# Navigate to non-migrated screen — renders default (expected)

# Verify SDK theming
# Connect a broker — SDK modal should use YOUR theme colors
# Place a test trade — review sheet should be YOUR component (if overridden)
```

---

## 8. Maintenance

When the platform ships a new feature:
- If the feature is in a **migrated** screen → your variant's
  presentation receives the new viewModel fields automatically.
  You MAY need to render them (or ignore them — both work).
- If the feature is in a **non-migrated** screen → renders via
  the legacy code. Your variant isn't affected.
- If the feature adds a new **SDK widget** → your component
  passthrough still works. New SDK props are additive.

When you want to update your variant:
- Pull the latest from the platform repo
- Check `docs/DESIGN_MIGRATION_PROGRESS.md` for newly migrated surfaces
- Override any new screens you want to customize
- Existing overrides continue to work (viewModel contract is stable)
