import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { useTelInput } from '../../components/useTelInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Switch } from '@astryxdesign/core/Switch';
import { FileInput } from '@astryxdesign/core/FileInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Token } from '@astryxdesign/core/Token';
import { Banner } from '@astryxdesign/core/Banner';
import { formatPhone, shopSettingsSchema, WEEKDAYS, WEEKDAY_LABELS, zodIssues, type ShopSettings } from '@domain';
import { useShop } from '../../lib/shop';
import { uploadPhoto, ownerApi } from './ownerApi';


export default function AdminShop({ shopId }: { shopId: string }) {
  const { shop, slug, media } = useShop();
  const qc = useQueryClient();
  const [s, setS] = useState<ShopSettings>(() => ({ ...shop.settings, phone: formatPhone(shop.settings.phone) }));
  const [fee, setFee] = useState<number | null>(shop.settings.delivery.fee);
  const [freeFrom, setFreeFrom] = useState<number | null>(shop.settings.delivery.freeFrom);
  const [cancelHours, setCancelHours] = useState<number | null>(shop.settings.cancel.untilMinutesBefore / 60);
  const phoneRef = useTelInput();
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [newDayOff, setNewDayOff] = useState<string | undefined>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof ShopSettings>(k: K, v: ShopSettings[K]) => setS((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const next: ShopSettings = {
        ...s,
        logo: logoFile ? await uploadPhoto(shopId, 'brand', logoFile) : s.logo,
        heroPhoto: heroFile ? await uploadPhoto(shopId, 'brand', heroFile) : s.heroPhoto,
        delivery: { ...s.delivery, fee: fee ?? 0, freeFrom },
        cancel: { ...s.cancel, untilMinutesBefore: Math.round((cancelHours ?? 0) * 60) },
      };
      const parsed = shopSettingsSchema.safeParse(next);
      if (!parsed.success) throw new Error(zodIssues(parsed.error).join('\n'));
      return ownerApi.saveSettings(shopId, parsed.data);
    },
    onSuccess: (saved) => {
      setS({ ...saved, phone: formatPhone(saved.phone) });
      setLogoFile(null);
      setHeroFile(null);
      void qc.invalidateQueries({ queryKey: ['shop', slug] });
      setMsg({ ok: true, text: 'Сохранено — изменения уже на сайте.' });
    },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });

  return (
    <VStack gap={4}>
      <Card padding={5} elevation="low">
        <VStack gap={3}>
          <Heading level={2}>Основное</Heading>
          <TextInput label="Название" value={s.name} onChange={(v) => set('name', v)} />
          <TextInput label="Короткое описание" value={s.tagline} onChange={(v) => set('tagline', v)} />
          <TextArea label="О магазине" value={s.description} onChange={(v) => set('description', v)} rows={3} />
          <TextInput label="Адрес" value={s.address} onChange={(v) => set('address', v)} />
          <TextInput label="Ссылка на карту" value={s.mapUrl} onChange={(v) => set('mapUrl', v)} isOptional />
          <TextInput ref={phoneRef} label="Телефон" value={s.phone} onChange={(v) => set('phone', v)} />
          <HStack gap={3}>
            <TextInput label="Telegram" value={s.telegram} onChange={(v) => set('telegram', v)} placeholder="@username" isOptional />
            <TextInput label="VK" value={s.vk} onChange={(v) => set('vk', v)} placeholder="shortname" isOptional />
          </HStack>
        </VStack>
      </Card>

      <Card padding={5} elevation="low">
        <VStack gap={3}>
          <Heading level={2}>Часы работы</Heading>
          {WEEKDAYS.map((wd) => {
            const h = s.hours[wd];
            return (
              <HStack key={wd} gap={3} vAlign="center" wrap="wrap">
                <Switch label={WEEKDAY_LABELS[wd]} value={h !== null}
                  onChange={(on) => set('hours', { ...s.hours, [wd]: on ? { open: '10:00', close: '20:00' } : null })} />
                {h ? (
                  <>
                    <TimeInput label="с" value={h.open as never} onChange={(v) => v && set('hours', { ...s.hours, [wd]: { ...h, open: String(v).slice(0, 5) } })} width={130} />
                    <TimeInput label="до" value={h.close as never} onChange={(v) => v && set('hours', { ...s.hours, [wd]: { ...h, close: String(v).slice(0, 5) } })} width={130} />
                  </>
                ) : <Text color="secondary">выходной</Text>}
              </HStack>
            );
          })}
          <Heading level={3}>Выходные дни</Heading>
          <HStack gap={2} wrap="wrap">
            {s.daysOff.length ? s.daysOff.map((d) => (
              <Token key={d} label={d.split('-').reverse().join('.')} onRemove={() => set('daysOff', s.daysOff.filter((x) => x !== d))} />
            )) : <Text color="secondary">Нет</Text>}
          </HStack>
          <HStack gap={2} vAlign="end">
            <DateInput label="Добавить выходной" value={newDayOff as never} onChange={(v) => setNewDayOff(v as string | undefined)} />
            <Button label="Добавить" onClick={() => {
              if (newDayOff && !s.daysOff.includes(newDayOff)) set('daysOff', [...s.daysOff, newDayOff].sort());
              setNewDayOff(undefined);
            }} />
          </HStack>
        </VStack>
      </Card>

      <Card padding={5} elevation="low">
        <VStack gap={3}>
          <Heading level={2}>Доставка и отмена</Heading>
          <HStack gap={3}>
            <NumberInput label="Доставка, ₽" value={fee} onChange={setFee} hasClear isIntegerOnly min={0} />
            <NumberInput label="Бесплатно от, ₽" value={freeFrom} onChange={setFreeFrom} hasClear isIntegerOnly min={0} isOptional />
          </HStack>
          <TextInput label="Зона доставки" value={s.delivery.zone} onChange={(v) => set('delivery', { ...s.delivery, zone: v })} />
          <NumberInput label="Отмена не позже чем за, часов" value={cancelHours} onChange={setCancelHours} hasClear min={0} />
          <TextArea label="Правила отмены (видит клиент)" value={s.cancel.rules} onChange={(v) => set('cancel', { ...s.cancel, rules: v })} rows={2} />
          <Text color="secondary">Минимальное время доставки — через {s.delivery.minLeadMinutes / 60} ч от текущего времени.</Text>
        </VStack>
      </Card>

      <Card padding={5} elevation="low">
        <VStack gap={3}>
          <Heading level={2}>Заказ заранее и скидки</Heading>
          <TextArea label="Текст на вкладке «Скидки»" value={s.advance.text} onChange={(v) => set('advance', { ...s.advance, text: v })} rows={3} />
          {s.advance.discounts.map((d, i) => (
            <HStack key={i} gap={2} vAlign="end">
              <NumberInput label="От, шт." value={d.minQty} width={110} isIntegerOnly min={2}
                onChange={(v) => set('advance', { ...s.advance, discounts: s.advance.discounts.map((x, j) => j === i ? { ...x, minQty: v } : x) })} />
              <NumberInput label="Скидка, %" value={d.percent} width={110} min={1} max={90}
                onChange={(v) => set('advance', { ...s.advance, discounts: s.advance.discounts.map((x, j) => j === i ? { ...x, percent: v } : x) })} />
              <Button label="Убрать" variant="ghost" onClick={() => set('advance', { ...s.advance, discounts: s.advance.discounts.filter((_, j) => j !== i) })} />
            </HStack>
          ))}
          <Button label="Добавить скидку" onClick={() => set('advance', { ...s.advance, discounts: [...s.advance.discounts, { minQty: 3, percent: 5 }] })} />
        </VStack>
      </Card>

      <Card padding={5} elevation="low">
        <VStack gap={3}>
          <Heading level={2}>Логотип и главное фото</Heading>
          <HStack gap={3} vAlign="center">
            {s.logo ? <img className="thumb" src={media(s.logo)} alt="Логотип" /> : null}
            <FileInput label="Логотип" accept="image/*" value={logoFile} onChange={(f) => setLogoFile(Array.isArray(f) ? f[0] ?? null : f)} />
          </HStack>
          <HStack gap={3} vAlign="center">
            <img className="thumb" src={media(s.heroPhoto)} alt="Главное фото" />
            <FileInput label="Главное фото" accept="image/*" value={heroFile} onChange={(f) => setHeroFile(Array.isArray(f) ? f[0] ?? null : f)} />
          </HStack>
        </VStack>
      </Card>

      {msg ? <Banner status={msg.ok ? 'success' : 'error'} title={msg.ok ? msg.text : 'Не сохранилось'} description={msg.ok ? undefined : msg.text} /> : null}
      <Button label="Сохранить изменения" variant="primary" size="lg" width="100%" isLoading={save.isPending}
        onClick={() => { setMsg(null); save.mutate(); }} data-testid="save-settings" />
    </VStack>
  );
}
