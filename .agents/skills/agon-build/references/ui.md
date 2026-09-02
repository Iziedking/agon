# Agon UI source of truth

This brief records the approved AGON direction. It is not a generic AI design
system. It is derived from the current AGON frontend, the user's approved
landing and intro references, the Veil Arena restraint, and the scan-friendly
marketplace pattern the product needs.

## Product feeling

AGON should feel like a measured service desk for work that can be checked.
The first screen tells a new visitor what Agon is, what chain is active, and
where to begin. The first action is discovery, not wallet connection.

## Fixed visual rules

- Keep the AGON mark and wordmark. Do not substitute an ARC or BNB product logo.
- Keep the existing AGON intro animation exactly: dark navy field, pink and
  cyan atmospheric color, centered AGON mark, restrained service previews,
  skip control, enter control, reduced-motion path, and no raw first-paint
  flash.
- Use the existing AGON warm light canvas and traditional dark mode token flip.
- Use AGON pink for the primary interaction signal and failure red only for
  failure. Use BNB yellow as a small network identity signal, never as a second
  competing brand accent.
- Use stencil display type for large AGON statements and mono type for
  identifiers, state labels, prices, chain ids, addresses, hashes, and receipts.
- Prefer flat surfaces, hairlines, editorial grids, clear grouping, and firm
  controls. No glass, decorative gradients, floating particles, emoji, or fake
  metrics.
- Motion must be tied to product meaning, be short, and honor
  `prefers-reduced-motion`.

## Landing hierarchy

The BNB-led landing page should communicate in this order:

1. AGON identity and the current BNB context.
2. The plain-language outcome: find, compare, test, and hire agent services.
3. One clear discovery action such as `EXPLORE AGENTS`.
4. A secondary provider action such as `LIST YOUR AGENT`.
5. Four equal category entrances or another evidence-backed outcome taxonomy.
6. A visible but compact network control at the top right: BNB plus `Mainnet |
   Testnet`.
7. Partner and ecosystem context only after the product action is clear.

Do not lead with ERC-8004, ERC-8183, x402, authority, or sponsor names. Those
are inspection details and should appear when they help a decision.

## Marketplace interaction

Use a dense but calm comparison surface. Each service row or card should make
the following scannable without opening a protocol document:

- the outcome and service name;
- provider identity and service version;
- price and unit;
- network context;
- availability and freshness;
- evidence or test status with its scope;
- authority requirements;
- the next action.

Unverified, unavailable, stale, mismatched, fixture, and live are different
states. Never collapse them into one green trust badge.

## Network control behavior

The top-right BNB control is a product context selector, not a decorative pill.
Mainnet is the default. Opening the control exposes `Mainnet` and `Testnet`.
The Testnet view exposes `BNB Testnet` and `Arc Testnet`. Switching updates the
route or query state, the page title/context strip, data source, explorer, and
write guards together. If a context is not configured, show it as unavailable
with the reason and keep discovery usable where possible.

## Accessibility and mobile

- Keep interactive targets at least 44px high and wide enough to use.
- Preserve keyboard focus and visible focus styles.
- Use one h1 per route and a meaningful heading hierarchy.
- Keep long addresses and hashes breakable without widening the document.
- At 390px, landing content and footer must use normal document flow. Do not
  trap the footer in a fixed-height internal scroller.
- Test the intro, landing, market, detail, Playground, and network switch at
  mobile and desktop widths.
