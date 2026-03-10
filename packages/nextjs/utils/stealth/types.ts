/**
 * Type definitions for the StealthPay protocol.
 */

/** A point on the STARK elliptic curve, represented by x and y coordinates as hex strings. */
export interface Point {
    x: string;
    y: string;
}

/** A keypair consisting of a private key (scalar) and public key (curve point). */
export interface KeyPair {
    privateKey: string;
    publicKey: Point;
}

/** A stealth meta-address: the public spending and viewing keys a user registers on-chain. */
export interface MetaAddress {
    spendPubKey: Point;
    viewPubKey: Point;
}

/** The result of computing a stealth address — everything the sender needs to make a deposit. */
export interface StealthAddressResult {
    /** The ephemeral public key (published in the Announcement event) */
    ephemeralPubKey: Point;
    /** Poseidon hash of the stealth public key — the unique deposit identifier */
    stealthCommitment: string;
    /** First byte of the shared secret hash — used for fast event filtering */
    viewTag: string;
    /** The stealth public key (needed by recipient to verify & claim) */
    stealthPubKey: Point;
    /** The shared secret x-coordinate — used for encrypted IPFS memo derivation */
    sharedSecretX: string;
}

/** An Announcement event parsed from on-chain. */
export interface Announcement {
    ephemeralPubKey: Point;
    stealthCommitment: string;
    viewTag: string;
    token: string;
    amount: bigint;
    caller: string;
    blockNumber?: number;
    /** IPFS CID of the encrypted memo (felt252 on-chain, 0 = no memo) */
    ipfsCid?: string;
}

/** A detected stealth payment that the user can claim. */
export interface StealthPayment {
    commitment: string;
    amount: bigint;
    token: string;
    stealthPrivKey: string;
    stealthPubKey: Point;
    blockNumber?: number;
    /** Decrypted memo from IPFS, if one was attached */
    memo?: string;
    /** IPFS CID felt for memo retrieval */
    ipfsCid?: string;
    /** Shared secret x-coordinate for memo decryption */
    sharedSecretX?: string;
    /** Whether this payment has already been claimed on-chain */
    isClaimed?: boolean;
}

/** ECDSA signature components for claiming a payment. */
export interface StealthSignature {
    r: string;
    s: string;
}

/** Contract addresses for all deployed StealthPay contracts. */
export interface StealthContracts {
    registry: string;
    announcer: string;
    stealthPay: string;
}
