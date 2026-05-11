# SDK Design Passthrough — Full Component Customization

> **Status**: design draft (2026-05-03). Extends `SDK_ORCHESTRATION_CONTRACT.md`
> § 7 (theming) and § 8 (host hooks) with a deeper customization model:
> the host app can pass FULL React/Flutter components to the SDK, not
> just theme tokens and color overrides.
>
> **Motivation**: Different tenants need different UX for the same
> orchestration steps. Theme tokens (colors, typography, spacing) cover
> cosmetic differences but NOT structural ones:
> - Tenant A wants a bottom-sheet review; Tenant B wants a full-screen review.
> - Tenant A shows a progress bar during polling; Tenant B shows a Lottie animation.
> - Tenant A's result modal has a "Share to WhatsApp" button; Tenant B doesn't.
> - Tenant A's sell-auth gate shows a video tutorial; Tenant B shows text-only steps.
>
> Theme tokens can't express these differences. Full component passthrough can.

---

## 1. The design principle

> **The SDK provides default components for every orchestration step.
> The host app may REPLACE any of them with its own component that
> receives the same props (viewModel + actions). The SDK's orchestration
> logic stays unchanged — only the rendering swaps.**

This is the same container/presentation split the Alphab2bapp design-system
migration uses (`designs/<variant>/screens/` replace `src/screens/` via
the `DesignProvider` registry). The SDK extends this pattern to its own
widgets.

---

## 2. What's replaceable

Every SDK-rendered surface in the orchestration flow is a named slot:

| Slot name | Default widget | Props contract (viewModel + actions) |
|---|---|---|
| `tradeReviewSheet` | `<TradeReviewSheet>` | `{ trades, brokerName, totalEstimate, isPlacing, onConfirm, onCancel }` |
| `tradeExecutionProgress` | `<TradeExecutionProgress>` | `{ progress: { step, totalTrades, completedTrades, currentSymbol }, results }` |
| `tradeResultModal` | `<TradeResultModal>` | `{ results: TradeResultRow[], onClose, originalStockDetails? }` |
| `sellAuthGate` | `<SellAuthGate>` | `{ brokerName, userDetails, onAuthorized, onDeclined, onDdpiHelpRequested }` |
| `brokerSelector` | (Phase E — future) | `{ brokers, onSelect, onCancel }` |
| `reauthFlow` | (Phase E — future) | `{ brokerName, onReauthed, onCancel }` |

Each slot has a TYPED props contract. The SDK calls the slot with those
props. If the host provides a custom component for that slot, the SDK
renders it instead of the default. The custom component MUST accept the
same props shape and call the same action callbacks — otherwise the
orchestration flow breaks.

---

## 3. How the host passes custom components

### TypeScript (RN)

```tsx
<AqSdkProvider
  client={client}
  userRef={email}
  theme={theme}
  components={{
    tradeReviewSheet: MyCustomReviewSheet,
    tradeResultModal: MyCustomResultModal,
    sellAuthGate: MyCustomSellAuthGate,
    // tradeExecutionProgress: not overridden → SDK default
  }}
>
  <App />
</AqSdkProvider>
```

Each entry in `components` is a React component (or null to use default).
The SDK's `ExecuteAdviceOverlay` renders the resolved component for each
slot:

```tsx
// Inside ExecuteAdviceOverlay:
const ReviewSheet = resolvedComponents.tradeReviewSheet || DefaultTradeReviewSheet;
return <ReviewSheet {...reviewProps} />;
```

### Dart (Flutter)

```dart
AqSdkScope(
  client: client,
  userRef: email,
  theme: theme,
  componentOverrides: AqSdkComponentOverrides(
    tradeReviewSheet: (context, props) => MyCustomReviewSheet(props: props),
    tradeResultModal: (context, props) => MyCustomResultModal(props: props),
  ),
  child: App(),
)
```

Flutter uses builder functions (`Widget Function(BuildContext, Props)`)
instead of component references (Dart doesn't have the same component-as-
value pattern as React).

---

## 4. Props contracts (typed)

### TradeReviewSheetProps

```ts
interface TradeReviewSheetProps {
  trades: Array<{
    symbol: string;
    exchange: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    orderType: string;
    price?: number;
    productType: string;
    variant?: string;
  }>;
  brokerName?: string;
  totalEstimate?: number;
  isPlacing: boolean;
  onConfirm: () => void;   // MUST be called to proceed
  onCancel: () => void;    // MUST be called to abort
}
```

The host's custom component MUST call `onConfirm()` or `onCancel()`.
If neither is called, the orchestrator hangs. The SDK will enforce a
timeout (30s) and treat no-action as cancellation.

### TradeResultModalProps

```ts
interface TradeResultModalProps {
  results: TradeResultRow[];  // per SDK_ORCHESTRATION_CONTRACT.md § 2
  onClose: () => void;        // MUST be called to dismiss
  originalStockDetails?: Record<string, unknown>[];
}
```

### SellAuthGateProps

```ts
interface SellAuthGateProps {
  brokerName: string;
  userDetails: Record<string, unknown>;
  onAuthorized: () => void;   // MUST be called to proceed
  onDeclined: () => void;     // MUST be called to abort
  onDdpiHelpRequested?: (broker: string) => void;
}
```

### TradeExecutionProgressProps

```ts
interface TradeExecutionProgressProps {
  progress: ExecuteAdviceProgress;
  results: Record<string, unknown>[];
}
```

---

## 5. Resolution order

For each slot, the SDK resolves the component in this order:

1. **Host-provided override** (`components.tradeReviewSheet`) — if non-null, use it.
2. **Variant-specific override** (if the SDK supports variant-level overrides in the future — `designs/<variant>/sdk/tradeReviewSheet`).
3. **SDK default** (`@alphaquark/mobile-sdk` built-in component).

This mirrors the app's `DesignProvider` resolution order (variant → default).

---

## 6. What's NOT replaceable

The orchestration ENGINE is not swappable — only the rendering.
Specifically:

- The sequence of steps (validate session → sell-auth → review →
  place → poll → result) is fixed.
- The backend routing (bespoke vs MP → different endpoints) is fixed.
- The post-placement chain (model-portfolio-db-update, status-check-queue) is fixed.
- Error handling (OrchestrationError codes, typed recovery actions) is fixed.
- The `AdviceResult` output shape is fixed.

Custom components change HOW each step LOOKS, not WHAT it DOES.

---

## 7. Implementation plan

| Step | What | Estimate |
|---|---|---|
| 7a | Define the `AqSdkComponentOverrides` type (RN + Flutter) | 0.5 day |
| 7b | Add `components` prop to `AqSdkProvider` / `AqSdkScope` | 0.5 day |
| 7c | `ExecuteAdviceOverlay` resolves components from context | 0.5 day |
| 7d | `SellAuthGate` resolves from context | 0.5 day |
| 7e | Export the default components so hosts can extend (not replace from scratch) | 0.5 day |
| 7f | Document the props contract for each slot with examples | 1 day |
| 7g | Ship a reference custom component in the Alphab2bapp app as proof-of-concept | 1 day |

---

## 8. Example: custom TradeReviewSheet

```tsx
// In the host app:
function MyCustomReviewSheet({ trades, brokerName, onConfirm, onCancel, isPlacing }) {
  return (
    <View style={myStyles.container}>
      <LinearGradient colors={['#1a1a2e', '#16213e']} style={myStyles.header}>
        <Text style={myStyles.title}>Review Your Trades</Text>
        <Text style={myStyles.subtitle}>{brokerName} • {trades.length} trades</Text>
      </LinearGradient>

      <FlatList
        data={trades}
        renderItem={({ item }) => (
          <MyTradeRow
            symbol={item.symbol}
            type={item.transactionType}
            qty={item.quantity}
          />
        )}
      />

      <View style={myStyles.actions}>
        <Button title="Cancel" onPress={onCancel} variant="outline" />
        <Button
          title={isPlacing ? "Placing..." : "Confirm & Place"}
          onPress={onConfirm}
          disabled={isPlacing}
          variant="primary"
        />
      </View>
    </View>
  );
}

// Mount:
<AqSdkProvider
  client={client}
  userRef={email}
  components={{ tradeReviewSheet: MyCustomReviewSheet }}
>
```

The host's component receives the same data; it just renders differently.
The SDK's orchestration logic doesn't change — it still waits for
`onConfirm` or `onCancel` to proceed.

---

## 9. The `designs/sdk/` folder — SDK overrides in the design system

SDK widget overrides live alongside app screen overrides in the
design-system folder structure:

```
designs/
├── default/
│   ├── screens/         ← app screen presentations
│   ├── sdk/             ← SDK widget overrides (empty = SDK defaults)
│   │   └── index.js
│   └── index.js         ← registry includes sdk: {}
│
└── yourcompany/
    ├── screens/         ← your app screens
    ├── sdk/             ← your SDK widgets
    │   ├── TradeReviewSheet.js
    │   ├── SellAuthGate.js
    │   ├── BrokerCredentialForm.js
    │   └── index.js     ← exports { tradeReviewSheet, sellAuthGate, ... }
    └── index.js         ← includes sdk: sdkOverrides
```

**How it's wired**: `SdkProviderRoot.js` reads `useDesign().sdk` from
the active variant's registry and passes it as the `components` prop
to `<AqSdkProvider>`. The resolution chain is:

1. `designs/<active-variant>/sdk/index.js` → component map
2. `SdkProviderRoot` reads it via `useDesign().sdk`
3. `AqSdkProvider` receives it as `components={sdkOverrides}`
4. `ExecuteAdviceOverlay` + other SDK widgets resolve per slot

A custom variant overrides SDK widgets the same way it overrides app
screens — create the file, export it from the sdk/index.js, register
in the variant's root index.js. No separate configuration.

### Creating a custom SDK widget

```jsx
// designs/yourcompany/sdk/TradeReviewSheet.js
export default function TradeReviewSheet({
  trades,
  brokerName,
  totalEstimate,
  isPlacing,
  onConfirm,    // MUST call to proceed
  onCancel,     // MUST call to abort
}) {
  return (
    <YourCard>
      <YourHeader>Review {trades.length} trades</YourHeader>
      <YourTradeList data={trades} />
      <YourActions>
        <YourButton onPress={onCancel}>Cancel</YourButton>
        <YourButton onPress={onConfirm} loading={isPlacing}>
          Place Orders
        </YourButton>
      </YourActions>
    </YourCard>
  );
}

// designs/yourcompany/sdk/index.js
import TradeReviewSheet from './TradeReviewSheet';
export default { tradeReviewSheet: TradeReviewSheet };

// designs/yourcompany/index.js
import sdk from './sdk';
export default {
  name: 'yourcompany',
  tokens,
  components: { ... },
  sdk,   // ← SDK overrides picked up automatically
};
```

### All 10 overridable SDK slots

| Slot | Default Widget | Props Contract | When Rendered |
|---|---|---|---|
| `tradeReviewSheet` | `TradeReviewSheet` | `{ trades[], brokerName?, totalEstimate?, isPlacing, onConfirm, onCancel }` | Before trade placement |
| `tradeExecutionProgress` | `TradeExecutionProgress` | `{ progress: { step, totalTrades, completedTrades, currentSymbol }, results[] }` | During polling |
| `tradeResultModal` | `TradeResultModal` | `{ results: TradeResultRow[], onClose }` | After placement |
| `sellAuthGate` | `SellAuthGate` | `{ brokerName, userDetails, onAuthorized, onDeclined, onDdpiHelpRequested? }` | Before SELL trades |
| `brokerCredentialForm` | `BrokerCredentialForm` | `{ brokerName, schema, onSubmit, onCancel }` | Broker connect |
| `brokerWebViewHeader` | (internal header) | `{ brokerName, title, onClose }` | OAuth WebView |
| `brokerSelectionList` | (internal list) | `{ brokers[], onSelect, onCancel }` | Broker picker |
| `modifyInvestmentSheet` | `ModifyInvestmentSheet` | `{ modelName, modelId, currentAmount, onClose, onSuccess? }` | Modify investment |
| `rebalancePnlChoice` | (future) | `{ investedAmount, currentValue, netPnl, onChoose(includePnl) }` | Rebalance review |
| `kitePublisherHeader` | (internal header) | `{ onClose }` | Zerodha basket |

---

## 10. Relationship to the design-system migration

The app's design-system migration (`designs/<variant>/`) and the SDK's
component passthrough serve the same goal: per-tenant visual
customization without forking code. They operate at different layers:

| Layer | Mechanism | Scope |
|---|---|---|
| **App screens** | `DesignProvider` registry (`designs/<variant>/screens/`) | App-owned screens (HomeScreen, OrderScreen, auth screens) |
| **SDK widgets** | `AqSdkProvider` `components` prop | SDK-owned widgets (review sheet, result modal, sell-auth gate) |

Both use the container/presentation split. Both resolve
variant → default. The design-system migration is for surfaces that
stay app-owned; the SDK passthrough is for surfaces that move to SDK
but remain visually customizable.

Long-term, the two could merge: the app's `DesignProvider` feeds
token-level overrides to the SDK's `SdkTheme`, and the
`components` prop handles structural overrides. This avoids two
separate theming systems.
