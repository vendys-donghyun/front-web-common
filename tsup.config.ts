import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'auth/index': 'src/auth/index.ts',
  },
  format: ['esm', 'cjs'], // TODO - 추후 cjs 제거
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es5',
  noExternal: ['jwt-decode', 'jsencrypt'],
  outDir: 'dist',
  outExtension: ({ format }) => ({
    js: format === 'esm' ? '.mjs' : '.cjs'
  })
});
