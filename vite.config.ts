import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import checker from 'vite-plugin-checker';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
};

// The plugin is loaded by the Signal K server, not shipped to a browser, so
// node built-ins and the runtime dependencies stay external and resolve from
// node_modules at runtime.
export default defineConfig({
  // NFL logs the plugin version with every upload. The source cannot read
  // package.json relative to itself: the bundle sits one directory deeper
  // than the source module that reads it.
  define: {
    __PLUGIN_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'node22',
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rolldownOptions: {
      external: [/^node:/, ...Object.keys(pkg.dependencies)],
    },
    sourcemap: true,
    minify: false,
  },
  // vite transpiles without typechecking; checker fails the build on a type
  // error. Skipped under test, where the suite is what is being run.
  plugins: [
    dts({ tsconfigPath: './tsconfig.json' }),
    ...(process.env.VITEST ? [] : [checker({ typescript: true })]),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      exclude: ['src/**/*.d.ts', 'src/types/**', 'test/**'],
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
