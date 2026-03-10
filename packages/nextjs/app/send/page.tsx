"use client";

import { useState, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import {
    useStealthReadContract,
    useStealthContractInfo,
} from "~~/hooks/stealth/useStealthContracts";
import { useTransactor } from "~~/hooks/scaffold-stark";
import { computeStealthAddress } from "~~/utils/stealth/crypto";
import { encryptAndUploadMemo } from "~~/utils/stealth/ipfs";
import type { Point } from "~~/utils/stealth/types";
import { Contract as StarknetJsContract } from "starknet";
import { notification } from "~~/utils/scaffold-stark";

// Well-known token addresses on Sepolia
const TOKENS = {
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
};

// Minimal ERC20 ABI for the approve call
const ERC20_APPROVE_ABI = [
    {
        type: "function",
        name: "approve",
        inputs: [
            { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
            { name: "amount", type: "core::integer::u256" },
        ],
        outputs: [{ type: "core::bool" }],
        state_mutability: "external",
    },
] as const;

const SendPage = () => {
    const { address, status } = useAccount();
    const [recipientAddress, setRecipientAddress] = useState("");
    const [amount, setAmount] = useState("");
    const [selectedToken, setSelectedToken] = useState<"STRK" | "ETH">("STRK");
    const [memo, setMemo] = useState("");
    const [txStatus, setTxStatus] = useState<
        "idle" | "computing" | "uploading" | "sending" | "done" | "error"
    >("idle");
    const [errorMsg, setErrorMsg] = useState("");

    // Validate recipient address format (basic hex check)
    const isValidAddress = /^0x[0-9a-fA-F]{1,64}$/.test(recipientAddress);

    // Look up recipient's meta-address from registry
    const { data: metaAddress } = useStealthReadContract({
        contractName: "StealthRegistry",
        functionName: "get_meta_address",
        args: [isValidAddress ? recipientAddress : "0x0"],
        enabled: isValidAddress,
    });

    const { data: recipientRegistered } = useStealthReadContract({
        contractName: "StealthRegistry",
        functionName: "is_registered",
        args: [isValidAddress ? recipientAddress : "0x0"],
        enabled: isValidAddress,
    });

    // Get StealthPay contract info for building multicall
    const { data: stealthPayData } = useStealthContractInfo("StealthPay");
    const { writeTransaction: sendTxnWrapper } = useTransactor();

    const handleSend = async () => {
        if (!recipientAddress || !amount || !metaAddress || !stealthPayData) return;

        setTxStatus("computing");
        setErrorMsg("");

        try {
            // Parse the meta-address (spend_pub_x, view_pub_x) from contract
            const spendPubX = (metaAddress as any)?.["0"] ?? (metaAddress as any)?.spend_pub_x ?? "0x0";
            const viewPubX = (metaAddress as any)?.["1"] ?? (metaAddress as any)?.view_pub_x ?? "0x0";

            const recipientSpendPub: Point = { x: spendPubX.toString(), y: "0x0" };
            const recipientViewPub: Point = { x: viewPubX.toString(), y: "0x0" };

            // Compute stealth address client-side
            const stealth = computeStealthAddress(
                recipientSpendPub,
                recipientViewPub,
            );

            const tokenAddress = TOKENS[selectedToken];
            const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18));

            // If a memo is provided, encrypt and upload to IPFS
            let ipfsCidFelt = "0x0";
            if (memo.trim()) {
                setTxStatus("uploading");
                try {
                    const { cidFelt } = await encryptAndUploadMemo(
                        memo.trim(),
                        stealth.sharedSecretX
                    );
                    ipfsCidFelt = cidFelt;
                } catch (e) {
                    console.error("IPFS upload failed:", e);
                    // Continue without memo — don't block the payment
                }
            }

            setTxStatus("sending");

            // Build ERC20 approve call
            const tokenContract = new StarknetJsContract({
                abi: ERC20_APPROVE_ABI as any,
                address: tokenAddress,
            });
            const approveCall = tokenContract.populate("approve", [
                stealthPayData.address,
                amountWei,
            ]);

            // Build StealthPay.send call (now with ipfs_cid)
            const stealthPayContract = new StarknetJsContract({
                abi: stealthPayData.abi,
                address: stealthPayData.address,
            });
            const sendCall = stealthPayContract.populate("send", [
                stealth.stealthCommitment,
                stealth.ephemeralPubKey.x,
                stealth.ephemeralPubKey.y,
                stealth.viewTag,
                tokenAddress,
                amountWei,
                ipfsCidFelt,
            ]);

            // Execute both calls as a single multicall transaction
            await sendTxnWrapper([approveCall, sendCall] as any[]);

            setTxStatus("done");
        } catch (e: any) {
            console.error("Send failed:", e);
            // Handle user rejecting the transaction in their wallet
            if (e.message && (e.message.includes("User rejected") || e.message.includes("User abort"))) {
                notification.info("Transaction cancelled");
                setTxStatus("idle");
                return;
            }
            setErrorMsg(e.message || "Transaction failed");
            setTxStatus("error");
        }
    };

    if (status !== "connected") {
        return (
            <div className="flex items-center flex-col grow pt-10 animate-fade-in">
                <div className="px-5 text-center max-w-md">
                    <h1 className="text-4xl font-bold mb-4 text-gradient">Send</h1>
                    <p className="text-base opacity-60">
                        Connect your wallet to send a private payment.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center flex-col grow pt-10 animate-fade-in">
            <div className="px-5 w-full max-w-2xl">
                <p className="text-sm font-semibold tracking-widest uppercase opacity-50 text-center mb-2">
                    Private Transfer
                </p>
                <h1 className="text-4xl font-bold text-center mb-8 text-gradient">
                    Send Payment
                </h1>

                <div className="glass-card rounded-2xl">
                    <div className="p-6 space-y-5">
                        {/* Recipient Address */}
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text font-semibold text-sm">
                                    Recipient Address
                                </span>
                            </label>
                            <div className="input-glow rounded-lg">
                                <input
                                    type="text"
                                    placeholder="0x..."
                                    className="input input-bordered w-full font-mono text-sm"
                                    value={recipientAddress}
                                    onChange={(e) => setRecipientAddress(e.target.value)}
                                />
                            </div>
                            {recipientAddress && !isValidAddress && (
                                <label className="label pb-0">
                                    <span className="label-text-alt flex items-center gap-1.5 text-error">
                                        <span className="status-dot status-dot-error" />
                                        Invalid Starknet address format
                                    </span>
                                </label>
                            )}
                            {recipientAddress && isValidAddress && recipientRegistered !== undefined && (
                                <label className="label pb-0">
                                    <span className={`label-text-alt flex items-center gap-1.5 ${recipientRegistered ? "text-success" : "text-error"}`}>
                                        <span className={`status-dot ${recipientRegistered ? "status-dot-success" : "status-dot-error"}`} />
                                        {recipientRegistered
                                            ? "Recipient is registered"
                                            : "Recipient not registered. They need to register first."}
                                    </span>
                                </label>
                            )}
                        </div>

                        {/* Token Selection */}
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text font-semibold text-sm">Token</span>
                            </label>
                            <select
                                className="select select-bordered w-full"
                                value={selectedToken}
                                onChange={(e) =>
                                    setSelectedToken(e.target.value as "STRK" | "ETH")
                                }
                            >
                                <option value="STRK">STRK</option>
                                <option value="ETH">ETH</option>
                            </select>
                        </div>

                        {/* Amount */}
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text font-semibold text-sm">Amount</span>
                            </label>
                            <div className="input-glow rounded-lg">
                                <input
                                    type="number"
                                    placeholder="0.0"
                                    step="0.001"
                                    className="input input-bordered w-full"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Memo (Optional) */}
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text font-semibold text-sm">
                                    Memo <span className="font-normal opacity-40">(optional, encrypted via IPFS)</span>
                                </span>
                            </label>
                            <div className="input-glow rounded-lg">
                                <textarea
                                    placeholder="Add a private note to the recipient..."
                                    className="textarea textarea-bordered w-full text-sm"
                                    rows={3}
                                    value={memo}
                                    onChange={(e) => setMemo(e.target.value)}
                                />
                            </div>
                            {memo.trim() && (
                                <label className="label pb-0">
                                    <span className="label-text-alt flex items-center gap-1.5 text-info">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                        </svg>
                                        Encrypted with shared secret &amp; stored on IPFS (Pinata)
                                    </span>
                                </label>
                            )}
                        </div>

                        <div className="divider-gradient" />

                        {/* Info note */}
                        <div className="flex items-start gap-3 bg-base-300/30 rounded-xl p-4">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-50 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-sm opacity-60">
                                This transaction will approve the StealthPay contract
                                to spend your {selectedToken} tokens and send the payment in a single
                                multicall.
                            </span>
                        </div>

                        {/* Status Messages */}
                        {txStatus === "done" && (
                            <div className="alert alert-success">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-sm">
                                    Payment sent privately. No link between you and the
                                    recipient is visible on-chain.
                                </span>
                            </div>
                        )}
                        {txStatus === "error" && (
                            <div className="alert alert-error">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-sm">{errorMsg}</span>
                            </div>
                        )}

                        {/* Send Button */}
                        <div className="flex justify-end pt-2">
                            <button
                                className="btn btn-primary btn-lg px-8"
                                onClick={handleSend}
                                disabled={
                                    !recipientAddress ||
                                    !isValidAddress ||
                                    !amount ||
                                    !recipientRegistered ||
                                    txStatus === "computing" ||
                                    txStatus === "uploading" ||
                                    txStatus === "sending"
                                }
                            >
                                {txStatus === "computing" && (
                                    <span className="loading loading-spinner loading-sm" />
                                )}
                                {txStatus === "computing"
                                    ? "Computing stealth address..."
                                    : txStatus === "uploading"
                                        ? "Uploading encrypted memo..."
                                        : txStatus === "sending"
                                            ? "Sending..."
                                            : "Send Privately"}
                            </button>
                        </div>
                    </div>
                </div>

                <p className="text-center mt-6 opacity-35 text-xs">
                    The stealth address is computed client-side. Only the commitment
                    appears on-chain.
                </p>
            </div>
        </div>
    );
};

export default SendPage;
