"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function Navbar() {
    const pathname = usePathname();
    const router = useRouter();

    const isActive = (href: string) => {
        if (href === "/") return pathname === "/";
        return pathname === href || pathname.startsWith(href + "/");
    };

    const handleLogout = async () => {
        try {
            const response = await fetch("/api/auth/logout", {
                method: "POST",
            });

            if (response.ok) {
                router.push("/login");
            }
        } catch (error) {
            console.error("Logout failed:", error);
        }
    };

    const isLoginPage = pathname === "/login";

    return (
        <nav className="bg-bg-secondary border-b border-border-subtle shadow-sm px-4 py-4 mb-6">
            <div className="container mx-auto">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-accent-primary rounded-lg flex items-center justify-center">
                            <span className="text-white font-bold text-sm">F</span>
                        </div>
                        <span className="font-bold text-lg text-text-primary">
                            Fractionalized
                        </span>
                    </div>
                    {!isLoginPage && (
                        <div className="flex items-center gap-8">
                            <ul className="flex space-x-8">
                                <li>
                                    <Link
                                        href="/"
                                        className={isActive("/") ? "nav-link active" : "nav-link"}
                                    >
                                        Home
                                    </Link>
                                </li>
                                <li>
                                    <Link
                                        href="/create"
                                        className={isActive("/create") ? "nav-link active" : "nav-link"}
                                    >
                                        Create
                                    </Link>
                                </li>
                                <li>
                                    <Link
                                        href="/properties"
                                        className={isActive("/properties") ? "nav-link active" : "nav-link"}
                                    >
                                        Properties
                                    </Link>
                                </li>
                                <li>
                                    <Link
                                        href="/dashboard"
                                        className={isActive("/dashboard") ? "nav-link active" : "nav-link"}
                                    >
                                        Dashboard
                                    </Link>
                                </li>
                                <li>
                                    <Link
                                        href="/marketplace"
                                        className={isActive("/marketplace") ? "nav-link active" : "nav-link"}
                                    >
                                        Marketplace
                                    </Link>
                                </li>
                            </ul>
                            <button
                                onClick={handleLogout}
                                className="px-4 py-2 text-sm font-medium text-white bg-accent-primary hover:bg-accent-secondary rounded-lg transition-colors"
                            >
                                Logout
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </nav>
    );
}