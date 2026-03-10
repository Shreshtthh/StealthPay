"use client";

import { useState, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import {
    useStealthReadContract,
    useStealthContractInfo,
} from "~~/hooks/stealth/useStealthContracts";
import { useTransactor } from "~~/hooks/scaffold-stark";
import { computeStealthAddress } from "~~/utils/stealth/crypto";
import type { Point } from "~~/utils/stealth/types";
import { Contract as StarknetJsContract } from "starknet";

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
    const [txStatus, setTxStatus] = useState<
        "idle" | "computing" | "sending" | "done" | "error"
    >("idle");
    const [errorMsg, setErrorMsg] = useState("");

    // Look up recipient's meta-address from registry
    const { data: metaAddress } = useStealthReadContract({
        contractName: "StealthRegistry",
        functionName: "get_meta_address",
        args: [recipientAddress || "0x0"],
        enabled: !!recipientAddress,
    });

    const { data: recipientRegistered } = useStealthReadContract({
        contractName: "StealthRegistry",
        functionName: "is_registered",
        args: [recipientAddress || "0x0"],
        enabled: !!recipientAddress,
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

            // Build StealthPay.send call
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
            ]);

            // Execute both calls as a single multicall transaction
            await sendTxnWrapper([approveCall, sendCall] as any[]);

            setTxStatus("done");
        } catch (e: any) {
            console.error("Send failed:", e);
            setErrorMsg(e.message || "Transaction failed");
            setTxStatus("error");
        }
    };

    if (status !== "connected") {
        return (
            <div className="flex items-center flex-col grow pt-10">
                <div className="px-5 text-center">
                    <h1 className="text-4xl font-bold mb-4">📤 Send</h1>
                    <p className="text-lg opacity-70">
                        Connect your wallet to send a private payment.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center flex-col grow pt-10">
            <div className="px-5 w-full max-w-2xl">
                <h1 className="text-4xl font-bold text-center mb-8">
                    📤 Send Private Payment
                </h1>

                <div className="card bg-base-100 shadow-xl border border-gradient">
                    <div className="card-body">
                        {/* Recipient Address */}
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text font-semibold">
                                    Recipient Starknet Address
                                </span>
                            </label>
                            <input
                                type="text"
                                placeholder="0x..."
                                className="input input-bordered w-full font-mono text-sm"
                                value={recipientAddress}
                                onChange={(e) => setRecipientAddress(e.target.value)}
                            />
                            {recipientAddress && recipientRegistered !== undefined && (
                                <label className="label">
                                    <span
                                        className={`label-text-alt ${recipientRegistered ? "text-success" : "text-error"}`}
                                    >
                                        {recipientRegistered
                                            ? "✓ Recipient is registered"
                                            : "✗ Recipient not registered — they need to register first"}
                                    </span>
                                </label>
                            )}
                        </div>

                        {/* Token Selection */}
                        <div className="form-control mt-2">
                            <label className="label">
                                <span className="label-text font-semibold">Token</span>
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
                        <div className="form-control mt-2">
                            <label className="label">
                                <span className="label-text font-semibold">Amount</span>
                            </label>
                            <input
                                type="number"
                                placeholder="0.0"
                                step="0.001"
                                className="input input-bordered w-full"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                            />
                        </div>

                        {/* Important note about approval */}
                        <div className="alert alert-info mt-4">
                            <span className="text-sm">
                                💡 The transaction will automatically approve the StealthPay contract
                                to spend your {selectedToken} tokens and send the payment in a single
                                multicall.
                            </span>
                        </div>

                        {/* Status Messages */}
                        {txStatus === "done" && (
                            <div className="alert alert-success mt-4">
                                <span>
                                    ✅ Payment sent privately! No link between you and the
                                    recipient is visible on-chain.
                                </span>
                            </div>
                        )}
                        {txStatus === "error" && (
                            <div className="alert alert-error mt-4">
                                <span>❌ {errorMsg}</span>
                            </div>
                        )}

                        {/* Send Button */}
                        <div className="card-actions justify-end mt-4">
                            <button
                                className="btn btn-primary btn-lg"
                                onClick={handleSend}
                                disabled={
                                    !recipientAddress ||
                                    !amount ||
                                    !recipientRegistered ||
                                    txStatus === "computing" ||
                                    txStatus === "sending"
                                }
                            >
                                {txStatus === "computing"
                                    ? "Computing stealth address..."
                                    : txStatus === "sending"
                                        ? "Sending..."
                                        : "Send Privately"}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="text-center mt-6 opacity-50 text-sm">
                    <p>
                        The stealth address is computed client-side. Only the commitment
                        appears on-chain.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SendPage;
