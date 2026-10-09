import { describe, expect, it } from 'vitest';
import { maskIp } from './mask';

describe('maskIp', () => {
    it('masks IPv4', () => expect(maskIp('192.168.4.20')).toBe('192.168.x.x'));
    it('masks IPv6', () => expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:x:x'));
    it('hides unknown values such as the mod placeholder', () => expect(maskIp('undefined')).toBe('hidden'));
});
