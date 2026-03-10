import { RpcProvider, hash } from "starknet";

// Manually copied from ipfs.ts
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

async function main() {
    const provider = new RpcProvider({ nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_9" });
    
    // StealthAnnouncer address
    const address = "0x18da9e44c2f6a26e8972bde2e91eeda3ad9dad80bd7ac6817ec32a1b5c226d4";
    
    const eventsParams = {
        address,
        from_block: { block_number: 7430000 },
        to_block: "latest",
        chunk_size: 10,
    };

    const res = await provider.getEvents(eventsParams as any);
    console.log(`Found ${res.events.length} events`);
    
    if (res.events.length > 0) {
        const latestEvent = res.events[res.events.length - 1];
        console.log("Latest event raw:");
        console.log(JSON.stringify(latestEvent, null, 2));
        
        console.log("--- Extracting ---");
        const keys = latestEvent.keys || [];
        const data = latestEvent.data || [];
        console.log("Keys:", keys);
        console.log("Data length:", data.length);
        console.log("Data:", data);
        
        if (data.length > 6) {
           const ipfsCidFelt = data[6];
           console.log("ipfs_cid felt:", ipfsCidFelt);
           if (ipfsCidFelt !== "0x0" && ipfsCidFelt !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
               const decoded = feltToCidPrefix(ipfsCidFelt);
               console.log("Decoded CID prefix:", decoded);
           }
        }
    }
}

main().catch(console.error);
