# StealthPay: Private Payment Protocol for Starknet

**A Whitepaper**

*Version 1.0 | March 2026*

---

## Abstract

StealthPay is a privacy protocol for Starknet that enables private token transfers using stealth addresses. By adapting the ERC-5564 stealth address standard to Starknet's native STARK curve, StealthPay allows any user to receive payments at one-time addresses that are unlinkable to their public identity. The protocol requires no trusted intermediaries, operates entirely on-chain, and preserves Starknet's composability guarantees. This paper describes the protocol design, cryptographic primitives, smart contract architecture, and security properties of StealthPay.

---

## 1. Introduction

### 1.1 The Privacy Problem on Starknet

Starknet, like most blockchain networks, provides pseudonymity but not privacy. Every transaction is recorded in a public ledger, and addresses are easily linkable through transaction graph analysis. Once a single address is associated with a real-world identity (through KYC exchanges, ENS names, or social media), the entire transaction history of that address becomes attributable.

This transparency creates practical problems:

- **Employees** receiving salary payments expose their compensation to the public
- **Merchants** reveal their revenue and customer relationships
- **Donors** to sensitive causes lose their anonymity
- **Individuals** conducting personal business have no financial privacy

### 1.2 Existing Approaches

Privacy on blockchains has been addressed through several approaches:

| Approach | Tradeoffs |
|----------|-----------|
| Mixers (Tornado Cash) | Regulatory risk, fixed denominations, no token support |
| Private L1s (Zcash, Monero) | Separate ecosystem, no DeFi composability |
| TEE-based solutions | Trusted hardware assumptions |
| Full ZK protocols (Aztec) | High complexity, separate execution environment |

### 1.3 Stealth Addresses: A Pragmatic Middle Ground

Stealth addresses offer a lightweight privacy primitive that breaks the link between sender and recipient without requiring a separate privacy chain or complex infrastructure. First formalized for Ethereum as EIP-5564, stealth addresses enable a sender to derive a fresh, one-time address for each payment to a recipient. Only the recipient can detect and claim payments sent to these addresses.

StealthPay brings this primitive to Starknet, taking advantage of the network's native STARK curve and Poseidon hash function for gas-efficient on-chain verification.

---

## 2. Protocol Design

### 2.1 Key Generation

Each user generates two keypairs on the STARK curve:

- **Spending keypair** `(s, S)` where `S = s * G` (G is the curve generator)
- **Viewing keypair** `(v, V)` where `V = v * G`

Together, `(S, V)` form the user's **stealth meta-address**. The spending key controls funds. The viewing key detects incoming payments.

### 2.2 Registration

Users publish the x-coordinates of their public keys `(S.x, V.x)` to the `StealthRegistry` contract. Full curve points can be recovered from x-coordinates using the STARK curve equation:

```
y^2 = x^3 + alpha*x + beta (mod p)
```

where `alpha = 1` and `beta` is the STARK curve constant. This halves the storage cost.

### 2.3 Sending

To send tokens privately to a recipient with meta-address `(S, V)`:

1. **Generate ephemeral keypair**: `(r, R)` where `R = r * G`
2. **Compute shared secret**: `sh = H(r * V)` using Poseidon hash
3. **Extract view tag**: `tag = sh[0:1]` (first byte of hash)
4. **Compute stealth public key**: `P_stealth = S + sh * G`
5. **Compute commitment**: `c = Poseidon(P_stealth.x)`
6. **Call `StealthPay.send()`** with parameters `(c, R, tag, token, amount)`

The contract:
- Transfers tokens from sender to itself (escrow)
- Records the deposit keyed by commitment
- Calls `StealthAnnouncer.announce()` to emit a scannable event

### 2.4 Scanning

The recipient periodically scans `Announcement` events:

1. **Filter by view tag**: The `view_tag` field is indexed in the event, allowing RPC-level filtering. This eliminates ~255/256 of events without any cryptographic computation.
2. **Compute shared secret**: For matching events, compute `sh = H(v * R)` where `v` is the viewing private key and `R` is the ephemeral public key from the announcement.
3. **Verify view tag**: Confirm `extractViewTag(sh) == event.view_tag`
4. **Verify commitment**: Compute `P_stealth = S + sh * G` and check `Poseidon(P_stealth.x) == event.stealth_commitment`

If both checks pass, the announcement represents a payment to this recipient.

### 2.5 Claiming

To claim a detected payment:

1. **Derive stealth private key**: `p_stealth = s + sh (mod n)` where `n` is the curve order
2. **Sign the commitment**: Produce an ECDSA signature `(sig_r, sig_s)` over the commitment using `p_stealth`
3. **Call `StealthPay.claim()`** with `(commitment, P_stealth.x, sig_r, sig_s, recipient_address)`

The contract:
- Verifies `Poseidon(P_stealth.x) == commitment` (binds the key to the deposit)
- Verifies the ECDSA signature (proves ownership of the stealth private key)
- Transfers escrowed tokens to the specified recipient address
- Marks the deposit as claimed

---

## 3. Smart Contract Architecture

### 3.1 Contract Separation

StealthPay uses three contracts with distinct responsibilities:

```
StealthRegistry          StealthAnnouncer          StealthPay
     |                        |                        |
     | register(S.x, V.x)    |                        |
     | get_meta_address()     |                        |
     | is_registered()        |                        |
     |                        | announce(...)           |
     |                        |   -> emit Announcement  |
     |                        |                        |
     |                        |                        | send(c, R, tag, token, amt)
     |                        |<-  announce() call  ---|
     |                        |                        | claim(c, P.x, r, s, to)
     |                        |                        | get_deposit(c)
```

**Why separate the Announcer?** By isolating event emission into a dedicated contract, scanning clients only need to query events from a single address. This simplifies event filtering and allows the announcer to be upgraded independently.

### 3.2 Storage Design

Cairo's storage model does not support struct values in `Map`. Deposit data is stored as individual fields:

```cairo
deposit_token:   Map<felt252, ContractAddress>
deposit_amount:  Map<felt252, u256>
deposit_sender:  Map<felt252, ContractAddress>
deposit_claimed: Map<felt252, bool>
deposit_exists:  Map<felt252, bool>
```

All fields are keyed by the stealth commitment, which is unique per payment.

### 3.3 Security Checks

The `claim` function enforces three invariants:

1. **Existence**: The deposit must exist and not be already claimed
2. **Commitment binding**: `Poseidon(stealth_pub_x) == stealth_commitment`
3. **Ownership proof**: Valid ECDSA signature over the commitment, verified against `stealth_pub_x`

This ensures only the holder of the stealth private key (derivable only from the recipient's spending key) can claim funds.

---

## 4. Cryptographic Primitives

### 4.1 Curve

All operations use the **STARK curve**, the native elliptic curve of Starknet:

- **Field**: `p = 2^251 + 17 * 2^192 + 1`
- **Order**: `n = 0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f`
- **Equation**: `y^2 = x^3 + x + beta`

Using the native curve means all on-chain verification (ECDSA, point operations) is gas-efficient because Cairo has built-in support.

### 4.2 Hash Functions

- **Poseidon**: Used for commitments (`Poseidon(P_stealth.x)`) and shared secret derivation. Poseidon is the algebraically native hash function on Starknet, making on-chain hashing extremely cheap (~20 gas per field element).
- **View tag extraction**: First byte of the Poseidon hash of the shared secret's x-coordinate.

### 4.3 Point Recovery

The registry stores only x-coordinates to minimize storage costs. The full curve point is recovered client-side using:

```
y = (x^3 + alpha*x + beta)^((p+1)/4) mod p
```

This works because the STARK field prime satisfies `p = 3 (mod 4)`, allowing efficient square root computation via modular exponentiation.

### 4.4 ECDH Security

The Elliptic Curve Diffie-Hellman shared secret `sh = H(r * V) = H(v * R)` ensures:

- Only the sender (who knows `r`) and recipient (who knows `v`) can compute the shared secret
- The ephemeral keypair `(r, R)` is used once and discarded
- An observer sees only `R` (the ephemeral public key), which reveals nothing about `sh`

---

## 5. View Tag Optimization

### 5.1 The Scanning Problem

Without optimization, scanning N announcements requires N ECDH computations (each involving a full scalar multiplication on the STARK curve). For a chain with thousands of stealth payments, this becomes computationally expensive for browser-based clients.

### 5.2 Solution: Indexed View Tags

Each announcement includes a `view_tag` (1 byte) derived from the shared secret. This tag is indexed in the Starknet event, enabling RPC-level filtering:

```
tag = first_byte(Poseidon(shared_secret.x))
```

**Performance impact:**

| Metric | Without View Tags | With View Tags |
|--------|------------------|----------------|
| ECDH computations per scan | N | N / 256 |
| RPC query overhead | All events | Filtered events |
| Client-side CPU cost | O(N) | O(N/256) |

For a chain with 10,000 announcements, the recipient only performs ~39 ECDH operations instead of 10,000.

---

## 6. Privacy Analysis

### 6.1 What StealthPay Hides

- **Recipient identity**: The stealth commitment and stealth address are unlinkable to the recipient's registered address
- **Payment relationship**: No on-chain connection between sender and recipient
- **Claim destination**: The recipient can claim to any address, including a fresh one

### 6.2 What StealthPay Does NOT Hide

- **Sender identity**: The sender's address is visible in the `send` transaction
- **Payment amount**: The token and amount are recorded in the deposit and announcement
- **Timing**: Transaction timestamps are public

### 6.3 Threat Model

| Attacker | Capability | Result |
|----------|-----------|--------|
| Passive observer | Reads all on-chain data | Cannot link recipient to stealth address |
| Sender | Knows recipient's meta-address | Can identify their own payments only |
| Registry reader | Knows user is registered | Cannot determine specific payments received |
| Compromised viewing key | Can scan and detect payments | Cannot claim funds (needs spending key) |

### 6.4 Key Separation

The two-key design (spending + viewing) enables secure delegation:

- The **viewing key** can be given to a trusted scanning service to detect payments, without risking fund theft
- The **spending key** remains with the owner and is required to claim funds
- Compromise of the viewing key breaks detection privacy but not fund security

---

## 7. Comparison with Ethereum Implementations

| Feature | StealthPay (Starknet) | Ethereum EIP-5564 |
|---------|-----------------------|-------------------|
| Curve | STARK (native) | secp256k1 |
| Hash | Poseidon (native) | keccak256 |
| On-chain ECDSA cost | Low (native) | Medium (precompile) |
| View tags | Yes (indexed events) | Recommended |
| Token support | ERC-20 (STRK, ETH) | ETH + ERC-20 |
| Key registration | On-chain registry | Flexible (ENS, registry) |
| Claim mechanism | Contract escrow + sig | Flexible |

StealthPay's use of Starknet-native primitives (STARK curve, Poseidon) results in lower gas costs for on-chain verification compared to Ethereum equivalents.

---

## 8. Future Work

### 8.1 Encrypted Wallet Derivation
Derive stealth keys from the connected wallet's signature over a fixed message, eliminating the need for separate key management.

### 8.2 Relayer Network
Fund claims through a relayer to avoid requiring the recipient to have gas tokens at the claim address, further improving privacy.

### 8.3 Amount Hiding via Pedersen Commitments
Currently, payment amounts and token types are recorded in plaintext on-chain, making statistical amount correlation possible (e.g. matching a 42.698 STRK deposit with a 42.698 STRK withdrawal). The immediate mitigation is to use standardized denominations (10, 100, 1000 STRK), which creates a large anonymity set and makes deposit-withdrawal matching statistically infeasible.

The long-term solution is to integrate Pedersen commitment schemes. A Pedersen commitment `C = r*G + v*H` (where `v` is the hidden amount and `r` is a blinding factor) allows the StealthPay contract to verify that the deposited amount matches the claimed amount without either value ever appearing on-chain. The sender commits to the amount during `send()`, and the recipient provides a zero-knowledge range proof during `claim()` demonstrating that the commitment opens to a valid, non-negative amount. Starknet's native elliptic curve builtins and Poseidon hashing make this integration particularly gas-efficient compared to equivalent constructions on Ethereum.

### 8.4 Multi-token Support
Extend the protocol to support batch payments and native ETH alongside ERC-20 tokens.

### 8.5 Account Abstraction Integration
Leverage Starknet's native account abstraction to deploy smart contract wallets at stealth addresses, enabling richer claiming logic.

---

## 9. Conclusion

StealthPay demonstrates that practical payment privacy is achievable on Starknet today, using existing cryptographic primitives and without sacrificing composability. By adapting the ERC-5564 stealth address protocol to the STARK curve and Poseidon hash function, StealthPay delivers gas-efficient private payments with a simple three-step user flow: register, send, receive.

The protocol requires no trusted parties, keeps spending keys fully client-side, and supports delegation of scanning through key separation. View tag optimization ensures that scanning remains fast even as the number of stealth payments grows.

StealthPay is a building block for a more private Starknet ecosystem, where receiving a payment does not require revealing your identity to the world.

---

## References

1. Buterin, V. "An Incomplete Guide to Stealth Addresses." January 2023. https://vitalik.eth.limo/general/2023/01/20/stealth.html
2. EIP-5564: Stealth Addresses. https://eips.ethereum.org/EIPS/eip-5564
3. EIP-6538: Stealth Meta-Address Registry. https://eips.ethereum.org/EIPS/eip-6538
4. Grassi, L. et al. "Poseidon: A New Hash Function for Zero-Knowledge Proof Systems." USENIX Security 2021.
5. Starknet Documentation: STARK Curve. https://docs.starknet.io/
