import { Navigate, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuthContext } from '@/context/walletContext';
import { Spinner } from '@/components/spinner';

/**
 * Replaces src/middleware.ts. Real enforcement stays server-side (the API's 401s); this
 * only keeps protected UI from flashing and preserves the blocked path in state.from so
 * login can return there. Spinner already carries role="status" — don't add a second one.
 */
export function ProtectedRoute({ children }: { children: ReactElement }) {
    const { status } = useAuthContext();
    const location = useLocation();

    if (status === 'authenticated') return children;
    if (status === 'restoring') {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <Spinner size={32} />
            </div>
        );
    }
    return <Navigate to="/login" state={{ from: location }} replace />;
}
