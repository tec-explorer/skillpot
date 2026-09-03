// 版本号单一来源:运行时从 package.json 读取(仓库内取项目根,发布包内取包根)。
// 不直接 import package.json:它位于 rootDir 之外,且 esbuild 会把它内联进产物;
// 也不用 createRequire——构建 banner 已声明同名标识符,会重复声明冲突。
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export const VERSION: string = pkg.version;
