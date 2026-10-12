import { describe, expect, it } from 'vitest';
import { discordProfileToUser } from './authProfile';

describe('discordProfileToUser', () => {
    it('preserves an email returned by Discord', () => {
        expect(discordProfileToUser({ id: '12345678901234567', email: 'user@example.com' })).toEqual({
            email: 'user@example.com',
        });
    });

    it('uses a stable placeholder when Discord omits email', () => {
        expect(discordProfileToUser({ id: '12345678901234567', email: null })).toEqual({
            email: '12345678901234567@discord.invalid',
        });
        expect(discordProfileToUser({ id: '12345678901234567' })).toEqual({
            email: '12345678901234567@discord.invalid',
        });
    });
});