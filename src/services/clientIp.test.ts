import { describe, expect, it } from 'vitest';
import { normalizeIp, resolveClientIp } from './clientIp';

const h = (init: Record<string, string>) => new Headers(init);
const none = { mode: 'none', hops: 1 } as const;
const traefik = { mode: 'traefik', hops: 1 } as const;
const cloudflare = { mode: 'cloudflare', hops: 1 } as const;

describe('resolveClientIp', () => {
    it('ignores proxy headers when no proxy is configured', () => {
        expect(resolveClientIp(none, h({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' }), '10.0.0.5')).toBe('10.0.0.5');
    });

    it('uses CF-Connecting-IP for Cloudflare', () => {
        expect(resolveClientIp(cloudflare, h({ 'cf-connecting-ip': '203.0.113.9' }), '172.18.0.2')).toBe('203.0.113.9');
    });

    it('does not trust X-Forwarded-For in Cloudflare mode', () => {
        expect(resolveClientIp(cloudflare, h({ 'x-forwarded-for': '1.2.3.4' }), '172.18.0.2')).toBe('172.18.0.2');
    });

    it('takes the entry Traefik appended, not the client-supplied one', () => {
        expect(resolveClientIp(traefik, h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), '172.18.0.2')).toBe('203.0.113.9');
    });

    it('skips additional trusted hops', () => {
        const config = { mode: 'traefik', hops: 2 } as const;
        expect(resolveClientIp(config, h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 172.18.0.3' }), '172.18.0.2')).toBe('203.0.113.9');
    });

    it('falls back to the socket address on missing or invalid headers', () => {
        expect(resolveClientIp(traefik, h({}), '172.18.0.2')).toBe('172.18.0.2');
        expect(resolveClientIp(cloudflare, h({ 'cf-connecting-ip': 'not-an-ip' }), '172.18.0.2')).toBe('172.18.0.2');
        expect(resolveClientIp(traefik, h({ 'x-forwarded-for': '203.0.113.9' }), '172.18.0.2')).toBe('203.0.113.9');
        expect(resolveClientIp({ mode: 'traefik', hops: 3 }, h({ 'x-forwarded-for': '203.0.113.9' }), '172.18.0.2')).toBe('172.18.0.2');
    });
});

describe('normalizeIp', () => {
    it('keeps IPv4 and unwraps mapped addresses', () => {
        expect(normalizeIp('203.0.113.9')).toBe('203.0.113.9');
        expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    });

    it('collapses IPv6 to its /64', () => {
        expect(normalizeIp('2001:db8:85a3:1:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:85a3:1::/64');
        expect(normalizeIp('2001:0db8::1')).toBe('2001:db8:0:0::/64');
        expect(normalizeIp('2001:db8:0:0:1::7')).toBe('2001:db8:0:0::/64');
    });
});
