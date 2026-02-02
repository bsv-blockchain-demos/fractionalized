# Fractionalized Real Estate (BSV)

Demo app showing how to tokenize a real-estate listing and sell fractional “shares” using the BSV blockchain.

The core idea is:
- A *property* is represented by a reference UTXO.
- *Shares* are represented as 1 sat ordinal outputs that carry a `bsv-20` style inscription.
- Share UTXOs are controlled by a **1-of-2 multisig** between the seller and the server.
- The server performs **server-side minting and transfer construction** to ensure integrity, while still requiring the correct multisig key ordering / commitments.

## How it works (high level)

- **Minting (tokenize property)**
  - API route: `src/app/api/tokenize/create-property/route.ts`
  - Creates a *property token* output.
  - Mints an initial “shares” ordinal (1 sat output) using a custom locking script (`OrdinalsP2MS`) that embeds a `bsv-20` inscription.
  - Also creates a multisig “payment change” UTXO (`PaymentUtxo`) that the server can later spend to pay fees for subsequent transfers.

- **Purchasing shares (transfer)**
  - API route: `src/app/api/share-purchase/route.ts`
  - Spends the current share outpoint and the payment outpoint.
  - Sends the purchased portion to the investor as a 1 sat ordinal locked to the investor (`OrdinalsP2PKH`).
  - Sends the remaining shares back as “change” to a multisig output (`OrdinalsP2MS`) so the next buyer can purchase from the updated `currentOutpoint`.

- **Integrity / chain tracing**
  - Each share record stores:
    - `parentTxid`: the outpoint that was spent
    - `transferTxid`: the new outpoint created for the investor
  - Properties track:
    - `txids.originalMintTxid` (immutable reference)
    - `txids.currentOutpoint` (what to spend next)
    - `txids.paymentTxid` (fee-funding outpoint)

## Key components

- **Server wallet**: `src/lib/serverWallet.ts`
  - Uses `@bsv/wallet-toolbox-client` storage + signer.

- **Locking scripts**
  - `src/utils/ordinalsP2MS.ts`: 1-of-2 multisig + ordinal inscription output.
  - `src/utils/ordinalsP2PKH.ts`: single-sig investor output + ordinal inscription.
  - `src/utils/paymentUtxo.ts`: 1-of-2 multisig UTXO used for fees.

- **Overlay interaction**: `src/hooks/overlayFunctions.ts`
  - Broadcasts transactions and queries parent transactions by txid.

- **Auth**
  - JWT cookie name: `verified`
  - Middleware: `src/middleware.ts`
  - API auth helper: `src/utils/apiAuth.ts`

## Tech stack

- Next.js (App Router)
- MongoDB
- `@bsv/sdk`, `@bsv/wallet-toolbox-client`

## Local development

### Prerequisites

- Node.js 20+
- A MongoDB instance (connection string must include a database name)
- A BSV wallet toolbox storage service (see `STORAGE_URL`)

### Install

```bash
npm install
```

### Environment variables

Set the following env vars (for local dev, you can use a `.env` file):

- `MONGODB_URI`
- `SERVER_PRIVATE_KEY` (server wallet private key, hex)
- `NEXT_PUBLIC_SERVER_PUBKEY` (server wallet public key, compressed hex)
- `STORAGE_URL` (wallet-toolbox storage URL)
- `JWT_SECRET` (used to sign the `verified` cookie)

Notes:
- **Do not commit real secrets** (private keys, JWT secrets, production DB URIs).
- The login route sets cookies with `secure: true`. Over plain `http://localhost` the browser may refuse to set the cookie. For local dev you’ll typically run behind HTTPS (or adjust cookie policy in code).

### Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Main API routes

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/new-listing`
- `POST /api/listing-purchase`
- `POST /api/tokenize/create-property`
- `POST /api/share-purchase`
- `GET /api/listings`
- `GET /api/my-listings`
- `GET /api/my-shares`
- `GET /api/my-selling`
- `GET /api/properties`

## Security notes

- This repo is a demo; treat it as educational code.
- Server-side minting means the server has signing capability; **protect `SERVER_PRIVATE_KEY`** and rotate it if it was ever committed.
- Production deployments should include proper rate limiting, request validation, monitoring, and key management (HSM / vault).
