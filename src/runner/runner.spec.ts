import { Address } from '@ton/core';
import { getEmulationWithStack, waitForRateLimit } from './runner';
import { AccountFromAPI } from './types';
import { linkToTx, mcSeqnoByShard, txToLinks } from './utils';

describe('Converter', () => {
    const justHash =
        '3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b';
    const toncx =
        'https://ton.cx/tx/47670702000009:Pl9JeY3iOdpdj4C03DACBNN2E+QgOj97h3wEqIyBhWs=:EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_';
    const tonviewer =
        'https://tonviewer.com/transaction/3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b';
    const tonscan =
        'https://tonscan.org/tx/Pl9JeY3iOdpdj4C03DACBNN2E+QgOj97h3wEqIyBhWs=';
    const toncoin =
        'https://explorer.toncoin.org/transaction?account=EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_&lt=47670702000009&hash=3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b';
    const ltHash =
        '47670702000009:3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b';

    const linkZoo = [toncx, tonscan, tonviewer, toncoin, ltHash];

    let ex: { lt: bigint; hash: Buffer; addr: Address };
    it('should convert just hash to tx', async () => {
        ex = await linkToTx(justHash, false);
        expect(ex.lt).toBe(47670702000009n);
        expect(ex.hash.toString('base64')).toBe(
            'Pl9JeY3iOdpdj4C03DACBNN2E+QgOj97h3wEqIyBhWs='
        );
        expect(ex.addr.toString()).toBe(
            'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_'
        );
    });
    it('should convert toncx', async () => {
        const res = await linkToTx(toncx, false);
        expect(res.lt).toBe(ex.lt);
        expect(res.hash.equals(ex.hash)).toBe(true);
        expect(res.addr.equals(ex.addr)).toBe(true);
    });
    it('should convert tonscan', async () => {
        await waitForRateLimit();
        const res = await linkToTx(tonscan, false);
        expect(res.lt).toBe(ex.lt);
        expect(res.hash.equals(ex.hash)).toBe(true);
        expect(res.addr.equals(ex.addr)).toBe(true);
    });
    it('should convert tonviewer', async () => {
        await waitForRateLimit();
        const res = await linkToTx(tonviewer, false);
        expect(res.lt).toBe(ex.lt);
        expect(res.hash.equals(ex.hash)).toBe(true);
        expect(res.addr.equals(ex.addr)).toBe(true);
    });
    it('should convert toncoin', async () => {
        await waitForRateLimit();
        const res = await linkToTx(toncoin, false);
        expect(res.lt).toBe(ex.lt);
        expect(res.hash.equals(ex.hash)).toBe(true);
        expect(res.addr.equals(ex.addr)).toBe(true);
    });
    it('should convert lt:hash', async () => {
        await waitForRateLimit();
        const res = await linkToTx(ltHash, false);
        expect(res.lt).toBe(ex.lt);
        expect(res.hash.equals(ex.hash)).toBe(true);
        expect(res.addr.equals(ex.addr)).toBe(true);
    });

    it('should convert tx to a link', () => {
        const reverseEx = txToLinks(ex, false);
        let i = 0;
        for (let [_, link] of Object.entries(reverseEx)) {
            expect(linkZoo[i] == link);
            i++;
        }
    });

    it('should get mc block by shard block', async () => {
        const res = await mcSeqnoByShard(
            {
                workchain: 0,
                seqno: 41917556,
                shard: '-9223372036854775808',
                rootHash: 'MHnWHKLB8ljiAn7hYlqxIGdb92upgg57Kffxgf2EqBg=',
                fileHash: '16ll3S16/iv63Ins6npGQa6sIPJUhoJG6O719AqyMkA=',
            },
            false
        );
        expect(res.mcSeqno).toBe(36109845);
    });
});

describe('Runner', () => {
    const withLibs =
        'https://ton.cx/tx/47769590000001:TfGC2E6eG7522c/jW9AjwkTFWwPL0RhFd2mGiqLoW/Q=:EQC39c119oqPkaB-fiA8_EKfejP24_IyKCNEyKFUsvXsfIHe';
    const withLibsInInit =
        'https://ton.cx/tx/47769594000001:9kxqPN8/rR14aqz5phMPGPP3butxKU9Tu9gSrTcD5wo=:EQBS_eklJ4OyxzqOzF8Rcbt2XSo-3Ync7M07ldDpyrnciE9q';

    const first =
        'https://ton.cx/tx/44640875000007:53bLbTDYoHiBHGJPz2/oGr1JvJ/SS7iVVeMTUi5PYpw=:EQCtJGu1Q5xptmRFuP16M2w01QValw3V8IiyxQczAf83YITE';
    const txs = [
        'https://ton.cx/tx/44640875000009:Qr6Sk402c4P9MdDet8gls55XtEY4F5f9bu/+a1R8OeM=:EQAQLH1TEIky4m4rBMSMeQPyH4EpdY0hCiW9ANV3RVdjHVlL',
        'https://ton.cx/tx/46297687000029:NtikSmtqwpa8lHJ3hcII2b5ABO0vYfj8WjXGEVRrzEE=:EQAeIJYcjNVj_BuYbExL6TQf4HuB-y0X5h6zbp_EqU2hkcBY',
        'https://ton.cx/tx/46439288000029:HuT+ZvaC9pxRwPsBety3ryxqLKLBnK2m1bhtrTFHotE=:EQARULUYsmJq1RiZ-YiH-IJLcAZUVkVff-KBPwEmmaQGH6aC',
        'https://ton.cx/tx/46297691000013:J4QuZroDoUmda3xrOc3fzcoQmVV+H0y6jFeJPj1vgpc=:EQCVervJ0JDFlSdOsPos17zHdRBU-kHHl09iXOmRIW-5lwXW',
        'https://ton.cx/tx/46297691000043:k5Qiv26jRKHDVZDG9d0UwQQLypOv3niXGWrC+dkF/yY=:EQCVervJ0JDFlSdOsPos17zHdRBU-kHHl09iXOmRIW-5lwXW',
        'https://ton.cx/tx/43546193000009:eiNquL3saa5GwCpRQt/g3EW/A7MGB8X4j9+G2uuOOTs=:EQCVervJ0JDFlSdOsPos17zHdRBU-kHHl09iXOmRIW-5lwXW',
        'https://ton.cx/tx/46377254000059:Rxo19xHNE/Y3n7mMY4X8QlrgpDFtXEAHTMp2/PsPdKw=:EQCVervJ0JDFlSdOsPos17zHdRBU-kHHl09iXOmRIW-5lwXW',
        'https://ton.cx/tx/47503361000001:7iu3qxZyLbMNW37IeBVen1uUvk6sKu2TR3VZzOq9Opw=:EQAHuH6nuGelNriOcLp8N0OmaGu2twuhpI7WOcKCTCfWzwrM',
        'https://ton.cx/tx/47503434000003:746KHFb1Vt2ak1TW5lBrLv4E+N2Wh67O9THSYeLaa1Y=:EQCkWxfyhAkim3g2DjKQQg8T5P4g-Q1-K_jErGcDJZ4i-vqR',
    ];
    const txsWithRandom = [
        'https://ton.cx/tx/44345021000003:nTQg5soXgJsk57q/F6toSy2XZRR7YPo0gQAGxkOOs3k=:EQBGhm8bNil8tw4Z2Ekk4sKD-vV-LCz7BW_qIYCEjZpiMF6Q',
        'https://ton.cx/tx/46843694000003:uOHmclA04YxzjqMWcIWH6+kQ38izn62U8nyFNdqR0nw=:EQA--JhKKuYfb-WAw7vDWEfD4fg2WOt9AuLH6xHPvF0RTUNA',
        'https://ton.cx/tx/46843694000021:nwjPEIK88JGyPRLFVzNYHKkBb62OyVSgZKuU6J0mLC0=:EQA--JhKKuYfb-WAw7vDWEfD4fg2WOt9AuLH6xHPvF0RTUNA',
    ];

    it('should emulate with libs', async () => {
        await waitForRateLimit();
        const res = await getEmulationWithStack(withLibs, false);
        expect(res.stateUpdateHashOk).toBe(true);
    });
    it('should emulate with libs in init', async () => {
        await waitForRateLimit();
        const res = await getEmulationWithStack(withLibsInInit, false);
        expect(res.stateUpdateHashOk).toBe(true);
    });

    it('should emulate first tx', async () => {
        await waitForRateLimit();
        const res = await getEmulationWithStack(first, false);
        expect(res.stateUpdateHashOk).toBe(true);
        expect(res.lt).toBe(44640875000007n);
        expect(res.computeInfo).not.toBe('skipped');
        if (res.computeInfo == 'skipped') return;
        res.computeLogs.forEach((log) => {
            expect(log.instruction).not.toBe('unknown instruction');
        });
        expect(res.computeLogs.length).toBe(res.computeInfo.vmSteps - 1);
    });

    it('should emulate other txs', async () => {
        for (let tx of txs) {
            await waitForRateLimit();
            const res = await getEmulationWithStack(tx, false);
            expect(res.stateUpdateHashOk).toBe(true);
            // if (res.computeInfo !== 'skipped')
            //     expect(res.computeLogs.length).toBe(
            //         res.computeInfo.vmSteps - 1
            //     );
        }
    });

    it('should emulate txs with random', async () => {
        for (let tx of txsWithRandom) {
            await waitForRateLimit();
            const res = await getEmulationWithStack(tx, false);
            expect(res.stateUpdateHashOk).toBe(true);
            if (res.computeInfo !== 'skipped')
                expect(res.computeInfo.success).toBe(true);
        }
    });
});
