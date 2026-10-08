import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Token } from '@astryxdesign/core/Token';
import { TextInput } from '@astryxdesign/core/TextInput';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Dialog } from '@astryxdesign/core/Dialog';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { PlusIcon } from '@phosphor-icons/react';
import { bouquetSchema, formatRub, zodIssues, type Bouquet } from '@domain';
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
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={520}>
      <VStack gap={4} padding={5}>
        <Heading level={2}>{isNew ? 'Новый товар' : `«${initial?.name}»`}</Heading>
        <SegmentedControl label="Что это" value={b.kind} onChange={(v) => setB({ ...b, kind: v as Bouquet['kind'] })}>
          <SegmentedControlItem value="bouquet" label="Букет" />
          <SegmentedControlItem value="card" label="Открытка" />
        </SegmentedControl>
        <TextInput label="Название" value={b.name} onChange={(v) => setB({ ...b, name: v })} isRequired />
        <TextArea label="Описание" value={b.description} onChange={(v) => setB({ ...b, description: v })} rows={3} />
        <HStack gap={3}>
          <NumberInput label="Цена, ₽" value={price} onChange={setPrice} hasClear isIntegerOnly min={1} isRequired />
          <NumberInput label="Остаток, шт." value={stock} onChange={setStock} hasClear isIntegerOnly min={0} description="Пусто — без учёта" />
        </HStack>
        {b.photo && !file ? <img className="thumb" src={media(b.photo)} alt="" /> : null}
        <FileInput label="Фото" accept="image/*" value={file} onChange={(f) => setFile(Array.isArray(f) ? f[0] ?? null : f)}
          description={b.photo ? 'Загрузите, чтобы заменить' : 'Квадратное фото смотрится лучше всего'} />
        <Switch label="В наличии" value={b.inStock} onChange={(v) => setB({ ...b, inStock: v })} />
        {error ? <Banner status="error" title={error} /> : null}
        <HStack gap={2} justify="end">
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
  const refresh = () => void qc.invalidateQueries({ queryKey: ['shop', slug] });
  const stock = useMutation({
    mutationFn: ({ b, inStock }: { b: Bouquet; inStock: boolean }) => ownerApi.setStock(shopId, b.id, inStock, inStock && b.stock === 0 ? null : b.stock),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (b: Bouquet) => ownerApi.deleteBouquet(shopId, b.id), onSuccess: () => { setDeleting(null); refresh(); } });
  return (
    <VStack gap={4}>
      <HStack gap={3} justify="between" vAlign="center">
        <Heading level={2}>Букеты, открытки и наличие</Heading>
        <Button label="Добавить товар" variant="primary" icon={<PlusIcon size={18} />} onClick={() => setEditing('new')} />
      </HStack>
      {stock.isError ? <Banner status="error" title={(stock.error as Error).message} /> : null}
      {shop.bouquets.map((b) => (
        <Card key={b.id} padding={4} data-testid={`owner-bouquet-${b.id}`}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <img className="thumb" src={media(b.photo)} alt="" />
            <VStack gap={0.5}>
              <Text weight="semibold">{b.name}{b.kind === 'card' ? ' ' : ''}</Text>
              {b.kind === 'card' ? <Token label="Открытка" color="pink" size="sm" /> : null}
              <Text color="secondary">{formatRub(b.price)}{b.stock !== null ? ` · остаток ${b.stock} шт.` : ''}</Text>
            </VStack>
            <HStack gap={2} vAlign="center" justify="end" wrap="wrap">
              <Switch label="В наличии" value={b.inStock} onChange={(v) => stock.mutate({ b, inStock: v })} data-testid={`stock-${b.id}`} />
              <Button label="Изменить" size="sm" onClick={() => setEditing(b)} />
              <Button label="Удалить" size="sm" variant="ghost" onClick={() => setDeleting(b)} />
            </HStack>
          </HStack>
        </Card>
      ))}
      {editing ? <BouquetDialog shopId={shopId} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      <AlertDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Удалить букет?"
        description={`«${deleting?.name ?? ''}» пропадёт с сайта. Уже оформленные заказы сохранятся.`}
        actionLabel="Удалить"
        actionVariant="destructive"
        isActionLoading={del.isPending}
        onAction={() => deleting && del.mutate(deleting)}
      />
    </VStack>
  );
}
