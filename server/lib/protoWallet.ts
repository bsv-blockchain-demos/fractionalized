import { ProtoWallet, PrivateKey } from '@bsv/sdk';

if (!process.env.SERVER_PRIVATE_KEY) {
    throw new Error('SERVER_PRIVATE_KEY environment variable is not set');
}

const protoWallet = new ProtoWallet(PrivateKey.fromString(process.env.SERVER_PRIVATE_KEY!));
export default protoWallet;
