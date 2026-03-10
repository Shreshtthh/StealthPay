/**
 * IPFS Memo Utilities for StealthPay
 *
 * Provides encrypted memo functionality using the ECDH shared secret:
 * - AES-256-GCM encryption/decryption of memo payloads
 * - Upload to / fetch from IPFS via Pinata
 * - CID ↔ felt252 encoding for on-chain storage
 */

// ─────────────────────── Configuration ───────────────────────

const PINATA_GATEWAY =
    process.env.NEXT_PUBLIC_PINATA_GATEWAY || "gateway.pinata.cloud";

// ─────────────────────── Encryption ───────────────────────

/**
 * Derive a 256-bit AES key from the shared secret x-coordinate.
 * Uses SHA-256 to map the arbitrary-length hex string to exactly 32 bytes.
 */
async function deriveAESKey(sharedSecretX: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = encoder.encode(sharedSecretX);
    const hashBuffer = await crypto.subtle.digest("SHA-256", keyMaterial);

    return crypto.subtle.importKey("raw", hashBuffer, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
    ]);
}

/**
 * Encrypt a memo string using AES-256-GCM with the shared secret.
 * Returns the IV (12 bytes) prepended to the ciphertext.
 */
export async function encryptMemo(
    memo: string,
    sharedSecretX: string
): Promise<Uint8Array> {
    const key = await deriveAESKey(sharedSecretX);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const data = encoder.encode(memo);

    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        data
    );

    // Prepend IV to ciphertext: [12 bytes IV][ciphertext...]
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv);
    result.set(new Uint8Array(ciphertext), iv.length);
    return result;
}

/**
 * Decrypt an encrypted memo using AES-256-GCM with the shared secret.
 * Expects the input to have IV prepended (as produced by encryptMemo).
 */
export async function decryptMemo(
    encrypted: Uint8Array,
    sharedSecretX: string
): Promise<string> {
    const key = await deriveAESKey(sharedSecretX);

    // Extract IV (first 12 bytes) and ciphertext (rest)
    const iv = encrypted.slice(0, 12);
    const ciphertext = encrypted.slice(12);

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}

// ─────────────────────── IPFS Upload/Fetch (Pinata) ───────────────────────

/**
 * Upload encrypted data to IPFS via our backend proxy.
 * Returns the IPFS CID (content identifier) of the uploaded file.
 */
export async function uploadToIPFS(data: Uint8Array): Promise<string> {
    const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
    const formData = new FormData();
    formData.append("file", blob, "stealth-memo.enc");

    // Add Pinata metadata
    const metadata = JSON.stringify({
        name: `stealth-memo-${Date.now()}`,
    });
    formData.append("pinataMetadata", metadata);

    const response = await fetch("/api/ipfs", {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`IPFS upload proxy failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    return result.IpfsHash as string;
}

/**
 * Fetch encrypted data from IPFS using a gateway URL.
 * Tries the configured Pinata gateway first, falls back to public gateways.
 */
export async function fetchFromIPFS(cid: string): Promise<Uint8Array> {
    const gateways = [
        `https://${PINATA_GATEWAY}/ipfs/${cid}`,
        `https://ipfs.io/ipfs/${cid}`,
        `https://dweb.link/ipfs/${cid}`,
    ];

    let lastError: Error | null = null;

    for (const url of gateways) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Gateway returned ${response.status}`);
            }
            const buffer = await response.arrayBuffer();
            return new Uint8Array(buffer);
        } catch (e) {
            lastError = e as Error;
            continue;
        }
    }

    throw new Error(
        `Failed to fetch CID ${cid} from all gateways: ${lastError?.message}`
    );
}

// ─────────────────────── CID ↔ felt252 Encoding ───────────────────────

/**
 * Encode an IPFS CID string into a felt252-compatible hex string.
 *
 * A felt252 holds up to 31 bytes. CIDv1 base32 strings are typically 59 chars,
 * too large for a single felt. We store the raw bytes of the CID's multihash
 * digest (the last 31 bytes of the CID), which is enough to reconstruct the
 * full CID knowing the codec and hash function.
 *
 * For simplicity in a hackathon context, we encode the CID as ASCII bytes
 * truncated to 31 chars and store as a felt252 hex value.
 */
export function cidToFelt(cid: string): string {
    // Take up to 31 ASCII characters of the CID
    const truncated = cid.slice(0, 31);
    let hex = "0x";
    for (let i = 0; i < truncated.length; i++) {
        hex += truncated.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return hex;
}

/**
 * Decode a felt252 hex string back to a CID prefix string.
 * Returns the stored CID prefix (up to 31 chars).
 */
export function feltToCidPrefix(felt: string): string {
    const hex = felt.replace("0x", "");
    if (hex === "0" || hex === "") return "";

    let result = "";
    for (let i = 0; i < hex.length; i += 2) {
        const charCode = parseInt(hex.slice(i, i + 2), 16);
        if (charCode === 0) break;
        result += String.fromCharCode(charCode);
    }
    return result;
}

// ─────────────────────── Full CID Storage (localStorage) ───────────────────────

/**
 * Since a felt252 can only hold 31 bytes, we store a mapping from the truncated
 * CID prefix (on-chain) to the full CID in localStorage. This enables full
 * retrieval of the CID from the truncated on-chain value.
 */
const CID_MAP_KEY = "stealthpay_cid_map";

/** Save a full CID keyed by its felt-encoded prefix. */
export function saveCidMapping(felt: string, fullCid: string): void {
    if (typeof window === "undefined") return;
    const map = loadCidMap();
    map[felt] = fullCid;
    localStorage.setItem(CID_MAP_KEY, JSON.stringify(map));
}

/** Look up a full CID from its felt-encoded prefix. */
export function lookupFullCid(felt: string): string | null {
    const map = loadCidMap();
    return map[felt] || null;
}

function loadCidMap(): Record<string, string> {
    if (typeof window === "undefined") return {};
    try {
        const stored = localStorage.getItem(CID_MAP_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
}

// ─────────────────────── High-Level Helpers ───────────────────────

/**
 * Encrypt a memo and upload it to IPFS. Returns the CID and felt252-encoded version.
 * Also saves the CID mapping for later retrieval.
 */
export async function encryptAndUploadMemo(
    memo: string,
    sharedSecretX: string
): Promise<{ cid: string; cidFelt: string }> {
    const encrypted = await encryptMemo(memo, sharedSecretX);
    const cid = await uploadToIPFS(encrypted);
    const cidFelt = cidToFelt(cid);
    saveCidMapping(cidFelt, cid);
    return { cid, cidFelt };
}

/**
 * Fetch and decrypt a memo from IPFS using the on-chain CID felt.
 * Attempts to resolve the full CID from localStorage, then from the
 * felt prefix directly (which works for short CIDv0 hashes).
 */
export async function fetchAndDecryptMemo(
    cidFelt: string,
    sharedSecretX: string
): Promise<string | null> {
    try {
        // Resolve the full CID
        let cid = lookupFullCid(cidFelt);
        if (!cid) {
            // Try using the felt prefix directly as a CID
            cid = feltToCidPrefix(cidFelt);
        }
        if (!cid) return null;

        const encrypted = await fetchFromIPFS(cid);
        return await decryptMemo(encrypted, sharedSecretX);
    } catch (e) {
        console.error("Failed to fetch/decrypt memo:", e);
        return null;
    }
}
