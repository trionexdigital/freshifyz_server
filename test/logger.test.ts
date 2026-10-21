import { logger } from '../src/server/utils/logger';

test('logging drops raw errors, bodies, tokens, headers, and query strings', () => {
  const output = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    logger.info('request_complete', { requestId: 'test', statusCode: 200, password: 'sensitive',
      body: { password: 'sensitive' }, token: 'sensitive', headers: { authorization: 'sensitive' }, url: '?secret=sensitive' });
    expect(output.mock.calls[0]![0]).not.toContain('sensitive');
    expect(JSON.parse(output.mock.calls[0]![0])).toMatchObject({ service: 'freshifyz', requestId: 'test', statusCode: 200 });
  } finally { output.mockRestore(); }
});
