import { Outlet } from "react-router-dom";
import { Navbar } from "@/components/navbar";

// Was src/app/layout.tsx. The document shell lives in index.html and the providers
// in App.tsx, so only the navbar chrome remains.
export default function AppLayout() {
    return (
        <div>
            <Navbar />
            <Outlet />
        </div>
    );
}
