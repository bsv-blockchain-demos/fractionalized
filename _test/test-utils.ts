import { PrivateKey, KeyDeriver, WalletInterface, ChainTracker } from '@bsv/sdk'
import { Wallet, WalletStorageManager, WalletSigner, Services, StorageClient } from '@bsv/wallet-toolbox'

export async function makeWallet (
  chain: 'test' | 'main' = 'main',
  storageURL: string = 'https://store-us-1.bsvb.tech',
  privateKey: string = PrivateKey.fromRandom().toString()
): Promise<WalletInterface> {
  const keyDeriver = new KeyDeriver(new PrivateKey(privateKey, 'hex'))
  const storageManager = new WalletStorageManager(keyDeriver.identityKey)
  const signer = new WalletSigner(chain, keyDeriver, storageManager)
  const services = new Services(chain)
  const wallet = new Wallet(signer, services)
  const client = new StorageClient(
    wallet,
    storageURL
  )
  await client.makeAvailable()
  await storageManager.addWalletStorageProvider(client)

  return wallet
}