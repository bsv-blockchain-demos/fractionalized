import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        // Create response that redirects to login
        const response = NextResponse.json(
            { message: "Logged out successfully" },
            { status: 200 }
        );

        // Delete the auth cookie (same name as used in middleware)
        response.cookies.delete("verified");

        return response;
    } catch (error) {
        console.error("Logout error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
