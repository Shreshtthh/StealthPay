/**
 * StealthPay Cryptographic Utilities
 *
 * Implements the stealth address protocol on the STARK curve:
 * - Key generation (spending + viewing keypairs)
 * - Stealth address computation (sender-side ECDH + commitment)
 * - Announcement scanning (recipient-side view tag filtering + ECDH)
 * - Stealth private key derivation + claim signing
 *
 * All EC operations use starknet.js utilities operating on the STARK curve
 * (same curve used natively by Cairo contracts).
 */

import { ec, hash, encode, type WeierstrassSignatureType } from "starknet";
import type {
    KeyPair,
    Point,
    StealthAddressResult,
    Announcement,
    StealthPayment,
    StealthSignature,
} from "./types";

// ─────────────────────── STARK Curve Constants ───────────────────────

// The STARK curve order (number of points on the curve)
const CURVE_ORDER = BigInt(
    "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f"
);

// The STARK curve prime field
const FIELD_PRIME = BigInt(
    "0x0800000000000011000000000000000000000000000000000000000000000001"
);

// STARK curve: y^2 = x^3 + alpha*x + beta (mod p)
const CURVE_ALPHA = BigInt(1);
const CURVE_BETA = BigInt(
    "0x06f21413efbe40de150e596d72f7a8c5609ad26c15c915c1f4cdfcb99cee9e89"
);

// ─────────────────────── Key Generation ───────────────────────

/**
 * Generate a random private key and its corresponding public key on the STARK curve.
 *
 * IMPORTANT: We normalize the public key to use the canonical (smaller) y-coordinate.
 * This is necessary because the on-chain registry only stores x-coordinates, and when
 * the sender recovers y from x via recoverPointFromX, it always picks the canonical y.
 * If the receiver's stored y doesn't match, P_spend + sh*G will differ and the
 * commitment verification will fail.
 *
 * If the generated y is not canonical, we negate the private key (CURVE_ORDER - privKey)
 * so it maps to the point (x, canonicalY) instead of (x, nonCanonicalY).
 */
function generateKeyPair(): KeyPair {
    const privateKey = encode.addHexPrefix(
        encode.buf2hex(ec.starkCurve.utils.randomPrivateKey())
    );
    const pubKey = ec.starkCurve.getPublicKey(privateKey, false);
    // pubKey is uncompressed: 04 || x (32 bytes) || y (32 bytes)
    const pubKeyHex = encode.addHexPrefix(encode.buf2hex(pubKey));
    const x = encode.addHexPrefix(pubKeyHex.slice(4, 68)); // skip '0x04'
    const y = encode.addHexPrefix(pubKeyHex.slice(68, 132));

    const yBig = BigInt(y);
    const yFlipped = FIELD_PRIME - yBig;

    // If y is not canonical (i.e., y > p - y), negate the private key
    if (yBig > yFlipped) {
        const negatedPriv = CURVE_ORDER - BigInt(privateKey);
        return {
            privateKey: encode.addHexPrefix(negatedPriv.toString(16).padStart(64, "0")),
            publicKey: {
                x,
                y: encode.addHexPrefix(yFlipped.toString(16).padStart(64, "0")),
            },
        };
    }

    return {
        privateKey,
        publicKey: { x, y },
    };
}

/**
 * Generate both spending and viewing keypairs for stealth address registration.
 */
export function generateKeyPairs(): {
    spendingKey: KeyPair;
    viewingKey: KeyPair;
} {
    return {
        spendingKey: generateKeyPair(),
        viewingKey: generateKeyPair(),
    };
}

// ─────────────────────── Helpers ───────────────────────

/**
 * Modular exponentiation: base^exp mod m
 */
function modPow(base: bigint, exp: bigint, m: bigint): bigint {
    let result = 1n;
    base = ((base % m) + m) % m;
    while (exp > 0n) {
        if (exp % 2n === 1n) {
            result = (result * base) % m;
        }
        exp = exp / 2n;
        base = (base * base) % m;
    }
    return result;
}

/**
 * Tonelli-Shanks algorithm for computing modular square roots.
 * Works for any odd prime p (unlike the (p+1)/4 shortcut which requires p ≡ 3 mod 4).
 * The STARK field prime p ≡ 1 (mod 4), so we must use this algorithm.
 * Returns a square root of n mod p, or null if none exists.
 */
function tonelliShanks(n: bigint, p: bigint): bigint | null {
    n = ((n % p) + p) % p;
    if (n === 0n) return 0n;

    // Check if n is a quadratic residue (Euler criterion)
    if (modPow(n, (p - 1n) / 2n, p) !== 1n) return null;

    // Factor out powers of 2 from p - 1: p - 1 = Q * 2^S
    let Q = p - 1n;
    let S = 0n;
    while (Q % 2n === 0n) {
        Q /= 2n;
        S += 1n;
    }

    // Find a quadratic non-residue z
    let z = 2n;
    while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) {
        z += 1n;
    }

    let M = S;
    let c = modPow(z, Q, p);
    let t = modPow(n, Q, p);
    let R = modPow(n, (Q + 1n) / 2n, p);

    while (true) {
        if (t === 0n) return 0n;
        if (t === 1n) return R;

        // Find the least i such that t^(2^i) ≡ 1 (mod p)
        let i = 1n;
        let temp = (t * t) % p;
        while (temp !== 1n) {
            temp = (temp * temp) % p;
            i += 1n;
        }

        // Update
        const b = modPow(c, modPow(2n, M - i - 1n, p - 1n), p);
        M = i;
        c = (b * b) % p;
        t = (t * c) % p;
        R = (R * b) % p;
    }
}

/**
 * Recover the full curve point (x, y) from just the x-coordinate.
 * Uses the STARK curve equation: y^2 = x^3 + alpha*x + beta (mod p)
 * Returns the point with the smaller y value (canonical).
 */
export function recoverPointFromX(xHex: string): Point {
    const x = BigInt(xHex);
    // y^2 = x^3 + alpha*x + beta mod p
    const ySquared = (modPow(x, 3n, FIELD_PRIME) + CURVE_ALPHA * x + CURVE_BETA) % FIELD_PRIME;

    // Use Tonelli-Shanks to compute the square root (STARK prime ≡ 1 mod 4)
    const y = tonelliShanks(ySquared, FIELD_PRIME);
    if (y === null) {
        throw new Error(`No valid y for x=${xHex}`);
    }

    // Return canonical (smaller) y
    const yCanonical = y > FIELD_PRIME - y ? FIELD_PRIME - y : y;

    return {
        x: encode.addHexPrefix(x.toString(16).padStart(64, "0")),
        y: encode.addHexPrefix(yCanonical.toString(16).padStart(64, "0")),
    };
}

/**
 * Ensure a Point has a valid y-coordinate. If y is "0x0" or missing,
 * recover it from x using the curve equation.
 */
function ensureFullPoint(point: Point): Point {
    const yBig = BigInt(point.y);
    if (yBig === 0n) {
        return recoverPointFromX(point.x);
    }
    return point;
}

/**
 * Perform EC point multiplication: scalar * point.
 * Auto-recovers the y-coordinate if only x is provided.
 */
function ecMultiply(scalar: string, point: Point): Point {
    const fullPoint = ensureFullPoint(point);
    const px = BigInt(fullPoint.x);
    const py = BigInt(fullPoint.y);
    const p = new ec.starkCurve.ProjectivePoint(px, py, 1n);
    const result = p.multiply(BigInt(scalar));
    const affine = result.toAffine();
    return {
        x: encode.addHexPrefix(affine.x.toString(16).padStart(64, "0")),
        y: encode.addHexPrefix(affine.y.toString(16).padStart(64, "0")),
    };
}

/**
 * Perform EC point addition: p1 + p2.
 */
function ecAdd(p1: Point, p2: Point): Point {
    const fp1 = ensureFullPoint(p1);
    const fp2 = ensureFullPoint(p2);
    const proj1 = new ec.starkCurve.ProjectivePoint(
        BigInt(fp1.x),
        BigInt(fp1.y),
        1n
    );
    const proj2 = new ec.starkCurve.ProjectivePoint(
        BigInt(fp2.x),
        BigInt(fp2.y),
        1n
    );
    const result = proj1.add(proj2);
    const affine = result.toAffine();
    return {
        x: encode.addHexPrefix(affine.x.toString(16).padStart(64, "0")),
        y: encode.addHexPrefix(affine.y.toString(16).padStart(64, "0")),
    };
}

/**
 * Compute the scalar * Generator point.
 */
function scalarToPoint(scalar: string): Point {
    const pubKey = ec.starkCurve.getPublicKey(scalar, false);
    const pubKeyHex = encode.addHexPrefix(encode.buf2hex(pubKey));
    const x = encode.addHexPrefix(pubKeyHex.slice(4, 68));
    const y = encode.addHexPrefix(pubKeyHex.slice(68, 132));
    return { x, y };
}

/**
 * Extract view tag from hash.
 * Returns a felt-compatible hex string (no leading zeros stripped).
 */
function extractViewTag(hashValue: string): string {
    const hex = hashValue.replace("0x", "").padStart(64, "0");
    // Take first byte (2 hex chars)
    const tag = hex.slice(0, 2);
    // Return as a normalized felt (strip leading zeros, add 0x prefix)
    return encode.addHexPrefix(BigInt("0x" + tag).toString(16));
}

/**
 * Normalize a felt value for comparison (strip leading zeros).
 */
function normalizeFelt(val: string): string {
    return encode.addHexPrefix(BigInt(val).toString(16));
}

/**
 * Modular addition on the STARK curve order: (a + b) mod n
 */
function modAdd(a: string, b: string): string {
    const result = (BigInt(a) + BigInt(b)) % CURVE_ORDER;
    return encode.addHexPrefix(result.toString(16).padStart(64, "0"));
}

// ─────────────────────── Sender: Compute Stealth Address ───────────────────────

/**
 * Compute a stealth address for sending a private payment.
 *
 * This is the SENDER's side of the protocol:
 * 1. Generate ephemeral keypair (e, E = e*G)
 * 2. Compute shared secret: S = e * P_view
 * 3. Hash the shared secret: s_h = poseidon(S.x)
 * 4. Derive stealth public key: P_stealth = P_spend + s_h * G
 * 5. Compute commitment: poseidon(P_stealth.x)
 * 6. Extract view tag from s_h
 */
export function computeStealthAddress(
    recipientSpendPub: Point,
    recipientViewPub: Point
): StealthAddressResult {
    // 1. Generate ephemeral key
    const ephemeral = generateKeyPair();

    // 2. Shared secret: e * P_view (ECDH)
    const sharedSecret = ecMultiply(ephemeral.privateKey, recipientViewPub);

    // 3. Hash the shared secret's x-coordinate using Poseidon
    const sh = hash.computePoseidonHash(sharedSecret.x, "0x0");

    // 4. Derive stealth public key: P_spend + s_h * G
    const shPoint = scalarToPoint(sh);
    const stealthPubKey = ecAdd(recipientSpendPub, shPoint);

    // 5. Commitment = poseidon(stealth_pub_x)
    const stealthCommitment = hash.computePoseidonHashOnElements([
        stealthPubKey.x,
    ]);

    // 6. View tag = first byte of s_h
    const viewTag = extractViewTag(sh);

    return {
        ephemeralPubKey: ephemeral.publicKey,
        stealthCommitment,
        viewTag,
        stealthPubKey,
        sharedSecretX: sharedSecret.x,
    };
}

// ─────────────────────── Recipient: Scan Announcements ───────────────────────

/**
 * Scan announcement events to find payments addressed to us.
 *
 * This is the RECIPIENT's side:
 * 1. For each announcement, compute shared secret: p_view * E (ephemeral pub)
 * 2. Hash it: s_h = poseidon(S.x)
 * 3. Check view tag (fast client-side pre-filter to skip heavy computation)
 * 4. Derive expected stealth pub: P_spend + s_h * G
 * 5. Compute expected commitment and compare
 * 6. If match → derive the stealth private key for claiming
 */
export function scanAnnouncements(
    viewingPrivKey: string,
    spendingPubKey: Point,
    spendingPrivKey: string,
    announcements: Announcement[]
): StealthPayment[] {
    const payments: StealthPayment[] = [];

    for (const ann of announcements) {
        try {
            // 1. Shared secret: p_view * E
            const sharedSecret = ecMultiply(viewingPrivKey, ann.ephemeralPubKey);

            // 2. Hash shared secret
            const sh = hash.computePoseidonHash(sharedSecret.x, "0x0");

            // 3. Check view tag (fast pre-filter — skip expensive EC add + Poseidon if mismatch)
            const expectedViewTag = extractViewTag(sh);
            const normalizedAnnViewTag = normalizeFelt(ann.viewTag);

            if (expectedViewTag !== normalizedAnnViewTag) {
                continue;
            }

            // 4. Derive expected stealth public key
            const shPoint = scalarToPoint(sh);
            const expectedStealthPub = ecAdd(spendingPubKey, shPoint);

            // 5. Compute expected commitment
            const expectedCommitment = hash.computePoseidonHashOnElements([
                expectedStealthPub.x,
            ]);

            const normalizedExpectedCommitment = normalizeFelt(expectedCommitment);
            const normalizedAnnCommitment = normalizeFelt(ann.stealthCommitment);

            if (normalizedExpectedCommitment !== normalizedAnnCommitment) {
                continue;
            }

            // 6. Match found! Derive stealth private key: p_spend + s_h
            const stealthPrivKey = modAdd(spendingPrivKey, sh);

            payments.push({
                commitment: ann.stealthCommitment,
                amount: ann.amount,
                token: ann.token,
                stealthPrivKey,
                stealthPubKey: expectedStealthPub,
                blockNumber: ann.blockNumber,
                ipfsCid: ann.ipfsCid,
                sharedSecretX: sharedSecret.x,
            });
        } catch (e) {
            console.error("  -> Error processing announcement:", e);
            continue;
        }
    }

    return payments;
}

// ─────────────────────── Recipient: Sign Claim ───────────────────────

/**
 * Sign a claim using the stealth private key.
 * The message being signed is the stealth commitment itself.
 * The contract verifies this signature against the stealth public key.
 */
export function signClaim(
    stealthPrivKey: string,
    commitment: string
): StealthSignature {
    const sig: WeierstrassSignatureType = ec.starkCurve.sign(
        commitment,
        stealthPrivKey
    );
    return {
        r: encode.addHexPrefix(sig.r.toString(16).padStart(64, "0")),
        s: encode.addHexPrefix(sig.s.toString(16).padStart(64, "0")),
    };
}

// ─────────────────────── Key Storage (localStorage) ───────────────────────

const KEYS_STORAGE_KEY = "stealthpay_keys";

export interface StoredKeys {
    spendingPrivKey: string;
    spendingPubKey: Point;
    viewingPrivKey: string;
    viewingPubKey: Point;
}

/**
 * Save keys to localStorage. For testnet demo only.
 * In production, keys will be derived from the wallet or encrypted.
 */
export function saveKeys(keys: StoredKeys): void {
    if (typeof window !== "undefined") {
        localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
    }
}

/** Load keys from localStorage. Returns null if not found. */
export function loadKeys(): StoredKeys | null {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(KEYS_STORAGE_KEY);
    if (!stored) return null;
    try {
        return JSON.parse(stored) as StoredKeys;
    } catch {
        return null;
    }
}

/** Clear stored keys from localStorage. */
export function clearKeys(): void {
    if (typeof window !== "undefined") {
        localStorage.removeItem(KEYS_STORAGE_KEY);
    }
}
