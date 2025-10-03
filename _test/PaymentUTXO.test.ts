import { PaymentUTXO } from '../src/utils/paymentUtxo'
import { PrivateKey, UnlockingScript, LockingScript } from '@bsv/sdk'

describe('PaymentUTXO', () => {
  it('creates a valid locking script for 1-of-2 multisig', () => {
    const uut = new PaymentUTXO()
    const oneOfTwoHash = [1, 2, 3, 4, 5]
    const script = uut.lock(oneOfTwoHash)
    expect(script).toBeInstanceOf(LockingScript)
  })

  it('creates a valid unlocking script from sig and pubkeys', () => {
    const uut = new PaymentUTXO()
    const userPriv = PrivateKey.fromRandom()
    const serverPriv = PrivateKey.fromRandom()

    // We do not need a real chain-valid signature here; only shape is used
    const fakeSig = {
      toChecksigFormat: () => [0x30, 0x44, 0x02, 0x20],
    } as any

    const unlocking = uut.unlock(
      fakeSig,
      userPriv.toPublicKey().toString(),
      serverPriv.toPublicKey().toString()
    )
    expect(unlocking).toBeInstanceOf(UnlockingScript)
  })
})

