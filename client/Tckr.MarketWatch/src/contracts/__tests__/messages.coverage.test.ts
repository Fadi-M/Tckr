import { describe, expect, it } from 'vitest';
import { parseServerMessage } from '../messages.ts';
import {
  ALL_ERROR_CODES,
  ALL_SERVER_MESSAGE_TYPES,
  FIXTURES,
  SERVER_MESSAGE_FIXTURE_NAMES,
} from '../fixtures/index.ts';

const parsedFixtures = SERVER_MESSAGE_FIXTURE_NAMES.map((name) =>
  parseServerMessage(JSON.stringify(FIXTURES[name])),
);

describe('fixture coverage', () => {
  it.each(ALL_SERVER_MESSAGE_TYPES)('has at least one fixture for message type "%s"', (type) => {
    const matches = parsedFixtures.filter((message) => message.type === type);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it.each(ALL_ERROR_CODES)('has at least one fixture for error code "%s"', (code) => {
    const matches = parsedFixtures.filter(
      (message) => message.type === 'error' && message.code === code,
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
