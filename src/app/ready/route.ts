import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/mongo'
import { checkWalletBalance } from '@/utils/wallet-balance'

// combined check (wallet + db)
export async function GET() {
  const { MIN_BALANCE } = process.env
  const { db } = await connectToMongo()
  try {
    const balance = await checkWalletBalance()
    if (balance < parseInt(MIN_BALANCE!)) throw new Error('Insufficient wallet balance')
    await db.command({ ping: 1 })
    return NextResponse.json({ status: 'ready' })
  } catch (err) {
    return NextResponse.json(
      { status: 'not ready', error: (err as Error).message },
      { status: 503 }
    )
  }
}