import { LookupResolver, TopicBroadcaster, Transaction } from "@bsv/sdk";

const overlay = new LookupResolver({
    slapTrackers: ['https://overlay-us-1.bsvb.tech'],
    hostOverrides: {
        'ls_fractionalize': ['https://overlay-us-1.bsvb.tech']
    }
});

export const broadcastTX = async (tx: Transaction) => {
    // Lookup a service which accepts this type of token
    const tb = new TopicBroadcaster(['tm_fractionalize'], {
        resolver: overlay,
    })

    // Send the tx to that overlay.
    const overlayResponse = await tx.broadcast(tb)
    console.log("Overlay response: ", overlayResponse);
    return overlayResponse;
}