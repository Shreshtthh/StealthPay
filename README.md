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

## Project Structure

```
packages/
  snfoundry/
    contracts/src/
      stealth_registry.cairo    # Public key registration
      stealth_announcer.cairo   # Event emission for scanning
      stealth_pay.cairo         # Deposit + claim logic
    contracts/tests/
      test_registry.cairo       # Contract unit tests
  nextjs/
    app/
      register/page.tsx         # Key generation + on-chain registration
      send/page.tsx             # Stealth address computation + token send
      receive/page.tsx          # Scan announcements + claim payments
    utils/stealth/
      crypto.ts                 # All cryptographic primitives
      types.ts                  # TypeScript type definitions
    hooks/stealth/
      useStealthContracts.ts    # Custom hooks for contract interaction
```

## Getting Started

### Prerequisites

- Node.js 18+
- Scarb 2.16+ (Cairo compiler)
- A Starknet wallet (Argent X or Braavos)

### Installation

```bash
git clone https://github.com/yourusername/stealthpay-starknet.git
cd stealthpay-starknet
yarn install
```

### Local Development

```bash
# Terminal 1: Start local devnet
yarn chain

# Terminal 2: Deploy contracts
yarn deploy

# Terminal 3: Start frontend
yarn start
```

Open [http://localhost:3000](http://localhost:3000) and connect your wallet.

### Sepolia Testnet

1. Configure `packages/snfoundry/.env` with your deployer credentials
2. Set `targetNetworks: [chains.sepolia]` in `packages/nextjs/scaffold.config.ts`
3. Deploy: `yarn deploy --network sepolia`

## Usage

### 1. Register (Recipient)
Navigate to `/register`. Generate your stealth keypairs and publish them on-chain. This is a one-time setup.

### 2. Send (Sender)
Navigate to `/send`. Enter the recipient's Starknet address, select a token, enter the amount. The app looks up their registered keys, computes a stealth address, and sends the tokens.

### 3. Receive (Recipient)
Navigate to `/receive`. Click "Scan for Payments" to scan on-chain announcements using your viewing key. Found payments can be claimed to any address with a single click.

## Security Model

- **Spending keys** never leave the browser. They are stored in localStorage (encrypted storage recommended for production).
- **Viewing keys** can only identify payments, not spend them. Safe to delegate to a scanning service.
- **ECDSA signatures** over the Poseidon commitment prove ownership of the stealth private key during claims.
- **No trusted third parties.** All cryptography runs client-side. Contracts only verify proofs.

## Inspiration

- [EIP-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564)
- [Vitalik Buterin: An Incomplete Guide to Stealth Addresses](https://vitalik.eth.limo/general/2023/01/20/stealth.html)
- [Umbra Protocol](https://www.umbra.cash/) (Ethereum implementation)

## License

MIT
