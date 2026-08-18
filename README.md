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

- **Protocol:** `TOKEN_PROTOCOL = [2, 'fractionalized token']` (security level 2, counterparty-bound). Helpers in `shared/bsv/tokenDerivation.ts`.
- **Identity:** the type-42 counterparty is always a wallet's **root identity key** (`getPublicKey({identityKey:true})`) — the user's id (also the JWT subject) and the server's `SERVER_IDENTITY_KEY` — never a derived key. (Type-42 child keys only line up when both sides use identity keys.)
- **Multisig outputs** (mint/change, listings) derive *both* parties' child keys from one nonce (`deriveMultisigPair`). The committed order is `[seller, server]`.
- **Investor P2PKH** shares are locked to the investor's derived child key; only the investor can spend them.
- **Payment UTXOs** (the prefunded fee pool + buyers' fee payments) are derived too — a 1-of-2 multisig(server+user) with a **fresh nonce per payment-change output** (no static key reuse). The fee pool's derivation chains via `properties.paymentDerivation`.
- **Where the nonce lives:** in the owner's **wallet basket** via `internalizeAction` (`shared/bsv/internalizeToBasket.ts`, basket `fractionalized.tokens`) for self-custody/recovery, **and** in a DB index for O(1) hot-path lookup:
  - `properties.currentDerivation` — how to spend `txids.currentOutpoint` (`{keyId, counterparty, counterpartyDerivedKey, order, beef}`).
  - `properties.paymentDerivation` — how to spend the current fee-pool UTXO.
  - `shares.keyId` / `shares.counterparty` — an investor's P2PKH derivation.
  - `market_items` derivation fields — a listing multisig's derivation (server's perspective).
- **Source transactions:** the transaction creator carries the BEEF — the server stores a carry-forward BEEF (`currentDerivation.beef`) and listings are backed up in `listing_beefs`; the overlay is a **fallback only** (`server/lib/fetchTokenSourceTx.ts`). BEEFs cross the wire base64-encoded (`shared/bsv/beefEncoding.ts`).
- **Legacy / dual-path:** the locking-script templates default to the old fixed scheme (`[0,'fractionalized'] / '0' / self`), so pre-migration tokens still spend; new outputs use the derived scheme.

Full design: `docs/specs/2026-06-16-derived-key-multisig-baskets-design.md`.

## How it works (high level)

- **Minting (tokenize property)** — `server/routes/tokenize.ts` (`POST /api/tokenize/create-property`)
  - Creates a *property token* output (the on-chain identity anchor referenced by every share's `OP_RETURN`).
  - Mints the “shares” ordinal (1 sat) to a derived multisig(server+seller) via `OrdinalsP2MS`, with a `bsv-20` inscription.
  - Server internalizes the mint into its basket and writes `currentDerivation`; the client (seller) internalizes its copy from the returned payload.
  - Funds future transfer fees via a prefunded multisig `PaymentUtxo` pool (per-payment derived keys; server-operational).

- **Purchasing shares (primary)** — `server/routes/sharePurchase.ts` (`POST /api/share-purchase`)
  - Spends the current share multisig (source from the carry-forward BEEF; overlay fallback).
  - Sends the purchased portion to the investor as a 1 sat ordinal locked to the investor's **derived** key (`OrdinalsP2PKH`); investor internalizes it.
  - Remaining shares go back as a derived multisig “change” (the new `currentOutpoint`). A final sale (all shares bought) omits the change output and marks the property `funded`.

- **Marketplace (secondary)** — custodial multisig model (see also the OrdLock alternative in `docs/specs/2026-06-17-orderlock-marketplace-design.md`)
  - **List** — `server/routes/listings.ts` (`POST /api/new-listing`): the seller's client moves their P2PKH share into a server+seller multisig and posts the tx; the server validates the byte-exact lock + `traceShareChain`, and backs up the BEEF in `listing_beefs`.
  - **Buy** — `server/routes/listingPurchase.ts` (`POST /api/listing-purchase`): the server spends the listing multisig (BEEF from `listing_beefs`) to a buyer's derived P2PKH; the buyer's payment funds the fee.
  - **Cancel** — `server/routes/listings.ts` (`POST /api/cancel-listing`): the seller's client spends the listing multisig back to their own derived P2PKH; the server validates and removes the listing.

- **Integrity / chain tracing**
  - Each share stores `parentTxid` (spent outpoint) + `transferTxid` (new outpoint); `traceShareChain` walks the lineage to the original mint.
  - Properties track `txids.originalMintTxid` (immutable), `txids.currentOutpoint` (spend next), `txids.paymentTxid` (fee pool).

## Key components

- **Server wallet**: `server/lib/makeWallet.ts` (`@bsv/wallet-toolbox` storage + signer construction) + `server/lib/serverWallet.ts` (`getServerWallet` memo).
- **Derived-key utils**: `tokenDerivation.ts`, `internalizeToBasket.ts`, `beefEncoding.ts` (all in `shared/bsv/`), `tokenIndex.ts`, `fetchTokenSourceTx.ts` (both in `server/lib/`), `reindexFromBasket.ts` (in `client/src/lib/` — client-only recovery primitive, currently unused).
- **Locking scripts**
  - `shared/bsv/ordinalsP2MS.ts`: 1-of-2 multisig + ordinal inscription (derivation-parametrized `unlock`, legacy default).
  - `shared/bsv/ordinalsP2PKH.ts`: single-sig investor output + ordinal inscription (derivation-parametrized `unlock`, legacy default).
  - `shared/bsv/paymentUtxo.ts`: 1-of-2 multisig fee UTXO (per-payment derived keys; legacy default for back-compat).
- **Overlay interaction**: `shared/overlay.ts` — broadcast is non-fatal (overlay is supplementary indexing); queries by txid as a source-tx fallback.
- **Auth**: JWT cookie `verified`; `server/middleware/requireSession.ts` guards the API, and `client/src/components/routing/ProtectedRoute.tsx` guards routes in the browser (replacing the deleted Next `middleware.ts` page guard).
- **Client API access**: every request goes through `client/src/lib/apiFetch.ts` (prefixes `VITE_API_BASE`, sends `credentials: 'include'`, redirects to `/login` on 401). Enforced by `_test/ApiFetchChokepoint.test.ts`.

## Code layout

- `shared/` — dual-use, framework-agnostic TypeScript. MUST NOT import a Node-only
  module (`mongodb`, `fs`, `crypto`, `dotenv`, `express`, `jose`); `mongodb` is
  allowed only as `import type`. Must not import from `client/` or `server/`.
  Enforced by `_test/ModuleBoundaries.test.ts`.
- `server/` — the Express API and all server-only logic. Owns the wallet and the
  serialized wallet queue. Must run as exactly ONE instance with autoscale
  OFF — a correctness requirement, not a cost setting: the queue only prevents
  UTXO double-spends within a single process.
- `client/` — the Vite/React SPA (npm workspace `@fraction/client`). Must never
  import from `server/`. Also enforced by `_test/ModuleBoundaries.test.ts`.
- `_test/` — jest suites for `server/` and `shared/`. Client tests are vitest and
  live beside their sources under `client/src/**/__tests__/`.

The two sides run on **separate origins** and share no env file: server vars live in
`server/.env` (read only by `server/config.ts` and `scripts/*`), client vars in
`client/.env` (Vite loads `.env` from its own root). There is no root `.env`.

## Tech stack

- React 19 + Vite 6 SPA, React Router 7, Tailwind CSS 4
- Express 5 API (single process, serialized wallet queue)
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

Installs all three workspaces (`client`, `server`, `shared`) from the repo root.

### Environment variables

Two files, copied from their examples. Nothing reads a root `.env`.

**`server/.env`** (see `server/.env.example`) — secrets, never bundled:

- `MONGODB_URI` (must include the database name)
- `SERVER_PRIVATE_KEY` (server wallet private key, hex)
- `WALLET_STORAGE_URL` (wallet-toolbox storage URL)
- `JWT_SECRET` (signs the `verified` cookie; min 32 chars, distinct from the private key)
- `MIN_BALANCE` (output count for the `/api/ready` probe)
- `PORT` (default 3001)
- `ALLOWED_ORIGINS` (credentialed CORS allowlist, comma-separated; dev: `http://localhost:5173`)

**`client/.env`** (see `client/.env.example`) — public, inlined into the browser bundle:

- `VITE_API_BASE` (API origin, e.g. `http://localhost:3001`; empty = same-origin)
- `VITE_SERVER_IDENTITY_KEY` (server wallet **identity** key, compressed hex — the type-42 derivation counterparty *and* the auth-proof server identity; must equal the server wallet's `getIdentityKey()`. The client refuses to boot without it.)

Notes:
- **Do not commit real secrets** (private keys, JWT secrets, production DB URIs).
- The login route sets cookies with `secure: true`. Over plain `http://localhost` the browser may refuse to set the cookie; run behind HTTPS (or adjust cookie policy in code) for local dev.
- The session cookie is `SameSite=Strict` and still rides the `5173 → 3001` fetch: port is not part of a *site*. Both origins must share one registrable domain in production.

### Database setup

Run `npm run db:migrate` once per environment before first use. This creates the MongoDB collections, JSON-schema validators, and required indexes (including the `auth_nonces` replay-protection index). The app fails fast on startup if a required unique index is missing, so this must be run before the app is first deployed/started against a given database.

### Secrets & rotation

- Never commit real secrets — the `.env.example` files are templates and contain no values.
- In production, store `SERVER_PRIVATE_KEY` and `JWT_SECRET` in a secrets manager (the host's environment settings or a KMS), not in checked-in files.
- Keep `SERVER_PRIVATE_KEY` and `JWT_SECRET` as distinct values — never reuse one secret for both purposes.
- Rotate either secret immediately if it is ever exposed (committed, logged, or leaked).

### Run

Two processes, two origins. Terminal 1 — the API:

```bash
npm run server:dev
```

Terminal 2 — the client:

```bash
npm run client:dev
```

Open `http://localhost:5173`. Vite uses `strictPort`, so if 5173 is taken it fails
rather than moving to 5174 — a silent port change would no longer match
`ALLOWED_ORIGINS` and CORS failures look like auth bugs.

### Tests and checks

```bash
npm run lint          # eslint, repo-wide
npx tsc --noEmit                   # server + shared
npx tsc -p client/tsconfig.json    # client
npm test              # jest: server + shared (_test/)
npm run test:client   # vitest: client
npm run build         # client production build (vite)
```

`_test/PaymentUTXO.test.ts` hits the live network and is expected to fail without
funded UTXOs.

## Deploying

Two origins on one registrable domain (required for the `SameSite=Strict` session cookie):

- **Client** — `npm run client:build`, serve `client/dist` as static files at
  `app.<domain>`. Requires SPA history fallback (all paths → `index.html`), or every
  deep link 404s. Build-time env: `VITE_API_BASE=https://api.<domain>`,
  `VITE_SERVER_IDENTITY_KEY`.
- **API** — `npm run server:start` at `api.<domain>`. Env: `MONGODB_URI`,
  `SERVER_PRIVATE_KEY`, `WALLET_STORAGE_URL`, `JWT_SECRET`, `MIN_BALANCE`,
  `PORT`, `ALLOWED_ORIGINS=https://app.<domain>`.

**The API MUST run as exactly ONE instance with autoscale OFF.** This is a
correctness requirement, not a cost setting: the serialized wallet queue only
prevents UTXO double-spends within a single process. A second instance
reintroduces the race the migration exists to fix. Do not use pm2 cluster mode.

Run `npm run db:migrate` before first boot — the server fail-fasts if the
required unique indexes are missing.

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
