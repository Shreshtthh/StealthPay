"use client";

import { useState } from "react";
import { useAccount } from "@starknet-react/core";
import {
    useStealthReadContract,
    useStealthWriteContract,
} from "~~/hooks/stealth/useStealthContracts";
import {
    generateKeyPairs,
    saveKeys,
    loadKeys,
    type StoredKeys,
} from "~~/utils/stealth/crypto";

const RegisterPage = () => {
    const { address, status } = useAccount();
    const [keys, setKeys] = useState<StoredKeys | null>(loadKeys());
    const [isGenerating, setIsGenerating] = useState(false);

    // Read current registration status
    const { data: isRegistered } = useStealthReadContract({
        contractName: "StealthRegistry",
        functionName: "is_registered",
        args: [address ?? "0x0"],
        enabled: status === "connected",
    });

    // Write hook for register
    const { sendAsync: registerOnChain, isPending: isRegistering } =
        useStealthWriteContract({
            contractName: "StealthRegistry",
            functionName: "register",
        });

    const handleGenerateKeys = () => {
        setIsGenerating(true);
        try {
            const { spendingKey, viewingKey } = generateKeyPairs();
            const newKeys: StoredKeys = {
                spendingPrivKey: spendingKey.privateKey,
                spendingPubKey: spendingKey.publicKey,
                viewingPrivKey: viewingKey.privateKey,
                viewingPubKey: viewingKey.publicKey,
            };
            saveKeys(newKeys);
            setKeys(newKeys);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRegister = async () => {
        if (!keys) return;
        try {
            await registerOnChain({
                args: [keys.spendingPubKey.x, keys.viewingPubKey.x],
            });
        } catch (e) {
            console.error("Registration failed:", e);
        }
    };

    if (status !== "connected") {
        return (
            <div className="flex items-center flex-col grow pt-10 animate-fade-in">
                <div className="px-5 text-center max-w-md">
                    <h1 className="text-4xl font-bold mb-4 text-gradient">Register</h1>
                    <p className="text-base opacity-60">
                        Connect your wallet to register your stealth meta-address.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center flex-col grow pt-10 animate-fade-in">
            <div className="px-5 w-full max-w-2xl">
                <p className="text-sm font-semibold tracking-widest uppercase opacity-50 text-center mb-2">
                    One-time Setup
                </p>
                <h1 className="text-4xl font-bold text-center mb-8 text-gradient">
                    Register Stealth Meta-Address
                </h1>

                {/* Step 1: Generate Keys */}
                <div className="glass-card rounded-2xl mb-6">
                    <div className="p-6">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="step-circle">1</div>
                            <h2 className="text-lg font-bold">Generate Keys</h2>
                            {keys && (
                                <span className="badge badge-success badge-sm ml-auto">
                                    <span className="status-dot status-dot-success mr-1.5" />
                                    Generated
                                </span>
                            )}
                        </div>
                        <p className="opacity-60 text-sm ml-[calc(2.5rem+0.75rem)]">
                            Generate your spending and viewing keypairs. These are stored
                            locally in your browser.
                        </p>

                        {keys && (
                            <div className="mt-4 space-y-2 ml-[calc(2.5rem+0.75rem)]">
                                <div className="bg-base-300/50 rounded-lg p-3">
                                    <p className="text-xs font-semibold opacity-40 mb-1">
                                        Spending Public Key (x)
                                    </p>
                                    <p className="text-xs font-mono break-all opacity-80">
                                        {keys.spendingPubKey.x}
                                    </p>
                                </div>
                                <div className="bg-base-300/50 rounded-lg p-3">
                                    <p className="text-xs font-semibold opacity-40 mb-1">
                                        Viewing Public Key (x)
                                    </p>
                                    <p className="text-xs font-mono break-all opacity-80">
                                        {keys.viewingPubKey.x}
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end mt-4">
                            <button
                                className="btn btn-primary"
                                onClick={handleGenerateKeys}
                                disabled={isGenerating}
                            >
                                {isGenerating
                                    ? "Generating..."
                                    : keys
                                        ? "Regenerate Keys"
                                        : "Generate Keys"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Step 2: Register On-Chain */}
                <div className="glass-card rounded-2xl">
                    <div className="p-6">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="step-circle">2</div>
                            <h2 className="text-lg font-bold">Register on Starknet</h2>
                            {isRegistered && (
                                <span className="badge badge-success badge-sm ml-auto">
                                    <span className="status-dot status-dot-success mr-1.5" />
                                    Registered
                                </span>
                            )}
                        </div>
                        <p className="opacity-60 text-sm ml-[calc(2.5rem+0.75rem)]">
                            Publish your public keys to the on-chain registry so senders can
                            look up your stealth meta-address.
                        </p>

                        {isRegistered && (
                            <div className="alert alert-success mt-4 ml-[calc(2.5rem+0.75rem)]">
                                <span className="text-sm">
                                    Your meta-address is registered. Others can now send you
                                    private payments.
                                </span>
                            </div>
                        )}

                        <div className="flex justify-end mt-4">
                            <button
                                className="btn btn-primary"
                                onClick={handleRegister}
                                disabled={!keys || isRegistering}
                            >
                                {isRegistering
                                    ? "Registering..."
                                    : isRegistered
                                        ? "Update Registration"
                                        : "Register on Starknet"}
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default RegisterPage;
