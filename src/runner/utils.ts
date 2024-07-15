import { Address } from '@ton/core';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { z } from 'zod';
import {
    AddressBookEntry,
    BaseTxInfo,
    GetTransactionsParams,
    TransactionIndexed,
    TransactionList,
    TxLinks,
} from './types';

export async function fetchTransactions(
    params: GetTransactionsParams
): Promise<TransactionList> {
    try {
        const response: AxiosResponse<{
            transactions: TransactionIndexed[];
            address_book: Record<string, AddressBookEntry>;
        }> = await axios.get('https://toncenter.com/api/v3/transactions', {
            params,
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching transactions:', error);
        throw error;
    }
}

export async function mcSeqnoByShard(shard: {
    workchain: number;
    seqno: number;
    shard: string;
    rootHash: string;
    fileHash: string;
}): Promise<number> {
    try {
        const shardInt = BigInt(shard.shard);
        const shardUint =
            shardInt < 0 ? shardInt + BigInt('0x10000000000000000') : shardInt;
        const response: AxiosResponse<any> = await axios.get(
            'https://toncenter.com/api/v3/blocks',
            {
                params: {
                    workchain: 0,
                    shard: '0x' + shardUint.toString(16),
                    seqno: shard.seqno,
                },
            }
        );
        const block = response.data.blocks[0];
        if (block.root_hash != shard.rootHash) {
            throw new Error(
                'rootHash mismatch in mc_seqno getter: ' +
                    shard.rootHash +
                    ' != ' +
                    block.root_hash
            );
        }
        return block.masterchain_block_ref.seqno;
    } catch (error) {
        console.error('Error fetching mc_seqno:', error);
        throw error;
    }
}

export async function linkToTx(txLink: string): Promise<BaseTxInfo> {
    // break given tx link to lt, hash, addr

    let lt: bigint, hash: Buffer, addr: Address;

    if (txLink.startsWith('https://ton.cx/tx/')) {
        // example:
        // https://ton.cx/tx/47670702000009:Pl9JeY3iOdpdj4C03DACBNN2E+QgOj97h3wEqIyBhWs=:EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_
        const infoPart = txLink.slice(18);
        let [ltStr, hashStr, addrStr] = infoPart.split(':');
        lt = BigInt(ltStr);
        hash = Buffer.from(hashStr, 'base64');
        addr = Address.parse(addrStr);
    } else if (txLink.startsWith('https://tonviewer.com/')) {
        // example:
        // https://tonviewer.com/transaction/3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
        const infoPart = txLink.slice(34);
        const res = await fetchTransactions({ hash: infoPart, limit: 1 });
        hash = Buffer.from(infoPart, 'hex');
        addr = Address.parseRaw(res.transactions[0].account);
        lt = BigInt(res.transactions[0].lt);
    } else if (txLink.startsWith('https://tonscan.org/tx/')) {
        // example:
        // https://tonscan.org/tx/Pl9JeY3iOdpdj4C03DACBNN2E+QgOj97h3wEqIyBhWs=
        const infoPart = txLink.slice(23);
        const res = await fetchTransactions({ hash: infoPart, limit: 1 });
        hash = Buffer.from(infoPart, 'base64');
        addr = Address.parseRaw(res.transactions[0].account);
        lt = BigInt(res.transactions[0].lt);
    } else if (txLink.startsWith('https://explorer.toncoin.org/transaction')) {
        // example:
        // https://explorer.toncoin.org/transaction?account=EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_&lt=47670702000009&hash=3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
        const url = new URL(txLink);
        lt = BigInt(url.searchParams.get('lt') || '0');
        hash = Buffer.from(url.searchParams.get('hash') || '', 'hex');
        addr = Address.parse(url.searchParams.get('account') || '');
    } else {
        try {
            // (copied from ton.cx lt and hash field)
            // example:
            // 47670702000009:3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
            let [ltStr, hashStr] = txLink.split(':');
            lt = BigInt(ltStr);
            hash = Buffer.from(hashStr, 'hex');
            const res = await fetchTransactions({ hash: hashStr, limit: 1 });
            addr = Address.parseRaw(res.transactions[0].account);
        } catch (e) {
            try {
                // (just hash)
                // example:
                // 3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
                const res = await fetchTransactions({ hash: txLink, limit: 1 });
                hash = Buffer.from(res.transactions[0].hash, 'base64');
                lt = BigInt(res.transactions[0].lt);
                addr = Address.parseRaw(res.transactions[0].account);
            } catch (e) {
                throw new Error('Unknown tx link format');
            }
        }
    }
    return { lt, hash, addr };
}

export function txToLinks(opts: BaseTxInfo): TxLinks {
    return {
        toncx: `https://ton.cx/tx/${opts.lt}:${opts.hash.toString('base64')}:${opts.addr.toString()}`,
        tonviewer: `https://tonviewer.com/transaction/${opts.hash.toString('hex')}`,
        tonscan: `https://tonscan.org/tx/${opts.hash.toString('base64')}`,
        toncoin: `https://explorer.toncoin.org/transaction?account=${opts.addr.toString()}&lt=${opts.lt}&hash=${opts.hash.toString('hex')}`,
    };
}
