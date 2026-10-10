import { describe, expect, it } from 'vitest';
import { makeTokenBuckets } from './rateLimit';

const setup = (capacity = 3, refillPerSecond = 1) => {
    let t = 0;
    const buckets = makeTokenBuckets({ capacity, refillPerSecond }, () => t);
    return { buckets, advance: (ms: number) => (t += ms) };
};

describe('token buckets', () => {
    it('allows a burst up to capacity, then reports a retry delay', () => {
        const { buckets } = setup();
        expect([1, 2, 3].map(() => buckets.consume('a'))).toEqual([0, 0, 0]);
        expect(buckets.consume('a')).toBe(1);
    });

    it('refills over time and never beyond capacity', () => {
        const { buckets, advance } = setup();
        for (let i = 0; i < 3; i++) buckets.consume('a');
        advance(1000);
        expect(buckets.consume('a')).toBe(0);
        expect(buckets.consume('a')).toBeGreaterThan(0);
        advance(60_000);
        expect([1, 2, 3].map(() => buckets.consume('a'))).toEqual([0, 0, 0]);
        expect(buckets.consume('a')).toBeGreaterThan(0);
    });

    it('limits keys independently', () => {
        const { buckets } = setup(1);
        expect(buckets.consume('a')).toBe(0);
        expect(buckets.consume('a')).toBeGreaterThan(0);
        expect(buckets.consume('b')).toBe(0);
    });

    it('rounds the retry delay up for slow refill rates', () => {
        const { buckets } = setup(1, 0.1);
        buckets.consume('a');
        expect(buckets.consume('a')).toBe(10);
    });

    it('does not let rejected calls extend the wait', () => {
        const { buckets, advance } = setup(1, 1);
        buckets.consume('a');
        for (let i = 0; i < 5; i++) buckets.consume('a');
        advance(1000);
        expect(buckets.consume('a')).toBe(0);
    });
});
