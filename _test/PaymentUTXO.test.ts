import { PaymentUtxo } from '../src/utils/paymentUtxo'
import { PrivateKey, MerklePath, LockingScript, PublicKey, Transaction, Script, Beef } from '@bsv/sdk'
import { makeWallet } from '../src/lib/serverWallet'
import { hashFromPubkeys } from '../src/utils/hashFromPubkeys'

describe('PaymentUtxo', () => {
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
      lockingScript: uut.lock(hashFromPubkeys([
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

  it('creates a paymentUtxo and spends it validly with serverWallet', async () => {
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
      lockingScript: uut.lock(hashFromPubkeys([
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
      unlockingScriptTemplate: uut.unlock(serverWallet, userLockingKey, "all", false, undefined, undefined, false)
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

  it('creates a paymentUtxo and spends it with wallet.createAction', async () => {
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
      lockingScript: uut.lock(hashFromPubkeys([
        PublicKey.fromString(userLockingKey),
        PublicKey.fromString(serverLockingKey)
      ])),
      satoshis: 2
    })

    sourceTransaction.merklePath = MerklePath.fromCoinbaseTxidAndHeight(sourceTransaction.id('hex'), 1234)

    // Build preimage transaction for signing
    const preimageTx = new Transaction()
    preimageTx.addInput({
      sourceTransaction,
      sourceOutputIndex: 0,
      sequence: 0xffffffff,
    })
    preimageTx.addOutput({
      lockingScript: Script.fromASM('OP_TRUE'),
      satoshis: 1
    })

    const paymentUnlockFrame = uut.unlock(
      /* wallet */ userWallet,
      /* otherPubkey */ serverLockingKey,
      /* signOutputs */ "all",
      /* anyoneCanPay */ false,
      /* sourceSatoshis */ undefined,
      /* lockingScript */ undefined
    )
    const unlockingScript = await paymentUnlockFrame.sign(preimageTx, 0)

    // Create BEEF for the source transaction using Transaction.toBEEF()
    const beefData = sourceTransaction.toAtomicBEEF()

    // Verify BEEF is a number array
    expect(Array.isArray(beefData)).toBe(true)
    expect(beefData.length).toBeGreaterThan(0)
    expect(typeof beefData[0]).toBe('number')

    // Use wallet.createAction to create the spending transaction
    const action = await userWallet.createAction({
      description: "Spend payment UTXO",
      inputBEEF: beefData,
      inputs: [
        {
          inputDescription: "Payment input",
          outpoint: `${sourceTransaction.id('hex')}.0`,
          unlockingScript: unlockingScript.toHex(),
        }
      ],
      outputs: [
        {
          outputDescription: "Output",
          satoshis: 1,
          lockingScript: Script.fromASM('OP_TRUE').toHex(),
        }
      ],
      options: {
        randomizeOutputs: false,
        trustSelf: 'known', // Trust the BEEF we provide since it's a mock transaction
      }
    })

    expect(action).toBeDefined()
    expect(action.txid).toBeDefined()

    // Verify the transaction
    const tx = Transaction.fromBEEF(action.tx as number[])
    const result: boolean = await tx.verify('scripts only')
    expect(result).toBe(true)
  })
})

