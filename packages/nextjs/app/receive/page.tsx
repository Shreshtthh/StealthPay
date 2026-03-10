"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAccount } from "@starknet-react/core";
import {
    useStealthContractInfo,
    useStealthWriteContract,
} from "~~/hooks/stealth/useStealthContracts";
import { useTargetNetwork } from "~~/hooks/scaffold-stark/useTargetNetwork";
import {
    scanAnnouncements,
    signClaim,
    loadKeys,
} from "~~/utils/stealth/crypto";
import type { Announcement, StealthPayment } from "~~/utils/stealth/types";
import { RpcProvider } from "starknet";
import { getRpcUrl } from "~~/services/web3/provider";

const ReceivePage = () => {
    const { address, status } = useAccount();
    const [payments, setPayments] = useState<StealthPayment[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [claimingIdx, setClaimingIdx] = useState<number | null>(null);
    const [scanDone, setScanDone] = useState(false);
    const [events, setEvents] = useState<any[]>([]);
    const [eventsLoading, setEventsLoading] = useState(false);

    const { data: announcerData } = useStealthContractInfo("StealthAnnouncer");
    const { targetNetwork } = useTargetNetwork();

    const publicClient = useMemo(() => {
        return new RpcProvider({
            nodeUrl: getRpcUrl(targetNetwork.network),
        });
    }, [targetNetwork.network]);

    // Fetch events manually from the announcer contract
    useEffect(() => {
        if (!announcerData || status !== "connected") return;

        let cancelled = false;
        setEventsLoading(true);

        // Start scanning from near the deployment block to avoid RPC range limits
        const DEPLOYMENT_BLOCK = 7430000;

        console.log("Fetching events from announcer:", announcerData.address, "from block:", DEPLOYMENT_BLOCK);

        publicClient
            .getEvents({
                chunk_size: 100,
                address: announcerData.address,
                from_block: { block_number: DEPLOYMENT_BLOCK },
                to_block: "latest" as any,
                keys: [],
            })
            .then((resp) => {
                console.log("Events fetched:", resp.events?.length ?? 0, resp);
                if (!cancelled) setEvents(resp.events || []);
            })
            .catch((err) => {
                console.error("Failed to fetch events:", err);
                if (!cancelled) setEvents([]);
            })
            .finally(() => {
                if (!cancelled) setEventsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [announcerData, publicClient, status]);

    // Write hook for claiming
    const { sendAsync: claimPayment } = useStealthWriteContract({
        contractName: "StealthPay",
        functionName: "claim",
    });

    const handleScan = useCallback(() => {
        const keys = loadKeys();
        if (!keys) {
            console.error("No stealth keys found in localStorage");
            return;
        }

        setIsScanning(true);
        setScanDone(false);

        try {
            if (events.length === 0) {
                console.log("No announcement events found on-chain");
                setPayments([]);
                setScanDone(true);
                return;
            }

            console.log("Scanning", events.length, "events...");

            // Parse raw events into our Announcement type
            // Raw events from getEvents have keys[] and data[] arrays
            const announcements: Announcement[] = events.map((e: any) => {
                const keys = e.keys || [];
                const data = e.data || [];
                return {
                    ephemeralPubKey: {
                        x: data[0] ?? "0x0",
                        y: data[1] ?? "0x0",
                    },
                    stealthCommitment: keys[2] ?? "0x0",
                    viewTag: keys[1] ?? "0x0",
                    token: data[2] ?? "0x0",
                    amount: BigInt(data[3] ?? "0"),
                    caller: data[5] ?? "0x0",
                    blockNumber: e.block_number,
                };
            });

            console.log("Parsed announcements:", announcements);

            // Scan announcements to find payments addressed to us
            const found = scanAnnouncements(
                keys.viewingPrivKey,
                keys.spendingPubKey,
                keys.spendingPrivKey,
                announcements,
            );

            console.log("Found payments:", found.length);
            setPayments(found);
            setScanDone(true);
        } catch (e) {
            console.error("Scan failed:", e);
        } finally {
            setIsScanning(false);
        }
    }, [events]);

    const handleClaim = async (payment: StealthPayment, idx: number) => {
        if (!address) return;

        setClaimingIdx(idx);
        try {
            // Sign the commitment with the stealth private key
            const sig = signClaim(payment.stealthPrivKey, payment.commitment);

            // Call StealthPay.claim()
            await claimPayment({
                args: [
                    payment.commitment,
                    payment.stealthPubKey.x,
                    sig.r,
                    sig.s,
                    address, // send claimed funds to our wallet
                ],
            });

            // Remove claimed payment from list
            setPayments((prev) => prev.filter((_, i) => i !== idx));
        } catch (e) {
            console.error("Claim failed:", e);
        } finally {
            setClaimingIdx(null);
        }
    };

    if (status !== "connected") {
        return (
            <div className="flex items-center flex-col grow pt-10">
                <div className="px-5 text-center">
                    <h1 className="text-4xl font-bold mb-4">📥 Receive</h1>
                    <p className="text-lg opacity-70">
                        Connect your wallet to scan for incoming stealth payments.
                    </p>
                </div>
            </div>
        );
    }

    const keys = loadKeys();

    return (
        <div className="flex items-center flex-col grow pt-10">
            <div className="px-5 w-full max-w-2xl">
                <h1 className="text-4xl font-bold text-center mb-8">
                    📥 Receive & Claim Payments
                </h1>

                {!keys ? (
                    <div className="alert alert-warning">
                        <span>
                            ⚠️ No stealth keys found. Please go to{" "}
                            <a href="/register" className="link link-primary">
                                Register
                            </a>{" "}
                            first to generate your keys.
                        </span>
                    </div>
                ) : (
                    <>
                        {/* Scan Button */}
                        <div className="card bg-base-100 shadow-xl mb-6 border border-gradient">
                            <div className="card-body items-center text-center">
                                <h2 className="card-title">Scan for Payments</h2>
                                <p className="opacity-70 text-sm">
                                    Scans on-chain Announcement events and uses your viewing key
                                    to find payments addressed to you.
                                </p>
                                <div className="card-actions mt-4">
                                    <button
                                        className="btn btn-primary btn-lg"
                                        onClick={handleScan}
                                        disabled={isScanning || eventsLoading}
                                    >
                                        {isScanning
                                            ? "Scanning..."
                                            : eventsLoading
                                                ? "Loading events..."
                                                : "Scan for Payments"}
                                    </button>
                                </div>
                                {scanDone && (
                                    <p className="mt-2 text-sm opacity-50">
                                        Scanned {events.length} announcements. Found{" "}
                                        {payments.length} payment(s).
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Payments List */}
                        {payments.length > 0 && (
                            <div className="space-y-4">
                                <h2 className="text-2xl font-bold">
                                    Your Payments ({payments.length})
                                </h2>
                                {payments.map((payment, idx) => (
                                    <div
                                        key={payment.commitment}
                                        className="card bg-base-100 shadow-lg border border-gradient"
                                    >
                                        <div className="card-body">
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <p className="text-sm opacity-50">Amount</p>
                                                    <p className="text-xl font-bold">
                                                        {(
                                                            Number(payment.amount) / 1e18
                                                        ).toFixed(6)}{" "}
                                                        tokens
                                                    </p>
                                                </div>
                                                <button
                                                    className="btn btn-success"
                                                    onClick={() => handleClaim(payment, idx)}
                                                    disabled={claimingIdx === idx}
                                                >
                                                    {claimingIdx === idx ? "Claiming..." : "Claim"}
                                                </button>
                                            </div>
                                            <div className="mt-2">
                                                <p className="text-xs opacity-50">Commitment</p>
                                                <p className="text-xs font-mono break-all">
                                                    {payment.commitment}
                                                </p>
                                            </div>
                                            <div className="mt-1">
                                                <p className="text-xs opacity-50">Token</p>
                                                <p className="text-xs font-mono break-all">
                                                    {payment.token}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {scanDone && payments.length === 0 && (
                            <div className="alert alert-info">
                                <span>No stealth payments found for your viewing key.</span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default ReceivePage;
