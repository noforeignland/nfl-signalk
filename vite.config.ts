import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import checker from 'vite-plugin-checker';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
};

const builtins = new Set(builtinModules);
const dependencies = Object.keys(pkg.dependencies);

// The plugin is loaded by the Signal K server, not shipped to a browser, so
// node built-ins and the runtime dependencies stay external and resolve from
// node_modules at runtime. Vite builds for the browser by default and would
// otherwise replace a built-in imported without the `node:` prefix with a
// stub that only fails when the plugin runs.
const isExternal = (id: string): boolean =>
  id.startsWith('node:') ||
  builtins.has(id) ||
  dependencies.some((dep) => id === dep || id.startsWith(`${dep}/`));

export default defineConfig({
  // NFL logs the plugin version with every upload. A path to package.json
  // relative to the module would differ between the source (src/lib/) and
  // the bundle (dist/index.js), so the version is inlined at build time.
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
      external: isExternal,
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
