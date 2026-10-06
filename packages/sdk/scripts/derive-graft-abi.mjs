// Menurunkan graftVaultAbi dari spurVaultAbi di src/abis.ts bila solc tidak tersedia.
// Dasar: diff GraftVault.sol vs SpurVault.sol (nama dinormalkan) menunjukkan antarmuka publik identik,
// kecuali `UNDERLYING()` (view baru) dan nama argumen constructor (`premium_` -> `underlying_`, tipe tetap address).
// Jalankan `npm run gen:abis` dengan solc terpasang untuk menimpa blok ini dengan hasil kompilasi sebenarnya.
import fs from 'node:fs';
const file = new URL('../src/abis.ts', import.meta.url).pathname;
let src = fs.readFileSync(file, 'utf8');
if (src.includes('export const graftVaultAbi')) { console.log('graftVaultAbi sudah ada'); process.exit(0); }
const m = src.match(/export const spurVaultAbi = (\[[\s\S]*?\n\]) as const;/);
if (!m) throw new Error('spurVaultAbi tidak ditemukan');
const abi = JSON.parse(m[1]);
const ctor = abi.find((x) => x.type === 'constructor');
const p = ctor.inputs.find((i) => i.name === 'premium_');
if (!p) throw new Error('constructor Spur tidak punya premium_');
p.name = 'underlying_';
const i = abi.findIndex((x) => x.type === 'function' && x.name === 'PREMIUM');
abi.splice(i + 1, 0, { type: 'function', name: 'UNDERLYING', inputs: [], outputs: [{ name: '', type: 'address', internalType: 'contract IERC20' }], stateMutability: 'view' });
src += '\n// DITURUNKAN dari spurVaultAbi oleh scripts/derive-graft-abi.mjs (solc tidak tersedia saat ditulis). Timpa dengan `npm run gen:abis`.\nexport const graftVaultAbi = ' + JSON.stringify(abi, null, 2) + ' as const;\n';
fs.writeFileSync(file, src);
console.log('graftVaultAbi ditulis,', abi.length, 'entri');
