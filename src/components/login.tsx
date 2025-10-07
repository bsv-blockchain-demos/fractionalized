"use client";

import { useState, useCallback } from "react";
import { useAuthContext } from "../context/walletContext";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export function Login() {
    const [loading, setLoading] = useState(false);
    const { initializeWallet, checkAuth, userPubKey } = useAuthContext();
    const router = useRouter();

    const handleLogin = useCallback(async () => {
        try {
            setLoading(true);

            // Ensure wallet is initialized and authenticated
            await initializeWallet();
            const isAuth = await checkAuth();
            if (!isAuth) {
                toast.error("Please authenticate your wallet first", {
                    duration: 4000,
                    position: "top-center",
                    id: "wallet-auth-error",
                });
                return;
            }

            if (!userPubKey) {
                toast.error("Missing public key from wallet", {
                    duration: 4000,
                    position: "top-center",
                    id: "pubkey-missing",
                });
                return;
            }

            // Ask server to set JWT cookie
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ request: "login", userPubKey }),
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
            console.error(e);
            toast.error("Unexpected error during login", {
                duration: 4000,
                position: "top-center",
                id: "login-error",
            });
        } finally {
            setLoading(false);
        }
    }, [initializeWallet, checkAuth, userPubKey, router]);

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