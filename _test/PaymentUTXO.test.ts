import { PaymentUtxo } from '../src/utils/paymentUtxo'
import { PrivateKey, MerklePath, LockingScript, PublicKey, Transaction, Script } from '@bsv/sdk'
import { makeWallet } from '../src/lib/serverWallet'

describe('PaymentUtxo', () => {
  it('creates a valid locking script for 1-of-2 multisig', () => {
    const uut = new PaymentUtxo()
    const oneOfTwoHash = [1, 2, 3, 4, 5]
    const script = uut.lock(oneOfTwoHash)
    expect(script).toBeInstanceOf(LockingScript)
  })

  it('creates a paymentUtxo and spends it validly', async () => {
    const uut = new PaymentUtxo()
    const userPriv = PrivateKey.fromRandom()
    const serverPriv = PrivateKey.fromRandom()

    const userWallet = await makeWallet('main', 'https://store-us-1.bsvb.tech', userPriv.toHex())
    const serverWallet = await makeWallet('main', 'https://store-us-1.bsvb.tech', serverPriv.toHex())


    const { publicKey: serverLockingKey } = await serverWallet.getPublicKey({
      protocolID: [0, "fractionalized"],
      keyID: "0",
      counterparty: "self",
    })


    const { publicKey: userLockingKey } = await userWallet.getPublicKey({
      protocolID: [0, "fractionalized"],
      keyID: "0",
      counterparty: 'self',
    })

    const sourceTransaction = new Transaction()
    sourceTransaction.addInput({
      sourceTXID: '0000000000000000000000000000000000000000000000000000000000000000',
      sourceOutputIndex: 0,
      unlockingScript: Script.fromASM('OP_TRUE')
    })
    sourceTransaction.addOutput({
      lockingScript: uut.lock(PaymentUtxo.hashFromPubkeys([
        PublicKey.fromString(userLockingKey),
        PublicKey.fromString(serverLockingKey)
      ])),
      satoshis: 2
    })

    sourceTransaction.merklePath = MerklePath.fromCoinbaseTxidAndHeight(sourceTransaction.id('hex'), 1234)

    const tx = new Transaction()

    tx.addInput({
      sourceTransaction,
      sourceOutputIndex: 0,
      unlockingScriptTemplate: uut.unlock(userWallet, serverLockingKey)
    })
    tx.addOutput({
      lockingScript: Script.fromASM('OP_TRUE'),
      satoshis: 1
    })

    await tx.fee()
    await tx.sign()

    const result: boolean = await tx.verify('scripts only')

    expect(result).toBe(true)
  })
})

