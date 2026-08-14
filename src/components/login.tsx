"use client";

import { useState, useCallback } from "react";
import { useAuthContext } from "../context/walletContext";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { authClient } from "@shared/authProof";
import { apiFetch } from "../utils/apiFetch";
import { logger } from "@shared/logger";

export function Login() {
    const [loading, setLoading] = useState(false);
    const { ensureWallet, userWallet } = useAuthContext();
    const router = useRouter();

    const handleLogin = useCallback(async () => {
        try {
            setLoading(true);

            const walletIdentityKey = await ensureWallet(); // identity pubkey, or null when absent/locked
            if (!walletIdentityKey) return; // ensureWallet already toasted

            // Signed, expiry-bound, single-use proof that the user controls the wallet private key
            const SERVER_IDENTITY = process.env.NEXT_PUBLIC_SERVER_IDENTITY_KEY!;
            const proof = await authClient.createAuthProof(userWallet, SERVER_IDENTITY, 'login');

            // Ask server to set JWT cookie. Not fetchWithAuthProof — the proof is built above.
            const res = await apiFetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ request: "login", userPubKey: walletIdentityKey, proof, walletIdentityKey }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data?.message || "Login failed", {
                    duration: 4000,
                    position: "top-center",
                    id: "login-failed",
                });
                return;
            }

            toast.success("Logged in", {
                duration: 3000,
                position: "top-center",
                id: "login-success",
            });

            // Navigate away from /login; middleware will allow since cookie set
            router.replace("/");
        } catch (e) {
            logger.error('handleLogin: Unexpected error during login:', e);
            toast.error("Unexpected error during login", {
                duration: 4000,
                position: "top-center",
                id: "login-error",
            });
        } finally {
            setLoading(false);
        }
    }, [ensureWallet, userWallet, router]);

    return (
        <div className="container mx-auto px-4 py-12">
            <div className="max-w-md mx-auto card-glass bg-bg-secondary border border-border-subtle rounded-xl p-6">
                <h1 className="text-2xl font-semibold text-text-primary mb-4">Login</h1>
                <p className="text-text-secondary text-sm mb-6">
                    Connect and authenticate your wallet to continue.
                </p>
                <button
                    type="button"
                    onClick={handleLogin}
                    disabled={loading}
                    className="inline-flex items-center justify-center w-full gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-white text-sm btn-glow disabled:opacity-60"
                    aria-busy={loading}
                >
                    {loading ? "Checking wallet…" : "Login with Wallet"}
                </button>
            </div>
        </div>
    );
}