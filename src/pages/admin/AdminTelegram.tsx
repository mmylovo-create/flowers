import { useMutation } from '@tanstack/react-query';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { Code } from '@astryxdesign/core/Code';
import { TelegramLogoIcon } from '@phosphor-icons/react';
import { ownerApi } from './ownerApi';

const BOT = (import.meta.env.VITE_TELEGRAM_BOT as string | undefined) ?? '';

export default function AdminTelegram({ shopId }: { shopId: string }) {
  const code = useMutation({ mutationFn: () => ownerApi.telegramCode(shopId) });
  const link = code.data && BOT ? `https://t.me/${BOT.replace(/^@/, '')}?start=${code.data.code}` : null;
  return (
    <VStack gap={4}>
      <Card padding={5} elevation="low">
        <VStack gap={3}>
          <Heading level={2}>Заказы и управление в Telegram</Heading>
          <Text>Подключите бота — в него будут приходить все заказы с сайта с кнопками «Подтвердить», «В пути», «Доставлен», «Отменить». Через бота можно менять наличие и цены и добавлять букеты с фото.</Text>
          <Button label="Подключить Telegram" variant="primary" icon={<TelegramLogoIcon size={20} />} isLoading={code.isPending} onClick={() => code.mutate()} />
          {code.data ? (
            <VStack gap={2}>
              <Text>Подключено чатов: {code.data.linkedChats}. Ссылка действует 30 минут:</Text>
              {link ? <Button label="Открыть бота и подключить" href={link} target="_blank" /> : null}
              <Text color="secondary">Или отправьте боту команду:</Text>
              <Code>/start {code.data.code}</Code>
            </VStack>
          ) : null}
          {code.isError ? <Banner status="error" title="Не удалось получить код" /> : null}
        </VStack>
      </Card>
      <Card padding={5}>
        <VStack gap={2}>
          <Heading level={3}>Команды бота</Heading>
          <Text>/orders — ближайшие заказы и смена статуса</Text>
          <Text>/bouquets — наличие и цены кнопками</Text>
          <Text>/add — добавить товар: фото с подписью «Название; Цена; Описание» (название со слова «Шары», «Открытка», «Фейерверк» — в нужный раздел)</Text>
          <Text>/price id цена · /stock id on|off|количество</Text>
        </VStack>
      </Card>
    </VStack>
  );
}
