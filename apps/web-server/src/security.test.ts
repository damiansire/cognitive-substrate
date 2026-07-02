import { describe, it, expect } from 'vitest';
import {
    resolveHost,
    resolveAllowedOrigins,
    corsHeaders,
    requireTokenAuth,
    isAuthorizedPost
} from './security';

describe('resolveHost', () => {
    it('defaults to loopback', () => {
        expect(resolveHost({})).toBe('127.0.0.1');
    });
    it('honors WEB_SERVER_HOST when set', () => {
        expect(resolveHost({ WEB_SERVER_HOST: '0.0.0.0' })).toBe('0.0.0.0');
        expect(resolveHost({ WEB_SERVER_HOST: '   ' })).toBe('127.0.0.1');
    });
});

describe('resolveAllowedOrigins', () => {
    it('defaults to the Angular dev origins, never *', () => {
        const origins = resolveAllowedOrigins({});
        expect(origins).toContain('http://localhost:4200');
        expect(origins).not.toContain('*');
    });
    it('parses a comma-separated override', () => {
        expect(resolveAllowedOrigins({ WEB_SERVER_ALLOWED_ORIGINS: 'http://a:1, http://b:2' })).toEqual([
            'http://a:1',
            'http://b:2'
        ]);
    });
});

describe('corsHeaders', () => {
    const allowed = ['http://localhost:4200'];
    it('reflects an allowlisted origin', () => {
        expect(corsHeaders('http://localhost:4200', allowed)['Access-Control-Allow-Origin']).toBe(
            'http://localhost:4200'
        );
    });
    it('does NOT set ACAO for a foreign origin (no wildcard leak)', () => {
        const headers = corsHeaders('http://evil.example', allowed);
        expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
        expect(Object.values(headers)).not.toContain('*');
    });
    it('omits ACAO when there is no Origin header', () => {
        expect(corsHeaders(undefined, allowed)['Access-Control-Allow-Origin']).toBeUndefined();
    });
});

describe('requireTokenAuth / isAuthorizedPost', () => {
    it('auth disabled when no token configured: POST passes', () => {
        expect(requireTokenAuth({})).toBeNull();
        expect(isAuthorizedPost('POST', undefined, null)).toBe(true);
    });
    it('with a token, POST requires the matching x-csos-token header', () => {
        const token = requireTokenAuth({ WEB_SERVER_TOKEN: 's3cret' });
        expect(token).toBe('s3cret');
        expect(isAuthorizedPost('POST', 's3cret', token)).toBe(true);
        expect(isAuthorizedPost('POST', 'wrong', token)).toBe(false);
        expect(isAuthorizedPost('POST', undefined, token)).toBe(false);
    });
    it('GET/OPTIONS are never gated by the token', () => {
        expect(isAuthorizedPost('GET', undefined, 's3cret')).toBe(true);
        expect(isAuthorizedPost('OPTIONS', undefined, 's3cret')).toBe(true);
    });
});
