import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/mongo'
import { checkWalletBalance } from '@/utils/wallet-balance'
import { getMinBalance } from '@/lib/config'

// combined readiness check (wallet + db) — fails closed on any error
export async function GET() {
  try {
    const { db } = await connectToMongo()
    const balance = await checkWalletBalance()
    if (balance < getMinBalance()) throw new Error('Insufficient wallet balance')
    await db.command({ ping: 1 })
    return NextResponse.json({ status: 'ready' })
  } catch (err) {
    return NextResponse.json(
      { status: 'not ready', error: (err as Error).message },
      { status: 503 }
    )
  }
}
