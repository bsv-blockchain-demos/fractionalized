"use client";

import { useState, useCallback } from "react";
import { useAuthContext } from "../context/walletContext";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export function Login() {
    console.log('Login component: Mounting');
    const [loading, setLoading] = useState(false);
    const { initializeWallet, checkAuth, userPubKey } = useAuthContext();
    console.log('Login component: Hooks initialized, userPubKey:', userPubKey);
    const router = useRouter();

    const handleLogin = useCallback(async () => {
        console.log('handleLogin: Starting login process');
        try {
            setLoading(true);
            console.log('handleLogin: Loading set to true');

            // Ensure wallet is initialized and authenticated
            console.log('handleLogin: Calling initializeWallet');
            await initializeWallet();
            console.log('handleLogin: initializeWallet completed');
            const isAuth = await checkAuth();
            console.log('handleLogin: checkAuth result:', isAuth);
            if (!isAuth) {
                toast.error("Please authenticate your wallet first", {
                    duration: 4000,
                    position: "top-center",
                    id: "wallet-auth-error",
                });
                return;
            }

            if (!userPubKey) {
                console.log('handleLogin: userPubKey is missing');
                toast.error("Missing public key from wallet", {
                    duration: 4000,
                    position: "top-center",
                    id: "pubkey-missing",
                });
                return;
            }
            console.log('handleLogin: userPubKey found:', userPubKey);

            // Ask server to set JWT cookie
            console.log('handleLogin: Making fetch request to /api/auth/login with userPubKey:', userPubKey);
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ request: "login", userPubKey }),
            });
            console.log('handleLogin: Fetch response status:', res.status);
            const data = await res.json().catch(() => ({}));
            console.log('handleLogin: Fetch response data:', data);
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
            console.log('handleLogin: Login successful, navigating to /');
            router.replace("/");
        } catch (e) {
            console.error('handleLogin: Unexpected error during login:', e);
            toast.error("Unexpected error during login", {
                duration: 4000,
                position: "top-center",
                id: "login-error",
            });
        } finally {
            console.log('handleLogin: Setting loading to false');
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