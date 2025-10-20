import { PrivateKey, Transaction, Script, LockingScript, OP, UnlockingScript, TransactionSignature, Hash, Spend, MerklePath, PublicKey } from '@bsv/sdk'
import { OrdinalsP2PKH } from '../src/utils/ordinalsP2PKH'
import { OrdinalsP2MS } from '../src/utils/ordinalsP2MS'
import { makeWallet } from '../src/lib/serverWallet'
import { hashFromPubkeys } from '../src/utils/hashFromPubkeys'
const { sha256, hash160 } = Hash

describe('Ordinals.lock', () => {
  it('creates a Ordinal and spends it validly', async () => {
    const userPriv = PrivateKey.fromRandom()
    const serverPriv = PrivateKey.fromRandom()

    const userWallet = await makeWallet('main', 'https://store-us-1.bsvb.tech', userPriv.toHex())
    const serverWallet = await makeWallet('main', 'https://store-us-1.bsvb.tech', serverPriv.toHex())
    // Ensure env var is set before importing the module under test
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

    const userAddress = PublicKey.fromString(userLockingKey).toAddress()

    const hash = hashFromPubkeys([PublicKey.fromString(userLockingKey), PublicKey.fromString(serverLockingKey)])
  
    const sourceTransaction = new Transaction()
    sourceTransaction.addInput({
      sourceTXID: '0000000000000000000000000000000000000000000000000000000000000000',
      sourceOutputIndex: 0,
      unlockingScript: Script.fromASM('OP_TRUE')
    })
    sourceTransaction.addOutput({
      lockingScript: new OrdinalsP2MS().lock(hash, 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe_0', 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe', 34, 'transfer'),
      satoshis: 3
    })

    sourceTransaction.merklePath = MerklePath.fromCoinbaseTxidAndHeight(sourceTransaction.id('hex'), 1234)

    const tx = new Transaction()

    tx.addInput({
      sourceTransaction,
      sourceOutputIndex: 0,
      unlockingScriptTemplate: new OrdinalsP2MS().unlock(userWallet, serverLockingKey)
    })
    tx.addOutput({
      lockingScript: new OrdinalsP2PKH().lock(userAddress, 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe_0', 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe', 12, 'transfer'),
      satoshis: 1
    })
    tx.addOutput({
      lockingScript: new OrdinalsP2MS().lock(hash, 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe_0', 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe', 22, 'transfer'),
      satoshis: 1
    })


    await tx.fee()
    await tx.sign()

    const result: boolean = await tx.verify('scripts only')

    expect(result).toBe(true)
  })

  it('Successfully validates a Multi-sig spend', async () => {
    // Get all the necessary keys
    const privateKey = new PrivateKey(1)
    const pirvateKey2 = new PrivateKey(2)
    const publicKey = privateKey.toPublicKey()
    const publicKey2 = pirvateKey2.toPublicKey()
    const publicKeyNumArray = publicKey.encode(true) as number[]
    const publicKey2NumArray = publicKey2.encode(true) as number[]
    // Create hash of public keys
    const oneOfTwoHash = hash160(publicKeyNumArray.concat(publicKey2NumArray))
    // Create multisig locking script
    const lockingScript = new LockingScript();
    lockingScript
      .writeOpCode(OP.OP_2DUP)
      .writeOpCode(OP.OP_CAT)
      .writeOpCode(OP.OP_HASH160)
      .writeBin(oneOfTwoHash)
      .writeOpCode(OP.OP_EQUALVERIFY)
      .writeOpCode(OP.OP_TOALTSTACK)
      .writeOpCode(OP.OP_TOALTSTACK)
      .writeOpCode(OP.OP_1)
      .writeOpCode(OP.OP_FROMALTSTACK)
      .writeOpCode(OP.OP_FROMALTSTACK)
      .writeOpCode(OP.OP_2)
      .writeOpCode(OP.OP_CHECKMULTISIG);
    
    const satoshis = 1
    const sourceTx = new Transaction(
      1,
      [],
      [
        {
          lockingScript,
          satoshis
        }
      ],
      0
    )
    const spendTx = new Transaction(
      1,
      [
        {
          sourceTransaction: sourceTx,
          sourceOutputIndex: 0,
          sequence: 0xffffffff
        }
      ],
      [],
      0
    )

    // Create signature
    const signatureScope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID;
    const preimage = TransactionSignature.format({
      sourceTXID: sourceTx.id('hex'),
      sourceOutputIndex: 0,
      sourceSatoshis: satoshis,
      transactionVersion: spendTx.version,
      otherInputs: [], // Should exclude the current input (inputIndex 0)
      inputIndex: 0,
      outputs: spendTx.outputs,
      inputSequence: 0xffffffff,
      subscript: lockingScript,
      lockTime: spendTx.lockTime,
      scope: signatureScope,
    });
    const rawSignature = privateKey.sign(sha256(preimage))
    const sig = new TransactionSignature(
      rawSignature.r,
      rawSignature.s,
      signatureScope
    )
    const sigForScript = sig.toChecksigFormat()
  
    const unlockingScript = new UnlockingScript()
    unlockingScript
      .writeOpCode(OP.OP_0) // required dummy for checkmultisig
      .writeBin(sigForScript)
      .writeBin(publicKeyNumArray)
      .writeBin(publicKey2NumArray)
      
    const spend = new Spend({
      sourceTXID: sourceTx.id('hex'),
      sourceOutputIndex: 0,
      sourceSatoshis: satoshis,
      lockingScript,
      transactionVersion: 1,
      otherInputs: [],
      inputIndex: 0,
      unlockingScript,
      outputs: [],
      inputSequence: 0xffffffff,
      lockTime: 0
    })
    const valid = spend.validate()
    expect(valid).toBe(true)
  })
})

