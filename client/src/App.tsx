import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthContextProvider } from '@/context/walletContext';
import { ProtectedRoute } from '@/components/routing/ProtectedRoute';
import AppLayout from '@/AppLayout';
import LoginPage from '@/pages/LoginPage';
import HomePage from '@/pages/HomePage';
import DashboardPage from '@/pages/DashboardPage';
import CreatePage from '@/pages/CreatePage';
import MarketplacePage from '@/pages/MarketplacePage';
import PropertiesPage from '@/pages/PropertiesPage';
import PropertyDetailPage from '@/pages/PropertyDetailPage';

export default function App() {
  return (
    <AuthContextProvider>
      <Routes>
        {/* Public — outside the guard, but still inside the provider. */}
        <Route path="/login" element={<LoginPage />} />

        {/* One wrapper covers the whole protected subtree, so there is no PUBLIC_PATHS
            list to drift out of sync with the router. */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/properties/:propertyId" element={<PropertyDetailPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* Next's layout.tsx never mounted one, so every toast.* call was a silent no-op. */}
      <Toaster position="top-center" />
    </AuthContextProvider>
  );
}
