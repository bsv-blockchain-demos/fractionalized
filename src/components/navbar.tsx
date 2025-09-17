import Link from "next/link";

export function Navbar() {
    return (
        <nav className="bg-white shadow-sm border-b border-gray-200 px-4 py-3 mb-6">
            <div className="container mx-auto">
                <ul className="flex space-x-8">
                    <li>
                        <Link href="/" className="text-gray-700 hover:text-gray-900 hover:cursor-pointer font-medium">
                            Home
                        </Link>
                    </li>
                    <li>
                        <Link href="/properties" className="text-gray-700 hover:text-gray-900 hover:cursor-pointer font-medium">
                            Properties
                        </Link>
                    </li>
                    <li>
                        <Link href="/dashboard" className="text-gray-700 hover:text-gray-900 hover:cursor-pointer font-medium">
                            Dashboard
                        </Link>
                    </li>
                </ul>
            </div>
        </nav>
    );
}