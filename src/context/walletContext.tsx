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
}

const AuthContext = createContext<authContextType>({
    userWallet: new WalletClient(),
    userPubKey: null,
    initializeWallet: async () => { },
    setIsAuthenticated: () => { },
    isAuthenticated: false,
    checkAuth: async () => { return false; },
});
export const AuthContextProvider = ({ children }: { children: React.ReactNode }) => {
    console.log('AuthContextProvider: Component mounting');
    const [userWallet, setUserWallet] = useState<authContextType['userWallet']>(new WalletClient());
    console.log('AuthContextProvider: userWallet initialized');
    const [userPubKey, setUserPubKey] = useState<authContextType['userPubKey']>(null);
    console.log('AuthContextProvider: userPubKey initialized');
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    console.log('AuthContextProvider: isAuthenticated initialized');

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

            console.log('initializeWallet: Fetching public key');
            const { publicKey } = await userWallet.getPublicKey({
                protocolID: [0, "fractionalized"],
                keyID: "0",
            });
            console.log('initializeWallet: publicKey fetched:', publicKey);

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

    console.log('AuthContextProvider: Rendering provider with children');

    return (
        <AuthContext.Provider value={{ userWallet, userPubKey, initializeWallet, isAuthenticated, setIsAuthenticated, checkAuth }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuthContext = () => useContext(AuthContext);