import { Address, BitReader, BitString, Builder, Cell, Slice } from '@ton/core';
import { StackElement } from './types';

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
    } else if (word.startsWith('CS{Cell{')) {
        // slice - push Slice type (but no refs)
        let buffer = Buffer.from(word.slice(8), 'hex');
        buffer = buffer.subarray(2); // skip 2 bytes
        // `311..578;` -> 311 - offset, 578 - len

        // bits: 0..400; refs: 0..2}
        const bitsStr = wordsNext[1];
        const refsStr = wordsNext[3];

        const offsetAndLen = bitsStr.split('..');
        const offset = Number(offsetAndLen[0]);
        const len = Number(offsetAndLen[1].slice(0, -1));
        const bitsAvailable = len - offset;

        const refsOffsetAndLen = refsStr.split('..');
        const refsOffset = Number(refsOffsetAndLen[0]);
        const refsLen = Number(refsOffsetAndLen[1].slice(0, -1));
        console.log('refsOffset:', refsOffset, 'refsLen:', refsLen);
        const refsAvailable = refsLen - refsOffset;

        const bs = new BitString(buffer, 0, len);
        const br = new BitReader(bs, offset);
        let fakeRefs = [];
        for (let i = 0; i < refsAvailable; i++) {
            fakeRefs.push(Cell.EMPTY);
        }
        let slice = new Slice(br, [...fakeRefs]);
        slice = slice.asCell().asSlice();

        // try parse address
        if (slice.remainingBits == 267) {
            try {
                const addr = slice.loadAddress();
                // console.log('Parsed address:', addr.toString());
                return addr;
            } catch (e) {
                // console.log('Error parsing address:', e);
            }
        }
        return slice;
    } else if (
        word == 'bits:' ||
        word == 'refs:' ||
        word.indexOf('..') !== -1
    ) {
        return undefined;
    } else if (word.startsWith('BC{')) {
        // builder - push Builder type
        let buffer = Buffer.from(word.slice(3, -1), 'hex');
        // skip 2 bytes
        buffer = buffer.subarray(2);
        let builder = new Builder();
        builder.storeBuffer(buffer);
        return builder;
    } else if (word.startsWith('Cont{')) {
        // continuation - push Cell type
        try {
            let cell = Cell.fromBoc(Buffer.from(word.slice(5, -1), 'hex'))[0];
            return cell;
        } catch (e) {
            console.error('Error parsing continuation:', e);
            return word;
        }
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
