/**
 * Lightweight wrappers around scaffold hooks that bypass the strict
 * ContractName generic.  These exist because the scaffold type-generator
 * sometimes caches stale contract names; the runtime lookup still works
 * perfectly — only the compile-time constraint fails.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useProvider, useAccount } from "@starknet-react/core";
import { useTargetNetwork } from "~~/hooks/scaffold-stark/useTargetNetwork";
import { useTransactor } from "~~/hooks/scaffold-stark";
import { contracts } from "~~/utils/scaffold-stark/contract";
import { Contract as StarknetJsContract, RpcProvider, BlockIdentifier } from "starknet";
import { getRpcUrl } from "~~/services/web3/provider";

/* ------------------------------------------------------------------ */
/*  useStealthContractInfo — resolves address + abi at runtime         */
/* ------------------------------------------------------------------ */

export function useStealthContractInfo(contractName: string) {
    const { targetNetwork } = useTargetNetwork();
    const data = (contracts as any)?.[targetNetwork.network]?.[contractName];
    return { data: data ?? undefined, isLoading: false };
}

/* ------------------------------------------------------------------ */
/*  useStealthReadContract — call a view function                     */
/* ------------------------------------------------------------------ */

export function useStealthReadContract({
    contractName,
    functionName,
    args,
    enabled = true,
}: {
    contractName: string;
    functionName: string;
    args?: any[];
    enabled?: boolean;
}) {
    const { data: contractData } = useStealthContractInfo(contractName);
    const { targetNetwork } = useTargetNetwork();
    const [data, setData] = useState<any>(undefined);
    const [isLoading, setIsLoading] = useState(false);
    const [fetchCount, setFetchCount] = useState(0);

    // Track args changes via ref to avoid infinite loops
    const prevArgsRef = useRef<string>("");
    const argsStr = JSON.stringify(args ?? []);
    if (prevArgsRef.current !== argsStr) {
        prevArgsRef.current = argsStr;
    }

    const publicClient = useMemo(() => {
        return new RpcProvider({
            nodeUrl: getRpcUrl(targetNetwork.network),
        });
    }, [targetNetwork.network]);

    // Only refetch when args actually change
    useEffect(() => {
        setFetchCount((c) => c + 1);
    }, [argsStr]);

    useEffect(() => {
        if (!contractData || !enabled) return;
        const currentArgs = args ?? [];
        if (currentArgs.some((a: any) => a === undefined)) return;

        let cancelled = false;
        setIsLoading(true);

        const contract = new StarknetJsContract({
            abi: contractData.abi,
            address: contractData.address,
            providerOrAccount: publicClient as any,
        });

        contract[functionName](...currentArgs)
            .then((result: any) => {
                if (!cancelled) setData(result);
            })
            .catch((err: any) => {
                if (!cancelled) console.error(`Read ${functionName} failed:`, err);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contractData, functionName, fetchCount, enabled, publicClient]);

    return { data, isLoading };
}

/* ------------------------------------------------------------------ */
/*  useStealthWriteContract — send an external transaction            */
/* ------------------------------------------------------------------ */

export function useStealthWriteContract({
    contractName,
    functionName,
}: {
    contractName: string;
    functionName: string;
    args?: any[];
}) {
    const { data: contractData } = useStealthContractInfo(contractName);
    const { writeTransaction: sendTxnWrapper } = useTransactor();
    const [isPending, setIsPending] = useState(false);

    const sendAsync = useCallback(
        async (params?: { args?: any[] }) => {
            if (!contractData) {
                console.error("Contract not deployed:", contractName);
                return;
            }

            const contract = new StarknetJsContract({
                abi: contractData.abi,
                address: contractData.address,
            });

            const calls = [contract.populate(functionName, params?.args ?? [])];

            setIsPending(true);
            try {
                return await sendTxnWrapper(calls as any[]);
            } finally {
                setIsPending(false);
            }
        },
        [contractData, functionName, sendTxnWrapper, contractName],
    );

    return { sendAsync, isPending };
}
