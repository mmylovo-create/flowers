import { useState } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Banner } from '@astryxdesign/core/Banner';
import { supabase } from '../lib/supabase';

/** Email + password sign-in for the shop owner (Supabase Auth). */
export function OwnerLogin({ title = 'Кабинет владельца', subtitle, headingLevel = 1, onSignedIn }: { title?: string; subtitle?: string; headingLevel?: 1 | 2; onSignedIn?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(/invalid/i.test(error.message) ? 'Неверная почта или пароль' : 'Не удалось войти: ' + error.message);
    else onSignedIn?.();
  };
  return (
    <Card padding={6} elevation="low" maxWidth={440} width="100%">
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={headingLevel}>{title}</Heading>
          {subtitle ? <Text color="secondary">{subtitle}</Text> : null}
        </VStack>
        <TextInput label="Почта" type="email" value={email} onChange={setEmail} autoComplete="username" />
        <TextInput label="Пароль" type="password" value={password} onChange={setPassword} autoComplete="current-password" onEnter={() => void submit()} />
        {error ? <Banner status="error" title={error} /> : null}
        <Button label="Войти" variant="primary" size="lg" width="100%" isLoading={busy} onClick={() => void submit()} data-testid="login" />
      </VStack>
    </Card>
  );
}
