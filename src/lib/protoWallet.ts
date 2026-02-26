import { ProtoWallet, PrivateKey } from '@bsv/sdk';

if (!process.env.SERVER_PRIVATE_KEY) {
    throw new Error('SERVER_PRIVATE_KEY environment variable is not set');
}

const protoWallet = new ProtoWallet(new PrivateKey(process.env.SERVER_PRIVATE_KEY, 'hex'));
export default protoWallet;
