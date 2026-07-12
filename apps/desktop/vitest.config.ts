import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@livedocs/desktop',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
