import { decodeHeaders, encodeHeaders } from './header-codec';

describe('header codec', () => {
  it('decodes Buffer and string values to utf8 strings', () => {
    const decoded = decodeHeaders({
      'x-trace-id': Buffer.from('abc123'),
      'x-service-name': 'order-service',
    });
    expect(decoded).toEqual({ 'x-trace-id': 'abc123', 'x-service-name': 'order-service' });
  });

  it('drops undefined and array values', () => {
    const decoded = decodeHeaders({
      keep: 'yes',
      gone: undefined,
      multi: ['a', 'b'],
    });
    expect(decoded).toEqual({ keep: 'yes' });
  });

  it('handles missing headers', () => {
    expect(decodeHeaders(undefined)).toEqual({});
  });

  it('round-trips through encode', () => {
    const headers = { 'x-trace-id': 'abc', traceparent: '00-x-y-01' };
    expect(decodeHeaders(encodeHeaders(headers))).toEqual(headers);
  });
});
