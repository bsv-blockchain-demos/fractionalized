"use client"

import {
    WalletClient,
} from '@bsv/sdk'
import { useContext, createContext, useState, useEffect, useCallback } from "react";
import { toast } from "react-hot-toast";

type authContextType = {
    userWallet: WalletClient;
    userPubKey: string | null;
    initializeWallet: () => Promise<void>;
    setIsAuthenticated: (value: boolean) => void;
    isAuthenticated: boolean;
    checkAuth: () => Promise<boolean>;
    logout: () => void;
}

const AuthContext = createContext<authContextType>({
    userWallet: new WalletClient(),
    userPubKey: null,
    initializeWallet: async () => { },
    setIsAuthenticated: () => { },
    isAuthenticated: false,
    checkAuth: async () => { return false; },
    logout: () => { },
});
export const AuthContextProvider = ({ children }: { children: React.ReactNode }) => {
    const [userWallet, setUserWallet] = useState<authContextType['userWallet']>(new WalletClient());
    const [userPubKey, setUserPubKey] = useState<authContextType['userPubKey']>(null);
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

    const checkAuth = useCallback(async (): Promise<boolean> => {
        console.log('checkAuth: Starting authentication check');
        if (userWallet) {
            console.log('checkAuth: userWallet exists, calling isAuthenticated');
            const { authenticated } = await userWallet.isAuthenticated();
            console.log('checkAuth: authenticated result:', authenticated);
            setIsAuthenticated(authenticated || false);
            console.log('checkAuth: setIsAuthenticated called with:', authenticated || false);
            return authenticated || false
        } else {
            console.log('checkAuth: userWallet is null or undefined');
        }
        return false
    }, [userWallet]);

    const initializeWallet = useCallback(async () => {
        console.log('initializeWallet: Starting wallet initialization');
        try {
            console.log('initializeWallet: Checking authentication');
            const { authenticated } = await userWallet.isAuthenticated();
            console.log('initializeWallet: authenticated result:', authenticated);
            if (!authenticated) {
                console.error('Wallet not authenticated');
                toast.error('Wallet not authenticated', {
                    duration: 5000,
                    position: 'top-center',
                    id: 'wallet-not-authenticated',
                });
                return;
            }
            console.log('initializeWallet: Wallet authenticated, setting isAuthenticated to true');
            setIsAuthenticated(true);

            console.log('initializeWallet: Fetching identity key');
            // Identity key (not a derived key) — type-42 derivation is rooted in it.
            const { publicKey } = await userWallet.getPublicKey({ identityKey: true });
            console.log('initializeWallet: identity key fetched:', publicKey);

            // Only update state once everything is fetched
            console.log('initializeWallet: Setting userPubKey');
            setUserPubKey(publicKey);
            toast.success('Wallet connected successfully', {
                duration: 5000,
                position: 'top-center',
                id: 'wallet-connect-success',
            });
            console.log('initializeWallet: Wallet initialization completed successfully');
        } catch (error) {
            console.error('Failed to initialize wallet:', error);
            toast.error('Failed to connect wallet', {
                duration: 5000,
                position: 'top-center',
                id: 'wallet-connect-error',
            });
        }
    }, [userWallet]);

    // Logout function to clear all wallet states
    const logout = useCallback(() => {
        console.log('logout: Clearing wallet states');
        setUserWallet(new WalletClient());
        setUserPubKey(null);
        setIsAuthenticated(false);
        console.log('logout: Wallet states cleared');
    }, []);

    // Initialize wallet on mount
    useEffect(() => {
        initializeWallet();
    }, [initializeWallet]);

    return (
        <AuthContext.Provider value={{ userWallet, userPubKey, initializeWallet, isAuthenticated, setIsAuthenticated, checkAuth, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuthContext = () => useContext(AuthContext);