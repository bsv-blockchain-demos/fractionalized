"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navbar() {
    const pathname = usePathname();

    const isActive = (href: string) => {
        if (href === "/") return pathname === "/";
        return pathname === href || pathname.startsWith(href + "/");
    };

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
                    </ul>
                </div>
            </div>
        </nav>
    );
}