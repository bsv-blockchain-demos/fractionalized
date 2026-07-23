import { LookupResolver, TopicBroadcaster, Transaction } from "@bsv/sdk";
import { logger } from "../utils/logger";

const overlay = new LookupResolver({
    slapTrackers: ['https://overlay-us-1.bsvb.tech'],
    hostOverrides: {
        'ls_fractionalize': ['https://overlay-us-1.bsvb.tech']
    }
});

export const broadcastTX = async (tx: Transaction) => {
    const txid = tx.id('hex');
    try {
        const tb = new TopicBroadcaster(['tm_fractionalize'], { resolver: overlay });
        const overlayResponse = await tx.broadcast(tb);
        logger.debug("Overlay response: ", overlayResponse);
        return { status: 'success' as const, txid, overlayResponse };
    } catch (e) {
        logger.warn(`Overlay broadcast failed for ${txid} (non-fatal):`, e);
        return { status: 'failed' as const, txid };
    }
}

export async function getTransactionByTxID(txid: string) {
    try {
        // get transaction from overlay
        const response = await overlay.query({
            service: 'ls_fractionalize', query: {
                txid: txid
            }
        }, 10000);

        return response;
    } catch (error) {
        logger.error("Error getting transaction:", error);
    }
}