import { Address, BitReader, BitString, Builder, Cell, Slice } from '@ton/core';
import { StackElement } from './types';

// from ton-core/src/boc/utils/paddedBits.ts (edited)
export function paddedBufferToBits(buff: Buffer, incomplete: boolean = true) {
    let bitLen = buff.length * 8;
    if (incomplete) {
        // Finding rightmost non-zero byte in the buffer
        for (let i = buff.length - 1; i >= 0; i--) {
            if (buff[i] !== 0) {
                const testByte = buff[i];
                // Looking for a rightmost set padding bit
                let bitPos = testByte & -testByte;
                if ((bitPos & 1) == 0) {
                    // It's power of 2 (only one bit set)
                    bitPos = Math.log2(bitPos) + 1;
                }
                bitLen = i * 8; // Full bytes * 8
                bitLen += 8 - bitPos;
                break;
            }
        }
    }
    return new BitString(buff, 0, bitLen);
}

export function builderFromCanonical(word: string): Builder {
    let buffer = Buffer.from(word.slice(3, -1), 'hex');
    // second byte - num of bytes
    let len = buffer[1];
    buffer = buffer.subarray(2);
    let incomplete = false;
    if (len % 2 == 1) {
        incomplete = true;
        len -= 1;
    }
    len /= 2;
    let bs = paddedBufferToBits(buffer, incomplete);
    let builder = new Builder();
    builder.storeBits(bs);
    return builder;
}

export function sliceFromCanonical(
    word: string,
    wordsNext: string[]
): Slice | Address {
    let hexStr = word.slice(8, -1);
    let buffer = Buffer.from(hexStr, 'hex');

    // second byte - num of bytes
    let lenFromStr = buffer[1];
    buffer = buffer.subarray(2);
    let incomplete = false;
    if (lenFromStr % 2 == 1) {
        incomplete = true;
        lenFromStr -= 1;
    }
    lenFromStr /= 2;

    // `311..578;` -> 311 - offset, 578 - len
    // bits: 0..400; refs: 0..2}
    const bitsStr = wordsNext[1];
    const refsStr = wordsNext[3];
    const offsetAndLen = bitsStr.split('..');
    const offset = Number(offsetAndLen[0]);
    const lenFromLog = Number(offsetAndLen[1].slice(0, -1));
    const refsOffsetAndLen = refsStr.split('..');
    const refsOffset = Number(refsOffsetAndLen[0]);
    const refsLen = Number(refsOffsetAndLen[1].slice(0, -1));
    const refsAvailable = refsLen - refsOffset;

    let fakeRefs = [];
    for (let i = 0; i < refsAvailable; i++) {
        fakeRefs.push(Cell.EMPTY);
    }

    let bs = paddedBufferToBits(buffer, incomplete);
    bs = bs.substring(0, lenFromLog);
    const br = new BitReader(bs, offset);
    let slice = new Slice(br, [...fakeRefs]);

    // shake out offset bits
    slice = slice.asCell().asSlice();

    // try parse address
    if (slice.remainingBits == 267) {
        try {
            const addr = slice.loadAddress();
            return addr;
        } catch (e) {}
    }
    return slice;
}

function parseStackElement(word: string, wordsNext: string[]): StackElement {
    // Parsing every type of stack element:
    //
    // Integer - signed 257-bit integers
    // Tuple - ordered collection of up to 255 elements having arbitrary value types, possibly distinct.
    // Null
    // And four distinct flavours of cells:
    // Cell - basic (possibly nested) opaque structure used by TON Blockchain for storing all data
    // Slice - a special object which allows you to read from a cell
    // Builder - a special object which allows you to create new cells
    // Continuation - a special object which allows you to use a cell as source of TVM instructions
    //
    // See https://docs.ton.org/learn/tvm-instructions/tvm-overview#tvm-is-a-stack-machine
    if (word == '()') {
        // just null
        return null;
    } else if (word.startsWith('(') && word.endsWith(')')) {
        // tuple of 1 element
        return [parseStackElement(word.slice(1, -1), wordsNext)];
    } else if (word.startsWith('C{')) {
        // cell - push Cell type
        try {
            let cell = Cell.fromBoc(Buffer.from(word.slice(2, -1), 'hex'))[0];
            return cell;
        } catch (e) {
            console.error('Error parsing cell:', e);
            return word;
        }
    } else if (word.startsWith('Cont{')) {
        // continuation - Cell type
        try {
            let cell = Cell.fromBoc(Buffer.from(word.slice(5, -1), 'hex'))[0];
            return cell;
        } catch (e) {
            console.error('Error parsing continuation:', e);
            return word;
        }
    } else if (word.startsWith('CS{Cell{')) {
        // slice - Slice or Address type
        return sliceFromCanonical(word, wordsNext);
    } else if (word.startsWith('BC{')) {
        // builder - Builder type
        return builderFromCanonical(word.slice(3, -1));
    } else if (
        // slice appendix info
        word == 'bits:' ||
        word == 'refs:' ||
        word.indexOf('..') !== -1
    ) {
        return undefined;
    } else {
        try {
            // try parsing Integer
            return BigInt(word);
        } catch {
            // some unknown type
            // bad behavior
            console.warn('Unknown stack element:', word);
            return word;
        }
    }
}

export function parseStack(line: string): any[] {
    const stack: any[] = [];
    const words = line.split(' ');
    const stackStack: any[][] = [stack]; // Stack of stacks
    for (let i = 0; i < words.length; i++) {
        let word = words[i];

        // skip some basic info
        if (['stack:', '[', ']', ''].indexOf(word) !== -1) continue;

        // tuple starts as [ and ends as ] with no space
        // [10000000000000
        // 700000000000000]
        if (word.startsWith('[') && !word.startsWith('[  ')) {
            // tuple start
            const newStack: any[] = [];
            stackStack.push(newStack);
            word = word.slice(1);
        }
        let tupleEnd = false;
        if (word.endsWith(']') && !word.endsWith(' ]')) {
            tupleEnd = true;
            word = word.slice(0, -1);
        }

        let stackElement = parseStackElement(word, words.slice(i + 1));
        if (stackElement) stackStack[stackStack.length - 1].push(stackElement);
        if (tupleEnd) {
            const tuple = stackStack.pop();
            stackStack[stackStack.length - 1].push(tuple);
        }
    }

    return stack;
}
