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
import { fetchAndDecryptMemo, feltToCidPrefix } from "~~/utils/stealth/ipfs";
import type { Announcement, StealthPayment } from "~~/utils/stealth/types";
import { RpcProvider } from "starknet";
import { getRpcUrl } from "~~/services/web3/provider";
import { notification } from "~~/utils/scaffold-stark";

const ReceivePage = () => {
    const { address, status } = useAccount();
    const [payments, setPayments] = useState<StealthPayment[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [claimingIdx, setClaimingIdx] = useState<number | null>(null);
    const [scanDone, setScanDone] = useState(false);
    const [events, setEvents] = useState<any[]>([]);
    const [eventsLoading, setEventsLoading] = useState(false);
    const [memoLoading, setMemoLoading] = useState(false);

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

    const handleScan = useCallback(async () => {
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
                    ipfsCid: data[6] ?? "0x0",
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

            // Fetch and decrypt IPFS memos for payments that have a CID
            if (found.length > 0) {
                setMemoLoading(true);
                const updatedPayments = await Promise.all(
                    found.map(async (payment) => {
                        // Check if there is a non-zero CID
                        const cidFelt = payment.ipfsCid;
                        if (!cidFelt || cidFelt === "0x0" || BigInt(cidFelt) === 0n) {
                            return payment;
                        }
                        if (!payment.sharedSecretX) return payment;

                        try {
                            const memo = await fetchAndDecryptMemo(
                                cidFelt,
                                payment.sharedSecretX
                            );
                            return { ...payment, memo: memo || undefined };
                        } catch (e) {
                            console.error("Memo decryption failed for", cidFelt, e);
                            return payment;
                        }
                    })
                );
                setPayments(updatedPayments);
                setMemoLoading(false);
            }
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
        } catch (e: any) {
            console.error("Claim failed:", e);
            if (e.message && (e.message.includes("User rejected") || e.message.includes("User abort"))) {
                notification.info("Claim cancelled");
                return;
            }
            alert(e.message || "Claim failed");
        } finally {
            setClaimingIdx(null);
        }
    };

    if (status !== "connected") {
        return (
            <div className="flex items-center flex-col grow pt-10 animate-fade-in">
                <div className="px-5 text-center max-w-md">
                    <h1 className="text-4xl font-bold mb-4 text-gradient">Receive</h1>
                    <p className="text-base opacity-60">
                        Connect your wallet to scan for incoming stealth payments.
                    </p>
                </div>
            </div>
        );
    }

    const keys = loadKeys();

    return (
        <div className="flex items-center flex-col grow pt-10 animate-fade-in">
            <div className="px-5 w-full max-w-2xl">
                <p className="text-sm font-semibold tracking-widest uppercase opacity-50 text-center mb-2">
                    Claim Funds
                </p>
                <h1 className="text-4xl font-bold text-center mb-8 text-gradient">
                    Receive Payments
                </h1>

                {!keys ? (
                    <div className="alert bg-base-300/30 border border-warning/20">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <span className="text-sm">
                            No stealth keys found. Please{" "}
                            <a href="/register" className="link link-primary font-semibold">
                                register
                            </a>{" "}
                            first to generate your keys.
                        </span>
                    </div>
                ) : (
                    <>
                        {/* Scan Card */}
                        <div className="glass-card rounded-2xl mb-6">
                            <div className="p-6 text-center">
                                <div className="flex items-center justify-center gap-2 mb-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    <h2 className="text-lg font-bold">Scan for Payments</h2>
                                </div>
                                <p className="opacity-50 text-sm mb-5 max-w-md mx-auto">
                                    Scans on-chain Announcement events and uses your viewing key
                                    to find payments addressed to you.
                                </p>
                                <button
                                    className="btn btn-primary btn-lg px-8"
                                    onClick={handleScan}
                                    disabled={isScanning || eventsLoading}
                                >
                                    {(isScanning || eventsLoading) && (
                                        <span className="loading loading-spinner loading-sm" />
                                    )}
                                    {isScanning
                                        ? "Scanning..."
                                        : eventsLoading
                                            ? "Loading events..."
                                            : "Scan for Payments"}
                                </button>
                                {scanDone && (
                                    <p className="mt-3 text-xs opacity-40">
                                        Scanned {events.length} announcements. Found{" "}
                                        {payments.length} payment(s).
                                        {memoLoading && " Decrypting memos..."}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Payments List */}
                        {payments.length > 0 && (
                            <div className="space-y-4 stagger">
                                <div className="flex items-center justify-between mb-2">
                                    <h2 className="text-xl font-bold">
                                        Your Payments
                                    </h2>
                                    <span className="badge badge-primary badge-outline">
                                        {payments.length}
                                    </span>
                                </div>
                                {payments.map((payment, idx) => (
                                    <div
                                        key={payment.commitment}
                                        className="glass-card rounded-2xl animate-fade-in"
                                    >
                                        <div className="p-5">
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <p className="text-xs font-semibold opacity-40 mb-1">Amount</p>
                                                    <p className="text-2xl font-bold">
                                                        {(
                                                            Number(payment.amount) / 1e18
                                                        ).toFixed(6)}{" "}
                                                        <span className="text-sm font-normal opacity-50">tokens</span>
                                                    </p>
                                                </div>
                                                <button
                                                    className="btn btn-primary"
                                                    onClick={() => handleClaim(payment, idx)}
                                                    disabled={claimingIdx === idx}
                                                >
                                                    {claimingIdx === idx && (
                                                        <span className="loading loading-spinner loading-sm" />
                                                    )}
                                                    {claimingIdx === idx ? "Claiming..." : "Claim"}
                                                </button>
                                            </div>
                                            <div className="divider-gradient my-3" />
                                            <div className="grid grid-cols-1 gap-2">
                                                <div>
                                                    <p className="text-xs font-semibold opacity-40 mb-0.5">Commitment</p>
                                                    <p className="text-xs font-mono break-all opacity-60">
                                                        {payment.commitment}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold opacity-40 mb-0.5">Token</p>
                                                    <p className="text-xs font-mono break-all opacity-60">
                                                        {payment.token}
                                                    </p>
                                                </div>
                                                {payment.memo && (
                                                    <div className="col-span-1">
                                                        <p className="text-xs font-semibold opacity-40 mb-0.5 flex items-center gap-1">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                                            </svg>
                                                            Encrypted Memo (from IPFS)
                                                        </p>
                                                        <div className="bg-base-300/40 rounded-lg p-2.5 mt-1">
                                                            <p className="text-sm opacity-80">
                                                                {payment.memo}
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {scanDone && payments.length === 0 && (
                            <div className="flex items-center gap-3 bg-base-300/20 rounded-xl p-4">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-sm opacity-50">No stealth payments found for your viewing key.</span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default ReceivePage;
