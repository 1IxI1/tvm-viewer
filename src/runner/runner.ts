import { Buffer } from 'buffer';
import { Blockchain, IExecutor } from '@ton/sandbox';
import {
    AccountState,
    Address,
    beginCell,
    Cell,
    ShardAccount,
    storeMessage,
    storeShardAccount,
    loadShardAccount,
    Transaction,
    loadTransaction,
    Dictionary,
} from '@ton/core';
import {
    loadConfigParamsAsSlice,
    parseFullConfig,
    TonClient,
    TonClient4,
} from '@ton/ton';
import {
    AccountFromAPI,
    BaseTxInfo,
    ComputeInfo,
    EmulateWithStackResult,
    StateFromAPI,
    TVMLog,
} from './types';
import { parseStack } from './stack';
import { getLib, linkToTx, mcSeqnoByShard, txToLinks } from './utils';

function b64ToBigInt(b64: string): bigint {
    return BigInt('0x' + Buffer.from(b64, 'base64').toString('hex'));
}

function normalizeStateFromAPI(givenState: StateFromAPI): AccountState {
    if (givenState.type === 'uninit')
        return {
            type: 'uninit',
        };
    if (givenState.type === 'frozen')
        return {
            type: 'frozen',
            stateHash: b64ToBigInt(givenState.stateHash),
        };
    else
        return {
            type: 'active',
            state: {
                code: givenState.code
                    ? Cell.fromBase64(givenState.code)
                    : undefined,
                data: givenState.data
                    ? Cell.fromBase64(givenState.data)
                    : undefined,
            },
        };
}

function createShardAccountFromAPI(
    apiAccount: AccountFromAPI,
    address: Address
): ShardAccount {
    function toMaybeBN(num: number | undefined): bigint {
        return num !== undefined ? BigInt(num) : 0n;
    }
    return {
        account: {
            addr: address,
            storage: {
                lastTransLt: BigInt(apiAccount.last?.lt || 0),
                balance: { coins: BigInt(apiAccount.balance.coins || 0) },
                state: normalizeStateFromAPI(apiAccount.state),
            },
            storageStats: {
                used: {
                    cells: toMaybeBN(apiAccount.storageStat?.used.cells),
                    bits: toMaybeBN(apiAccount.storageStat?.used.bits),
                    publicCells: toMaybeBN(
                        apiAccount.storageStat?.used.publicCells
                    ),
                },
                lastPaid: apiAccount.storageStat?.lastPaid || 0,
                duePayment:
                    typeof apiAccount.storageStat?.duePayment === 'string'
                        ? BigInt(apiAccount.storageStat?.duePayment)
                        : null,
            },
        },
        lastTransactionLt: BigInt(apiAccount.last?.lt || 0),
        lastTransactionHash: apiAccount.last?.hash
            ? b64ToBigInt(apiAccount.last?.hash)
            : 0n,
    };
}

async function getOtherTxs(
    client: TonClient,
    opts: {
        address: Address;
        lt: number | bigint | string;
        minLt?: number | bigint | string;
        hash?: string;
    }
): Promise<Transaction[]> {
    const txsInBlock = await client.getTransactions(opts.address, {
        inclusive: true,
        // last - requested tx lt
        lt: opts.lt.toString(),
        to_lt:
            opts.minLt?.toString() ||
            // to the first tx in the block for this addr (it starts from 462xxxxx000001 lt)
            // e.g.:  46297691000025, 46297691000043 -> 46297691000000
            ((BigInt(opts.lt) / 10000n) * 10000n).toString(),
        hash: opts.hash,
        archival: true,
        limit: 1000,
    });
    return txsInBlock;
}

export async function waitForRateLimit() {
    return new Promise((resolve) => setTimeout(resolve, 1000));
}

export async function getEmulationWithStack(
    txLink: string | BaseTxInfo,
    testnet: boolean,
    sendStatus: (status: string) => void = () => {}
): Promise<EmulateWithStackResult> {
    const endpointV4 = `https://${testnet ? 'sandbox' : 'mainnet'}-v4.tonhubapi.com`;
    const endpointV2 = `https://${testnet ? 'testnet.' : ''}toncenter.com/api/v2/jsonRPC`;

    const clientV4 = new TonClient4({
        endpoint: endpointV4,
        timeout: 20000,
        requestInterceptor: (config) => {
            config.headers['Content-Type'] = 'application/json';
            return config;
        },
    });
    const clientV2 = new TonClient({ endpoint: endpointV2, timeout: 10000 });

    const {
        lt,
        hash,
        addr: address,
    } = typeof txLink == 'string' ? await linkToTx(txLink, testnet) : txLink;

    // 1. get tx alone to get the mc block seqno
    sendStatus('Getting the tx');
    const tx = (await clientV4.getAccountTransactions(address, lt, hash))[0];
    console.log(tx.tx.now, 'tx time');
    await waitForRateLimit();
    const { mcSeqno, randSeed } = await mcSeqnoByShard(tx.block, testnet);
    await waitForRateLimit();
    const fullBlock = await clientV4.getBlock(mcSeqno);
    const mcBlockSeqno = fullBlock.shards[0].seqno;

    // 2. find min lt tx on account in block
    let isOurTxLastTx = true;
    let minLt = tx.tx.lt;
    let addrStr = address.toString();
    for (let shard of fullBlock.shards) {
        for (let txInBlock of shard.transactions) {
            if (txInBlock.account === addrStr) {
                if (BigInt(txInBlock.lt) < minLt) {
                    minLt = BigInt(txInBlock.lt);
                }
                // won't check balance at the end if our tx
                // is not last in block
                if (BigInt(txInBlock.lt) > tx.tx.lt) {
                    isOurTxLastTx = false;
                }
            }
        }
    }

    // 3. get txs from the mc block (maybe many shard blocks)
    sendStatus('Getting previous txs');
    const txs = await getOtherTxs(clientV2, {
        address,
        lt,
        minLt: minLt - 1n,
        hash: hash.toString('base64'),
    });

    console.log(txs.length, 'transactions found');
    console.log('first:', txs[txs.length - 1].lt, 'last:', txs[0].lt);

    // 3.1 get blockchain config
    sendStatus('Getting blockchain config');
    await waitForRateLimit();
    const getConfigResult = await clientV4.getConfig(mcBlockSeqno);
    const blockConfig = getConfigResult.config.cell;
    console.log(
        'Fees:',
        parseFullConfig(loadConfigParamsAsSlice(blockConfig)).msgPrices
    );

    // 4. get prev. state from prev. block
    sendStatus('Getting account state');
    let account: AccountFromAPI;
    const getAccountResult = await clientV4.getAccount(
        mcBlockSeqno - 1,
        address
    );
    account = getAccountResult.account;
    let initialShardAccount = createShardAccountFromAPI(account, address);

    // 4.1 Get libs if needed
    const _libs = Dictionary.empty(
        Dictionary.Keys.BigUint(256),
        Dictionary.Values.Cell()
    );

    async function tryAddLib(code?: Cell | null) {
        if (code instanceof Cell && code.bits.length == 256 + 8) {
            const cs = code.beginParse(true);
            const tag = cs.loadUint(8);
            if (tag == 2) {
                sendStatus('Getting libs');
                const libHash = cs.loadBuffer(32);
                const libHashHex = libHash.toString('hex').toUpperCase();
                console.log('Found lib:', libHashHex);
                const actualCode = await getLib(libHashHex, testnet);
                _libs.set(BigInt(`0x${libHashHex}`), actualCode);
            }
        }
    }

    const state = initialShardAccount.account?.storage.state;
    if (state?.type == 'active') {
        await tryAddLib(state.state.code);
    }
    const msgInit = tx.tx.inMessage?.init;
    if (msgInit) {
        await tryAddLib(msgInit.code);
    }
    let libs: Cell | null = null;
    if (_libs.size > 0) libs = beginCell().storeDictDirect(_libs).endCell();

    // 5. prep. emulator

    // enabling stack logging increases the gasUsed.
    // so we run it twice - with and without stack
    // let executor1 = await Executor.create();
    // const executor2 = await Executor.create();
    let blockchain1 = await Blockchain.create();
    let blockchain2 = await Blockchain.create();

    // function - to use many times
    async function _emulate(
        _executor: IExecutor,
        _tx: Transaction,
        _shardAccountStr: string,
        _withStack: boolean
    ) {
        const _msg = _tx.inMessage;
        if (!_msg) throw new Error('No in_message was found in tx');

        let _txRes = _executor.runTransaction({
            config: blockConfig,
            libs,
            verbosity: _withStack ? 'full_location_stack_verbose' : 'short',
            shardAccount: _shardAccountStr,
            message: beginCell().store(storeMessage(_msg)).endCell(),
            now: _tx.now,
            lt: _tx.lt,
            randomSeed: randSeed,
            ignoreChksig: false,
            debugEnabled: true,
        });

        return _txRes;
    }

    // reverse the array because first txs
    // in inital list are the new ones
    let prevTxsInBlock = txs.slice(1);
    prevTxsInBlock.reverse();

    // for first transaction (executor doesn't know about last tx):
    initialShardAccount.lastTransactionLt = 0n;
    initialShardAccount.lastTransactionHash = 0n;

    let shardAccountStr = beginCell()
        .store(storeShardAccount(initialShardAccount))
        .endCell()
        .toBoc()
        .toString('base64');

    // 6. emulate prev. txs in block
    sendStatus('Emulating');
    let prevBalance = BigInt(account.balance.coins);
    if (prevTxsInBlock.length > 0) {
        let on = 1;
        for (let _tx of prevTxsInBlock) {
            sendStatus(`Emulating ${on}/${prevTxsInBlock.length}`);
            let midRes = await _emulate(
                blockchain1.executor,
                _tx,
                shardAccountStr,
                false
            );
            await _emulate(blockchain2.executor, _tx, shardAccountStr, false); // clone - for stack later

            if (!midRes.result.success) {
                console.log(midRes.logs);
                console.log(midRes.debugLogs);
                throw new Error(`Transaction failed for lt: ${_tx.lt}`);
            }

            const midTxOccured = loadTransaction(
                Cell.fromBase64(midRes.result.transaction).asSlice()
            );
            const stateOk = midTxOccured.stateUpdate.newHash.equals(
                _tx.stateUpdate.newHash
            );

            console.log('State update ok:', stateOk);

            shardAccountStr = midRes.result.shardAccount;

            let parsedShardAccount = loadShardAccount(
                Cell.fromBase64(shardAccountStr).asSlice()
            );

            const newBalance =
                parsedShardAccount.account?.storage.balance.coins;
            console.log(`lt: ${_tx.lt} balance: ${newBalance}`);

            prevBalance = newBalance || 0n;

            console.log('');
            on++;
        }
    }

    // 7. run the target tx

    const msg = txs[0].inMessage;
    if (!msg) throw new Error('No in_message was found in tx');

    sendStatus('Emulating the tx');
    let accountCopy = shardAccountStr;
    let txResCorrect = await _emulate(
        blockchain1.executor,
        txs[0],
        shardAccountStr,
        false
    );
    let txResWithStack = await _emulate(
        blockchain2.executor,
        txs[0],
        accountCopy,
        true
    );

    sendStatus('Packing the result');

    if (
        tx.tx.description.type === 'generic' &&
        tx.tx.description.computePhase.type === 'vm'
    ) {
        console.log('Api gasUsed:', tx.tx.description.computePhase.gasUsed);
    }

    console.log('logs:', txResCorrect.logs);

    // 8. process stack and instructions

    if (!txResWithStack.result.success) {
        console.error('Transaction (with stack) failed:', txResWithStack);
        throw new Error(`Transaction failed`);
    }
    if (!txResCorrect.result.success) {
        console.error('Transaction failed:', txResCorrect);
        throw new Error(`Transaction failed`);
    }
    let TVMResult: TVMLog[] = [];
    let instruction = '';
    const logs = txResWithStack.result.vmLog;
    for (let line of logs.split('\n')) {
        if (line.startsWith('execute')) {
            if (instruction) {
                console.warn('No stack was for instruction:', instruction);
            }
            instruction = line.slice(8);
        }

        if (line.startsWith('stack:')) {
            // console.log('Parsing stack for', instruction, line);
            const stack = parseStack(line);
            // got stack. now link it with the instruction
            if (instruction) {
                TVMResult.push({ instruction, stackAfter: stack });
                instruction = '';
            } else {
                if (TVMResult.length > 0) {
                    // bad behavior
                    console.error('No instruction for stack:', stack);
                    console.error(
                        `last instruction: #${TVMResult.length - 1}. ${instruction}`
                    );
                    TVMResult.push({
                        // push stack without instruction
                        instruction: 'unknown instruction',
                        stackAfter: stack,
                    });
                }
            }
        }
    }

    // 9. parse, compile and return the result

    let parsedShardAccount = loadShardAccount(
        Cell.fromBase64(txResCorrect.result.shardAccount).asSlice()
    );
    const endBalance = parsedShardAccount.account?.storage.balance.coins || 0n;

    const theTx = loadTransaction(
        Cell.fromBase64(txResCorrect.result.transaction).asSlice()
    );
    const theWrongTx = loadTransaction(
        Cell.fromBase64(txResWithStack.result.transaction).asSlice()
    );
    const wasOldHashSame = theTx.stateUpdate.oldHash.equals(
        theWrongTx.stateUpdate.oldHash
    );
    console.log('VM had same hash:', wasOldHashSame);

    const stateUpdateHashOk = theTx.stateUpdate.newHash.equals(
        txs[0].stateUpdate.newHash
    );
    if (!stateUpdateHashOk) {
        console.warn('State update hash mismatch. Maybe random in txs?');
    } else {
        console.log('State update hash ok');
    }

    if (!theTx.inMessage)
        throw new Error('No in_message was found in result tx');

    const src = theTx.inMessage.info.src;
    const dest = theTx.inMessage.info.dest;

    if (src !== undefined && src !== null && !Address.isAddress(src)) {
        console.log(`Src: ${src}`);
        throw new Error('Invalid src address');
    }
    if (!Address.isAddress(dest)) {
        console.log(`Dest: ${dest}`);
        throw new Error('Invalid dest address');
    }

    const amount =
        theTx.inMessage?.info.type == 'internal'
            ? theTx.inMessage?.info.value.coins
            : undefined;

    let sentTotal = 0n;
    for (let outMsg of theTx.outMessages.values()) {
        if (outMsg.info.type == 'internal') {
            sentTotal += outMsg.info.value.coins;
        }
    }
    const totalFees = theTx.totalFees.coins;

    const balanceAfter = endBalance;

    if (theTx.description.type !== 'generic') {
        throw new Error(
            'No support for non-generic txs. Given type: ' +
                theTx.description.type
        );
    }

    const computePhase = theTx.description.computePhase;
    const computeInfo: ComputeInfo =
        computePhase.type === 'skipped'
            ? 'skipped'
            : {
                  success: computePhase.success,
                  exitCode:
                      // if success in compute, there's action phase.
                      // so put its result code as exit too (if not 0)
                      computePhase.exitCode == 0
                          ? theTx.description.actionPhase?.resultCode || 0
                          : computePhase.exitCode,
                  vmSteps: computePhase.vmSteps,
                  gasUsed: computePhase.gasUsed,
                  gasFees: computePhase.gasFees,
              };

    return {
        sender: src,
        contract: dest,
        amount,
        utime: theTx.now,
        lt: theTx.lt,
        money: {
            balanceBefore: prevBalance,
            sentTotal,
            totalFees,
            balanceAfter,
        },
        computeInfo,
        computeLogs: TVMResult,
        stateUpdateHashOk,
        executorLogs: txResCorrect.logs,
        links: txToLinks({ addr: address, lt, hash }, testnet),
    };
}
