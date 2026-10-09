import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Selector } from '@astryxdesign/core/Selector';
import { Grid } from '@astryxdesign/core/Grid';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { PlusIcon } from '@phosphor-icons/react';
import { bouquetSchema, CATEGORIES, formatRub, zodIssues, type Bouquet } from '@domain';
import { bouquetIdFromName } from '@server/telegram.ts';
import { useShop } from '../../lib/shop';
import { ApiError } from '../../lib/api';
import { ownerApi, uploadPhoto } from './ownerApi';

const EMPTY: Bouquet = { kind: 'bouquet', id: '', name: '', description: '', price: 0, photo: '', inStock: true, stock: null, sort: 100 };

function BouquetDialog({ shopId, initial, onClose }: { shopId: string; initial: Bouquet | null; onClose: () => void }) {
  const { media, slug } = useShop();
  const qc = useQueryClient();
  const isNew = !initial?.id;
  const [b, setB] = useState<Bouquet>(initial ?? EMPTY);
  const [price, setPrice] = useState<number | null>(initial?.price ?? null);
  const [stock, setStock] = useState<number | null>(initial?.stock ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      let photo = b.photo;
      if (file) photo = await uploadPhoto(shopId, 'bouquets', file);
      const candidate = {
        ...b, photo, id: b.id || bouquetIdFromName(b.name),
        price: price ?? 0, stock,
      };
      const parsed = bouquetSchema.safeParse(candidate);
      if (!parsed.success) throw new ApiError('invalid_input', zodIssues(parsed.error).join('; '));
      return ownerApi.saveBouquet(shopId, parsed.data);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['shop', slug] }); onClose(); },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={560} maxHeight="calc(100dvh - 2 * var(--spacing-4))" purpose="form" padding={5}>
      <VStack className="sheet" data-testid="product-dialog">
        <DialogHeader title={isNew ? 'Новый товар' : `«${initial?.name}»`} onOpenChange={(o) => !o && onClose()} />
        <VStack gap={4} paddingBlock={4} className="sheet__body">
          <Selector label="Раздел каталога" value={b.kind} presentation="adaptive"
            options={CATEGORIES.map((c) => ({ value: c.kind, label: c.title }))}
            onChange={(v) => setB({ ...b, kind: v as Bouquet['kind'] })} />
          <TextInput label="Название" value={b.name} onChange={(v) => setB({ ...b, name: v })} isRequired />
          <TextArea label="Описание" value={b.description} onChange={(v) => setB({ ...b, description: v })} rows={3} />
          <Grid columns={{ minWidth: 200 }} gap={3}>
            <NumberInput label="Цена, ₽" value={price} onChange={setPrice} hasClear isIntegerOnly min={1} isRequired />
            <NumberInput label="Остаток, шт." value={stock} onChange={setStock} hasClear isIntegerOnly min={0} description="Пусто — без учёта" />
          </Grid>
          {b.photo && !file ? <img className="thumb" src={media(b.photo)} alt="" /> : null}
          <FileInput label="Фото" accept="image/*" width="100%" value={file} onChange={(f) => setFile(Array.isArray(f) ? f[0] ?? null : f)}
            description={b.photo ? 'Загрузите, чтобы заменить' : 'Квадратное фото смотрится лучше всего'} />
          <Switch label="В наличии" value={b.inStock} onChange={(v) => setB({ ...b, inStock: v })} />
          {error ? <Banner status="error" title={error} /> : null}
        </VStack>
        <HStack gap={2} justify="end" paddingBlockStart={4} className="sheet__footer">
          <Button label="Отмена" onClick={onClose} />
          <Button label="Сохранить" variant="primary" isLoading={save.isPending} onClick={() => { setError(null); save.mutate(); }} />
        </HStack>
      </VStack>
    </Dialog>
  );
}

export default function AdminBouquets({ shopId }: { shopId: string }) {
  const { shop, slug, media } = useShop();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Bouquet | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Bouquet | null>(null);
  const [filter, setFilter] = useState<'all' | Bouquet['kind']>('all');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['shop', slug] });
  const stock = useMutation({
    mutationFn: ({ b, inStock }: { b: Bouquet; inStock: boolean }) => ownerApi.setStock(shopId, b.id, inStock, inStock && b.stock === 0 ? null : b.stock),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (b: Bouquet) => ownerApi.deleteBouquet(shopId, b.id), onSuccess: () => { setDeleting(null); refresh(); } });
  return (
    <VStack gap={4}>
      <HStack gap={3} justify="between" vAlign="center">
        <Heading level={2}>Товары и наличие</Heading>
        <Button label="Добавить товар" variant="primary" icon={<PlusIcon size={18} />} onClick={() => setEditing(filter === 'all' ? 'new' : { ...EMPTY, kind: filter })} />
      </HStack>
      {stock.isError ? <Banner status="error" title={(stock.error as Error).message} /> : null}
      <nav className="cat-tabs" aria-label="Разделы товаров">
        <HStack gap={1.5} className="chip-row">
          <button type="button" className="cat-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            Все<span className="cat-chip__count">{shop.bouquets.length}</span>
          </button>
          {CATEGORIES.map((c) => (
            <button key={c.kind} type="button" className="cat-chip" aria-pressed={filter === c.kind} onClick={() => setFilter(c.kind)} data-testid={`owner-filter-${c.slug}`}>
              {c.title}<span className="cat-chip__count">{shop.bouquets.filter((b) => b.kind === c.kind).length}</span>
            </button>
          ))}
        </HStack>
      </nav>
      {CATEGORIES.filter((c) => filter === 'all' || filter === c.kind).map((c) => {
        const list = shop.bouquets.filter((b) => b.kind === c.kind);
        return (
          <VStack key={c.kind} gap={3} data-testid={`owner-section-${c.slug}`}>
            <HStack gap={3} justify="between" vAlign="center">
              <Heading level={3}>{c.title}</Heading>
              <Button label="Добавить" size="sm" variant="ghost" icon={<PlusIcon size={16} />} onClick={() => setEditing({ ...EMPTY, kind: c.kind })} />
            </HStack>
            {list.length ? list.map((b) => (
              <Card key={b.id} padding={4} data-testid={`owner-bouquet-${b.id}`}>
                <HStack gap={3} vAlign="center" wrap="wrap">
                  <img className="thumb" src={media(b.photo)} alt="" />
                  <VStack gap={0.5}>
                    <Text weight="semibold">{b.name}</Text>
                    <Text color="secondary">{formatRub(b.price)}{b.stock !== null ? ` · остаток ${b.stock} шт.` : ''}</Text>
                  </VStack>
                  <HStack gap={2} vAlign="center" justify="end" wrap="wrap">
                    <Switch label="В наличии" value={b.inStock} onChange={(v) => stock.mutate({ b, inStock: v })} data-testid={`stock-${b.id}`} />
                    <Button label="Изменить" size="sm" onClick={() => setEditing(b)} />
                    <Button label="Удалить" size="sm" variant="ghost" onClick={() => setDeleting(b)} />
                  </HStack>
                </HStack>
              </Card>
            )) : <Text color="secondary">Пока пусто. Нажмите «Добавить», чтобы завести первый товар в этом разделе.</Text>}
          </VStack>
        );
      })}
      {editing ? <BouquetDialog shopId={shopId} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      <AlertDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Удалить товар?"
        description={`«${deleting?.name ?? ''}» пропадёт с сайта. Уже оформленные заказы сохранятся.`}
        actionLabel="Удалить"
        actionVariant="destructive"
        isActionLoading={del.isPending}
        onAction={() => deleting && del.mutate(deleting)}
      />
    </VStack>
  );
}
