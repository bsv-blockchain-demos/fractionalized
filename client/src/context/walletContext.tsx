import { WalletClient } from '@bsv/sdk'
import { useContext, createContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { toast } from "react-hot-toast";
import { apiFetch } from '@/lib/apiFetch';

/** Session state, not wallet state: `isAuthenticated` below tracks the wallet, this tracks the cookie. */
export type AuthStatus = 'restoring' | 'idle' | 'authenticated';

type authContextType = {
    userWallet: WalletClient;
    userPubKey: string | null;
    ensureWallet: (silent?: boolean) => Promise<string | null>;
    initializeWallet: () => Promise<void>;
    setIsAuthenticated: (value: boolean) => void;
    isAuthenticated: boolean;
    checkAuth: () => Promise<boolean>;
    logout: () => void;
    status: AuthStatus;
    markAuthenticated: () => void;
}

const AuthContext = createContext<authContextType>({
    userWallet: new WalletClient(),
    userPubKey: null,
    ensureWallet: async () => null,
    initializeWallet: async () => { },
    setIsAuthenticated: () => { },
    isAuthenticated: false,
    checkAuth: async () => false,
    logout: () => { },
    status: 'restoring',
    markAuthenticated: () => { },
});

export const AuthContextProvider = ({ children }: { children: React.ReactNode }) => {
    const [userWallet] = useState<WalletClient>(() => new WalletClient());
    const [userPubKey, setUserPubKey] = useState<string | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [status, setStatus] = useState<AuthStatus>('restoring');
    const initPromiseRef = useRef<Promise<string | null> | null>(null);

    // The `verified` cookie is httpOnly, so only the server can answer. Start 'restoring' so
    // ProtectedRoute doesn't flash-redirect before the answer arrives; a rejected check must
    // land on 'idle' or that loading gate hangs forever. check-session is always 200, so this
    // never trips apiFetch's 401 redirect.
    useEffect(() => {
        let cancelled = false;
        apiFetch('/api/check-session')
            .then((res) => res.json())
            .then((data: { authenticated?: boolean }) => { if (!cancelled) setStatus(data.authenticated ? 'authenticated' : 'idle'); })
            .catch(() => { if (!cancelled) setStatus('idle'); });
        return () => { cancelled = true; };
    }, []);

    const markAuthenticated = useCallback(() => setStatus('authenticated'), []);

    const checkAuth = useCallback(async (): Promise<boolean> => {
        const { authenticated } = await userWallet.isAuthenticated();
        setIsAuthenticated(authenticated || false);
        return authenticated || false;
    }, [userWallet]);

    // Returns the identity pubkey, or null (fails closed) if the wallet is absent/locked.
    // Use the return value, not the context userPubKey (stale until re-render). `silent` mutes toasts.
    const ensureWallet = useCallback((silent: boolean = false): Promise<string | null> => {
        if (userPubKey) return Promise.resolve(userPubKey);
        if (!initPromiseRef.current) {
            const p = (async (): Promise<string | null> => {
                try {
                    const { authenticated } = await userWallet.isAuthenticated();
                    if (!authenticated) {
                        if (!silent) { toast.error('Wallet not authenticated', { duration: 5000, position: 'top-center', id: 'wallet-not-authenticated' }); }
                        return null;
                    }
                    const { publicKey } = await userWallet.getPublicKey({ identityKey: true });
                    setUserPubKey(publicKey);
                    setIsAuthenticated(true);
                    if (!silent) { toast.success('Wallet connected successfully', { duration: 5000, position: 'top-center', id: 'wallet-connect-success' }); }
                    return publicKey;
                } catch {
                    if (!silent) { toast.error('Failed to connect wallet', { duration: 5000, position: 'top-center', id: 'wallet-connect-error' }); }
                    return null;
                }
            })();
            // Dedupe concurrent calls; drop the cache on failure so callers can retry.
            initPromiseRef.current = p;
            p.then((pk) => { if (!pk) initPromiseRef.current = null; }).catch(() => { initPromiseRef.current = null; });
        }
        return initPromiseRef.current;
    }, [userWallet, userPubKey]);

    // Back-compat wrapper for the Login button.
    const initializeWallet = useCallback(async (): Promise<void> => {
        await ensureWallet();
    }, [ensureWallet]);

    const logout = useCallback(() => {
        setUserPubKey(null);
        setIsAuthenticated(false);
        setStatus('idle');
        initPromiseRef.current = null;
    }, []);

    const value = useMemo(() => ({
        userWallet, userPubKey, ensureWallet, initializeWallet, isAuthenticated, setIsAuthenticated, checkAuth, logout,
        status, markAuthenticated,
    }), [userWallet, userPubKey, ensureWallet, initializeWallet, isAuthenticated, checkAuth, logout, status, markAuthenticated]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuthContext = () => useContext(AuthContext);
