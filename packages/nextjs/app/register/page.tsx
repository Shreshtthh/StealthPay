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
            <div className="flex items-center flex-col grow pt-10">
                <div className="px-5 text-center">
                    <h1 className="text-4xl font-bold mb-4">🔐 Register</h1>
                    <p className="text-lg opacity-70">
                        Connect your wallet to register your stealth meta-address.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center flex-col grow pt-10">
            <div className="px-5 w-full max-w-2xl">
                <h1 className="text-4xl font-bold text-center mb-8">
                    🔐 Register Stealth Meta-Address
                </h1>

                {/* Step 1: Generate Keys */}
                <div className="card bg-base-100 shadow-xl mb-6 border border-gradient">
                    <div className="card-body">
                        <h2 className="card-title">
                            Step 1: Generate Keys
                            {keys ? (
                                <span className="badge badge-success">✓ Generated</span>
                            ) : null}
                        </h2>
                        <p className="opacity-70 text-sm">
                            Generate your spending and viewing keypairs. These are stored
                            locally in your browser.
                        </p>

                        {keys ? (
                            <div className="mt-4 space-y-2">
                                <div className="bg-base-200 rounded-lg p-3">
                                    <p className="text-xs font-semibold opacity-50">
                                        Spending Public Key (x)
                                    </p>
                                    <p className="text-xs font-mono break-all">
                                        {keys.spendingPubKey.x}
                                    </p>
                                </div>
                                <div className="bg-base-200 rounded-lg p-3">
                                    <p className="text-xs font-semibold opacity-50">
                                        Viewing Public Key (x)
                                    </p>
                                    <p className="text-xs font-mono break-all">
                                        {keys.viewingPubKey.x}
                                    </p>
                                </div>
                            </div>
                        ) : null}

                        <div className="card-actions justify-end mt-4">
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
                <div className="card bg-base-100 shadow-xl border border-gradient">
                    <div className="card-body">
                        <h2 className="card-title">
                            Step 2: Register on Starknet
                            {isRegistered ? (
                                <span className="badge badge-success">✓ Registered</span>
                            ) : null}
                        </h2>
                        <p className="opacity-70 text-sm">
                            Publish your public keys to the on-chain registry so senders can
                            look up your stealth meta-address.
                        </p>

                        {isRegistered ? (
                            <div className="alert alert-success mt-4">
                                <span>
                                    Your meta-address is registered! Others can now send you
                                    private payments.
                                </span>
                            </div>
                        ) : null}

                        <div className="card-actions justify-end mt-4">
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

                {/* Security Note */}
                <div className="alert alert-warning mt-6">
                    <span className="text-sm">
                        ⚠️ <strong>Testnet Demo:</strong> Keys are stored in localStorage
                        for this demo. In production, keys should be derived from your wallet
                        or encrypted.
                    </span>
                </div>
            </div>
        </div>
    );
};

export default RegisterPage;
