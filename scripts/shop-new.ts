// pnpm shop:new <slug> [--name "Название"] — creates tenants/<slug>/ from the template,
// with temporary illustrated photos. The new shop is a sample until `pnpm shop:check` passes.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANTS } from './lib/tenants.ts';
import { makeSamplePhotos } from './make-sample-photos.ts';

const slug = process.argv[2];
const nameArg = process.argv.indexOf('--name');
const name = nameArg > 0 ? process.argv[nameArg + 1] : '';
if (!slug || !/^[a-z0-9-]{2,40}$/.test(slug)) {
  console.error('Использование: pnpm shop:new <название-латиницей> [--name "Название магазина"]\nНапример: pnpm shop:new roza --name "Роза ветров"');
  process.exit(1);
}
const dir = join(TENANTS, slug);
if (existsSync(dir)) {
  console.error(`Папка tenants/${slug} уже есть.`);
  process.exit(1);
}
cpSync(join(TENANTS, '_template'), dir, { recursive: true });
const file = join(dir, 'shop.json');
writeFileSync(file, readFileSync(file, 'utf8').replace(/__SLUG__/g, slug).replace(/__NAME__/g, name || slug));
const made = await makeSamplePhotos(slug);
console.log(`Создан магазин tenants/${slug}/ (образец).
  Временные фото: ${made.length}. Замените их своими в tenants/${slug}/photos/ (те же имена файлов или поправьте пути в shop.json).

Дальше:
  1. Заполните tenants/${slug}/shop.json: название, адрес, телефон, часы, букеты, owner.email.
  2. pnpm shop:check ${slug}     — проверка; после неё магазин принимает настоящие заказы
  3. pnpm shop:publish ${slug}   — база, бот и сайт; в конце будет ссылка /s/${slug}/
  4. pnpm shop:verify ${slug}    — проверка опубликованной ссылки на телефоне и компьютере`);
