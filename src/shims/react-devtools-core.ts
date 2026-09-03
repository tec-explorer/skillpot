// react-devtools-core 的空壳替身：ink 仅在 DEV 环境变量下加载 devtools，
// 构建时通过 esbuild --alias 指到本文件，避免引入重依赖。
const devtools = {};

export default devtools;
