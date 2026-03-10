import { NextResponse } from "next/server";

const PINATA_JWT = process.env.PINATA_JWT;

export async function POST(request: Request) {
    if (!PINATA_JWT) {
        return NextResponse.json(
            { error: "PINATA_JWT is not configured on the server" },
            { status: 500 }
        );
    }

    try {
        const formData = await request.formData();
        const file = formData.get("file") as Blob | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        // Forward the exact same FormData to Pinata
        const pinataFormData = new FormData();
        pinataFormData.append("file", file, "stealth-memo.enc");

        const metadataStr = formData.get("pinataMetadata") as string | null;
        if (metadataStr) {
            pinataFormData.append("pinataMetadata", metadataStr);
        } else {
            pinataFormData.append(
                "pinataMetadata",
                JSON.stringify({ name: `stealth-memo-${Date.now()}` })
            );
        }

        const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${PINATA_JWT}`,
            },
            body: pinataFormData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Pinata API returned ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        
        // Return exactly what the original frontend uploadToIPFS function expected
        return NextResponse.json(result, { status: 200 });
    } catch (error: any) {
        console.error("IPFS proxy error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to upload to IPFS" },
            { status: 500 }
        );
    }
}
