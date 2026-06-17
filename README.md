# Fractionalized Real Estate (BSV)

Demo app showing how to tokenize a real-estate listing and sell fractional “shares” using the BSV blockchain.

The core idea is:
- A *property* is represented by a reference UTXO.
- *Shares* are represented as 1 sat ordinal outputs that carry a `bsv-20` style inscription.
- Issuer-held shares (mint + change) use a **1-of-2 multisig** between the seller and the server; an investor's owned shares are a **single-sig P2PKH** they self-custody.
- Every output is locked to a **unique, freshly-derived key** (type-42 / BRC-42) rather than one reused key — see *Key derivation & storage* below.
- The server performs **server-side minting and transfer construction** for provenance, while users self-custody their own shares.

## Key derivation & storage

Outputs are **not** locked to a single fixed key. Each output is locked to a unique child key derived with a per-output **nonce** (the `keyID` in a type-42 derivation), which avoids key reuse (privacy/linkability + key-exposure hygiene).

- **Protocol:** `TOKEN_PROTOCOL = [2, 'fractionalized token']` (security level 2, counterparty-bound). Helpers in `src/utils/tokenDerivation.ts`.
- **Identity:** the type-42 counterparty is always a wallet's **root identity key** (`getPublicKey({identityKey:true})`) — the user's id (also the JWT subject) and the server's `SERVER_IDENTITY_KEY` — never a derived key. (Type-42 child keys only line up when both sides use identity keys.)
- **Multisig outputs** (mint/change, listings) derive *both* parties' child keys from one nonce (`deriveMultisigPair`). The committed order is `[seller, server]`.
- **Investor P2PKH** shares are locked to the investor's derived child key; only the investor can spend them.
- **Payment UTXOs** (the prefunded fee pool + buyers' fee payments) are derived too — a 1-of-2 multisig(server+user) with a **fresh nonce per payment-change output** (no static key reuse). The fee pool's derivation chains via `properties.paymentDerivation`.
- **Where the nonce lives:** in the owner's **wallet basket** via `internalizeAction` (`src/utils/internalizeToBasket.ts`, basket `fractionalized.tokens`) for self-custody/recovery, **and** in a DB index for O(1) hot-path lookup:
  - `properties.currentDerivation` — how to spend `txids.currentOutpoint` (`{keyId, counterparty, counterpartyDerivedKey, order, beef}`).
  - `properties.paymentDerivation` — how to spend the current fee-pool UTXO.
  - `shares.keyId` / `shares.counterparty` — an investor's P2PKH derivation.
  - `market_items` derivation fields — a listing multisig's derivation (server's perspective).
- **Source transactions:** the transaction creator carries the BEEF — the server stores a carry-forward BEEF (`currentDerivation.beef`) and listings are backed up in `listing_beefs`; the overlay is a **fallback only** (`src/utils/fetchTokenSourceTx.ts`). BEEFs cross the wire base64-encoded (`src/utils/beefEncoding.ts`).
- **Legacy / dual-path:** the locking-script templates default to the old fixed scheme (`[0,'fractionalized'] / '0' / self`), so pre-migration tokens still spend; new outputs use the derived scheme.

Full design: `docs/specs/2026-06-16-derived-key-multisig-baskets-design.md`.

## How it works (high level)

- **Minting (tokenize property)** — `src/app/api/tokenize/create-property/route.ts`
  - Creates a *property token* output (the on-chain identity anchor referenced by every share's `OP_RETURN`).
  - Mints the “shares” ordinal (1 sat) to a derived multisig(server+seller) via `OrdinalsP2MS`, with a `bsv-20` inscription.
  - Server internalizes the mint into its basket and writes `currentDerivation`; the client (seller) internalizes its copy from the returned payload.
  - Funds future transfer fees via a prefunded multisig `PaymentUtxo` pool (per-payment derived keys; server-operational).

- **Purchasing shares (primary)** — `src/app/api/share-purchase/route.ts`
  - Spends the current share multisig (source from the carry-forward BEEF; overlay fallback).
  - Sends the purchased portion to the investor as a 1 sat ordinal locked to the investor's **derived** key (`OrdinalsP2PKH`); investor internalizes it.
  - Remaining shares go back as a derived multisig “change” (the new `currentOutpoint`). A final sale (all shares bought) omits the change output and marks the property `funded`.

- **Marketplace (secondary)** — custodial multisig model (see also the OrdLock alternative in `docs/specs/2026-06-17-orderlock-marketplace-design.md`)
  - **List** — `src/app/api/new-listing/route.ts`: the seller's client moves their P2PKH share into a server+seller multisig and posts the tx; the server validates the byte-exact lock + `traceShareChain`, and backs up the BEEF in `listing_beefs`.
  - **Buy** — `src/app/api/listing-purchase/route.ts`: the server spends the listing multisig (BEEF from `listing_beefs`) to a buyer's derived P2PKH; the buyer's payment funds the fee.
  - **Cancel** — `src/app/api/cancel-listing/route.ts`: the seller's client spends the listing multisig back to their own derived P2PKH; the server validates and removes the listing.

- **Integrity / chain tracing**
  - Each share stores `parentTxid` (spent outpoint) + `transferTxid` (new outpoint); `traceShareChain` walks the lineage to the original mint.
  - Properties track `txids.originalMintTxid` (immutable), `txids.currentOutpoint` (spend next), `txids.paymentTxid` (fee pool).

## Key components

- **Server wallet**: `src/lib/serverWallet.ts` — `@bsv/wallet-toolbox` storage + signer.
- **Derived-key utils**: `tokenDerivation.ts`, `internalizeToBasket.ts`, `tokenIndex.ts`, `beefEncoding.ts`, `fetchTokenSourceTx.ts`, `reindexFromBasket.ts` (recovery).
- **Locking scripts**
  - `src/utils/ordinalsP2MS.ts`: 1-of-2 multisig + ordinal inscription (derivation-parametrized `unlock`, legacy default).
  - `src/utils/ordinalsP2PKH.ts`: single-sig investor output + ordinal inscription (derivation-parametrized `unlock`, legacy default).
  - `src/utils/paymentUtxo.ts`: 1-of-2 multisig fee UTXO (per-payment derived keys; legacy default for back-compat).
- **Overlay interaction**: `src/hooks/overlayFunctions.ts` — broadcast is non-fatal (overlay is supplementary indexing); queries by txid as a source-tx fallback.
- **Auth**: JWT cookie `verified`; `src/middleware.ts`; `src/utils/apiAuth.ts`.

## Tech stack

- Next.js (App Router, webpack — see note below)
- MongoDB (collections enforce JSON-schema validators)
- `@bsv/sdk`, `@bsv/wallet-toolbox`, `@bsv/wallet-helper`, `@bsv/auth`

## Local development

### Prerequisites

- Node.js 20+
- A MongoDB instance (connection string must include a database name)
- A BSV wallet-toolbox storage service (see `WALLET_STORAGE_URL`)

### Install

```bash
npm install
```

> **Bundler:** this project pins webpack (`next dev --webpack` / `next build --webpack`) because the `next.config.ts` `webpack` config is required to stub `react-native-get-random-values` server-side. Next 16 defaults to Turbopack, which would reject that config.

### Environment variables

Set the following (for local dev, a `.env` file works):

- `MONGODB_URI`
- `SERVER_PRIVATE_KEY` (server wallet private key, hex)
- `NEXT_PUBLIC_SERVER_IDENTITY_KEY` (server wallet **identity** key, compressed hex — the type-42 derivation counterparty *and* the auth-proof server identity; must equal the server wallet's `getIdentityKey()`)
- `NEXT_PUBLIC_SERVER_PUBLIC_KEY` (server's `[0,'fractionalized']/'0'` key — largely vestigial post-migration; kept for back-compat / `assertEnv`)
- `WALLET_STORAGE_URL` (wallet-toolbox storage URL)
- `JWT_SECRET` (used to sign the `verified` cookie)

Notes:
- **Do not commit real secrets** (private keys, JWT secrets, production DB URIs).
- The login route sets cookies with `secure: true`. Over plain `http://localhost` the browser may refuse to set the cookie; run behind HTTPS (or adjust cookie policy in code) for local dev.

### Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Main API routes

- `POST /api/auth/login`, `POST /api/auth/logout`
- `POST /api/tokenize/create-property`
- `POST /api/share-purchase`
- `POST /api/new-listing`, `POST /api/listing-purchase`, `POST /api/cancel-listing`
- `GET /api/listings`, `GET /api/my-listings`, `GET /api/my-shares`, `GET /api/my-selling`, `GET /api/properties`

## Security notes

- This repo is a demo; treat it as educational code.
- The current marketplace is **custodial** (the server co-holds a key in listing multisigs and could move a listed share). A trustless OrdLock alternative is specced in `docs/specs/2026-06-17-orderlock-marketplace-design.md`.
- Server-side minting means the server has signing capability; **protect `SERVER_PRIVATE_KEY`** and rotate it if it was ever committed.
- Production deployments should include proper rate limiting, request validation, monitoring, and key management (HSM / vault).
