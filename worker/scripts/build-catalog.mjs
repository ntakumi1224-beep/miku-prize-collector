import {readFile, writeFile} from 'node:fs/promises';
const data = JSON.parse(await readFile(new URL('../../products.json', import.meta.url), 'utf8'));
if(!Array.isArray(data.items) || data.items.length !== data.count || new Set(data.items.map(x => x.id)).size !== data.items.length) throw new Error('Invalid product catalog');
const items = data.items.map(({id, maker, name, date, outfit, form, series, note}) => ({id, maker, name, date, outfit, form, series, note}));
await writeFile(new URL('../src/catalog.json', import.meta.url), JSON.stringify({database_updated:data.database_updated, items}));
console.log(`Catalog built: ${items.length} products`);
