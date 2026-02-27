import pino from 'pino';
import { env } from '@/config/env';

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  redact: {
    // Never log PII
    paths: ['*.email', '*.phone', '*.test_email', '*.test_phone', 'req.body.test_email', 'req.body.test_phone'],
    censor: '[REDACTED]',
  },
});

export default logger;
