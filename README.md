# StealthPay: Private Payments on Starknet

> **Send and receive tokens privately on Starknet using stealth addresses.** No one can link the sender to the recipient on-chain.

![Built on Starknet](https://img.shields.io/badge/Built%20on-Starknet-blue)
![Cairo](https://img.shields.io/badge/Language-Cairo%202-orange)
![License](https://img.shields.io/badge/License-MIT-green)

## The Problem

Every transaction on Starknet is public. When Alice sends tokens to Bob, anyone can see:
- Alice's address sent X tokens
- Bob's address received X tokens
- The exact amount and token type

This complete transparency makes it impossible to receive payments privately. Salary payments, donations, business transactions, and personal transfers are all visible to the world.

## Our Solution

StealthPay implements the **ERC-5564 Stealth Address Protocol** natively on Starknet. It lets anyone send tokens to a recipient at a unique, one-time address that only the recipient can control. No on-chain link exists between the recipient's real address and the stealth address where funds land.

### How It Works (30-second version)

1. **Bob registers** his public keys on-chain (once)
2. **Alice sends** tokens to a freshly computed stealth address derived from Bob's public keys
3. **Bob scans** the chain with his private viewing key, finds the payment, and **claims** it to any wallet he wants

No one watching the chain can tell that Bob received the payment.

## Architecture

StealthPay consists of three Cairo smart contracts and a Next.js frontend with client-side cryptography.

### Smart Contracts

| Contract | Purpose |
|----------|---------|
| **StealthRegistry** | Stores users' stealth meta-addresses (spending + viewing public keys) |
| **StealthAnnouncer** | Emits `Announcement` events with indexed view tags for efficient scanning |
| **StealthPay** | Handles deposits (send) and withdrawals (claim) with ECDSA signature verification |

### Cryptographic Flow

```
SENDER                                 RECIPIENT
------                                 ---------
1. Look up recipient's                 1. Generate spending keypair (s, S)
   public keys (S, V)                     and viewing keypair (v, V)
   from StealthRegistry                2. Register S.x and V.x on-chain

2. Generate ephemeral keypair (r, R)

3. Compute shared secret:             3. Scan Announcement events
   sh = hash(r * V)                      For each: sh = hash(v * R)

4. Compute stealth public key:         4. Check: does hash(sh) match
   P_stealth = S + sh*G                    the view tag? (fast filter)

5. Compute commitment:                 5. Compute P_stealth = S + sh*G
   c = poseidon(P_stealth.x)              Verify commitment matches

6. Call StealthPay.send()              6. Derive stealth private key:
   with (c, R, view_tag, token, amt)      p_stealth = s + sh (mod n)

                                       7. Sign the commitment with p_stealth
                                          Call StealthPay.claim()
```

### View Tag Optimization

Scanning every announcement requires an expensive ECDH computation per event. StealthPay uses **view tags** (the first byte of the shared secret hash) as a fast pre-filter. The `Announcement` event indexes the view tag, allowing the frontend to request only matching events via RPC. This reduces scanning cost by ~256x.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Cairo 2 on Starknet |
| Frontend | Next.js 14 + TypeScript |
| Wallet Integration | starknet-react + starknet.js |
| Cryptography | STARK curve ECDH + Poseidon hashing (client-side) |
| Scaffold | Scaffold-Stark 2 |
| Styling | Tailwind CSS v3 + daisyUI v4 |

## Project Structure

```
StealthPay/
├── packages/
│   ├── snfoundry/                          # Cairo smart contracts & deployment
│   │   ├── contracts/src/
│   │   │   ├── stealth_registry.cairo      # Public key registration
│   │   │   ├── stealth_announcer.cairo     # Event emission for scanning
│   │   │   └── stealth_pay.cairo           # Deposit + claim logic
│   │   ├── contracts/tests/
│   │   │   └── test_registry.cairo         # Contract unit tests
│   │   ├── scripts-ts/
│   │   │   └── deploy.ts                   # Deployment script (deploys all 3 contracts)
│   │   └── .env                            # Deployer credentials (per-network)
│   └── nextjs/                             # Next.js frontend
│       ├── app/
│       │   ├── page.tsx                     # Landing page
│       │   ├── register/page.tsx            # Key generation + on-chain registration
│       │   ├── send/page.tsx                # Stealth address computation + token send
│       │   └── receive/page.tsx             # Scan announcements + claim payments
│       ├── hooks/stealth/
│       │   └── useStealthContracts.ts       # Custom hooks for contract interaction
│       ├── utils/stealth/
│       │   ├── crypto.ts                    # All cryptographic primitives
│       │   └── types.ts                     # TypeScript type definitions
│       ├── scaffold.config.ts               # Network target configuration
│       └── .env.local                       # RPC provider URLs
├── WHITEPAPER.md                            # Protocol design document
└── README.md                                # This file
```

## Getting Started

### Prerequisites

| Tool | Version | Installation |
|------|---------|-------------|
| **Node.js** | ≥ 18 | [nodejs.org](https://nodejs.org/) |
| **Yarn** | v1 or v2+ | `npm install -g yarn` |
| **Scarb** | **2.13.2** | [via starkup](https://docs.starknet.io/) |
| **Starknet Foundry** | Latest | [via starkup](https://docs.starknet.io/) |
| **Starknet Wallet** | - | [Argent X](https://www.argent.xyz/argent-x/) or [Braavos](https://braavos.app/) |

> **Scarb version matters.** The Sepolia sequencer uses Cairo 2.13.2 to compile Sierra to CASM. Using a different Scarb version locally will produce a different CASM hash, causing `Transaction execution error (code 41)` on deployment. Pin to **2.13.2** exactly.

To install Scarb and Starknet Foundry together:

```bash
curl https://get.starkup.dev | sh
```

### Clone & Install

```bash
git clone https://github.com/yourusername/StealthPay.git
cd StealthPay
yarn install
```

### Option A: Local Development (Devnet)

Run each command in a **separate terminal**:

```bash
# Terminal 1: Start local Starknet devnet
yarn chain

# Terminal 2: Compile and deploy contracts to devnet
yarn deploy

# Terminal 3: Start the Next.js frontend
yarn start
```

Open [http://localhost:3000](http://localhost:3000) and connect your wallet.

> **Note:** On devnet, the scaffold provides pre-funded burner wallets automatically.

### Option B: Sepolia Testnet

Standard scaffold deployment tools (`yarn deploy --network sepolia`) can struggle with CASM hash computation and v2/v3 transaction typing on testnets. StealthPay uses a **custom direct deployment script** that enforces v3 transactions (STRK for gas) and handles the sequential dependency injection of contract addresses.

#### 1. Configure the deployment script

Edit `deploy-sepolia-direct.ts` in the project root with your deployer credentials and a dedicated RPC endpoint (Alchemy or Infura recommended over public nodes).

#### 2. Fund your deployer wallet

Ensure your deployer wallet has **STRK** tokens. The script forces v3 transactions which use STRK for gas (not ETH).

#### 3. Deploy contracts

```bash
npx ts-node deploy-sepolia-direct.ts
```

The script deploys **StealthAnnouncer**, then **StealthRegistry**, then **StealthPay** in order, automatically passing the announcer address into the StealthPay constructor.

#### 4. Update deployed contract addresses

Copy the outputted contract addresses from the deploy script and update `packages/nextjs/contracts/deployedContracts.ts`.

#### 5. Configure the frontend

Create/edit `packages/nextjs/.env.local`:

```env
NEXT_PUBLIC_SEPOLIA_PROVIDER_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_9/YOUR_KEY
```

In `packages/nextjs/scaffold.config.ts`, ensure:

```typescript
targetNetworks: [chains.sepolia],
```

#### 6. Start the frontend

```bash
yarn start
```

### Running Tests

```bash
# Run Cairo contract tests
cd packages/snfoundry && snforge test

# Or from root
yarn test
```

## Usage

### 1. Register (Recipient, one-time setup)

Navigate to [`/register`](http://localhost:3000/register):

1. Click **"Generate Keys"**: creates your spending + viewing keypairs (stored locally in your browser's localStorage)
2. Click **"Register on Starknet"**: publishes the x-coordinates of your public keys to the on-chain `StealthRegistry`

### 2. Send (Sender)

Navigate to [`/send`](http://localhost:3000/send):

1. Enter the **recipient's Starknet address** (they must have registered)
2. Select a **token** (STRK or ETH)
3. Enter the **amount**
4. Click **"Send Privately"**

The app automatically:
- Looks up the recipient's registered public keys from the registry
- Computes a stealth address + ephemeral key client-side
- Executes a multicall that approves the token transfer and sends in one transaction

### 3. Receive (Recipient)

Navigate to [`/receive`](http://localhost:3000/receive):

1. Click **"Scan for Payments"**: scans on-chain `Announcement` events using your viewing key
2. Review the list of detected payments (amount, token, commitment)
3. Click **"Claim"** on any payment: signs a proof with the derived stealth private key and sends funds to your connected wallet

## Design Choices

StealthPay is built on Scaffold-Stark 2 but makes several intentional architectural decisions to support the stealth address protocol:

- **Custom contract hooks.** We use lightweight wrappers (`useStealthReadContract`, `useStealthWriteContract`) instead of the scaffold's generic hooks. Stealth contracts require runtime contract name resolution that bypasses the scaffold's compile-time type constraints, giving us more flexibility for dynamic contract interactions.
- **Raw RPC event scanning.** The Receive page fetches `Announcement` events directly via `RpcProvider.getEvents()` rather than scaffold event hooks. Stealth scanning requires custom parsing of raw event data followed by client-side ECDH cryptography on each event, a processing pipeline that doesn't fit the scaffold's event abstraction.
- **Direct multicall construction.** The Send page builds approve + send calls manually using `starknet.js` `Contract.populate()` and `useTransactor`, rather than the scaffold write hooks. This allows us to batch the ERC-20 approval and stealth payment into a single atomic multicall transaction.
- **Client-side cryptography.** All stealth address math (ECDH shared secrets, key derivation, ECDSA signing) runs entirely in the browser using `starknet.js` EC utilities. The Cairo contracts only verify proofs; they never touch private keys or perform complex EC operations.

## Privacy Model

### What StealthPay hides

- **Recipient identity.** The stealth commitment is cryptographically unlinkable to the recipient's registered address. No on-chain observer can determine who received a payment.
- **Payment relationship.** There is no visible connection between the sender's `send()` call and the recipient's `claim()` call. They reference different commitments and happen at different times from different addresses.
- **Claim destination.** The recipient can claim funds to any wallet, including a freshly generated one with no prior history.

### What StealthPay does NOT hide

- **Sender identity.** The sender's address is visible in the `send` transaction.
- **Payment amount and token type.** The deposit amount and ERC-20 token address are recorded on-chain in both the deposit struct and the `Announcement` event.
- **Timing.** Transaction timestamps are public.

### Amount correlation and mitigation

Because amounts are public, a statistical correlation attack is possible: if Alice deposits 42.698 STRK and a new wallet withdraws exactly 42.698 STRK a few hours later, an analyst can reasonably link those two transactions.

**Immediate mitigation: standardized denominations.** The established approach (used by protocols like Tornado Cash) is to send funds in fixed denominations (e.g. 10, 100, 1000 STRK). If ten users each deposit 100 STRK in a given period and ten users each withdraw 100 STRK, it becomes statistically infeasible to determine which deposit corresponds to which withdrawal. StealthPay supports this pattern today with no protocol changes.

**Roadmap: Pedersen commitments for amount hiding.** The natural next evolution is to integrate Pedersen commitment schemes into the deposit and claim flow. A Pedersen commitment `C = r*G + v*H` allows the contract to verify that the deposited amount matches the withdrawn amount *without ever revealing the actual value on-chain*. The sender would commit to the amount during `send()`, and the recipient would provide a zero-knowledge range proof during `claim()` demonstrating that the commitment opens to a valid, matching amount. This eliminates amount correlation entirely while preserving the contract's ability to enforce balance correctness. Starknet's native support for elliptic curve operations and Poseidon hashing makes this integration particularly efficient.

### Key security

- **Spending keys** never leave the browser. They are required to claim funds.
- **Viewing keys** can only detect payments, not spend them. Safe to delegate to a scanning service for passive monitoring.
- **ECDSA signatures** over the Poseidon commitment prove ownership of the stealth private key during claims.
- **No trusted third parties.** All cryptography runs client-side. Contracts only verify proofs.

## Hackathon

Built for the **Starknet Re{define} Hackathon 2026**, Privacy + Bitcoin Track.

## Inspiration

- [EIP-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564)
- [Vitalik Buterin: An Incomplete Guide to Stealth Addresses](https://vitalik.eth.limo/general/2023/01/20/stealth.html)

## License

MIT
