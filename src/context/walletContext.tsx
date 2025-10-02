"use client"

import {
    WalletClient,
} from '@bsv/sdk'
import { useContext, createContext, useState, useEffect, useCallback } from "react";
import { toast } from "react-hot-toast";

type authContextType = {
    userWallet: WalletClient | null;
    userPubKey: string | null;
    initializeWallet: () => Promise<void>;
    setIsAuthenticated: (value: boolean) => void;
    isAuthenticated: boolean | null;
    checkAuth: () => Promise<boolean>;
}

const AuthContext = createContext<authContextType>({
    userWallet: null,
    userPubKey: null,
    initializeWallet: async () => { },
    setIsAuthenticated: () => { },
    isAuthenticated: null,
    checkAuth: async () => { return false; },
});

export const AuthContextProvider = ({ children }: { children: React.ReactNode }) => {
    const [userWallet, setUserWallet] = useState<authContextType['userWallet']>(null);
    const [userPubKey, setUserPubKey] = useState<authContextType['userPubKey']>(null);
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

    const checkAuth = useCallback(async () => {
        try {
            const response = await fetch("/api/auth/me");
            setIsAuthenticated(response.ok);
            return true;
        } catch (error) {
            setIsAuthenticated(false);
            return false;
        }
    }, []);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    const initializeWallet = useCallback(async () => {
        try {
            const newWallet = new WalletClient('auto', 'fractionalize');

            const isConnected = await newWallet.isAuthenticated();
            if (!isConnected) {
                console.error('Wallet not authenticated');
                toast.error('Wallet not authenticated', {
                    duration: 5000,
                    position: 'top-center',
                    id: 'wallet-not-authenticated',
                });
                return;
            }

            const { publicKey } = await newWallet.getPublicKey({ 
                protocolID: [0, "fractionalized"],
                keyID: "0", 
            });

            // Only update state once everything is fetched
            setUserWallet(newWallet);
            setUserPubKey(publicKey);
            toast.success('Wallet connected successfully', {
                duration: 5000,
                position: 'top-center',
                id: 'wallet-connect-success',
            });
        } catch (error) {
            console.error('Failed to initialize wallet:', error);
            toast.error('Failed to connect wallet', {
                duration: 5000,
                position: 'top-center',
                id: 'wallet-connect-error',
            });
        }
    }, []);

    useEffect(() => {
        initializeWallet();
    }, []);

    return (
        <AuthContext.Provider value={{ userWallet, userPubKey, initializeWallet, isAuthenticated, setIsAuthenticated, checkAuth }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuthContext = () => useContext(AuthContext);