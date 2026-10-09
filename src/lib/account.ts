// Who is signed in on this device, and what they may open.
//
// Today only shop owners sign in (email + password, Supabase Auth). The account page is built
// around roles so customer accounts can be added later without redesigning it:
//   1. Supabase → Authentication → Providers → Phone: turn on and connect an SMS provider.
//   2. Set CUSTOMER_PHONE_LOGIN = true below. The account page then shows «Войти по номеру»:
//      supabase.auth.signInWithOtp({ phone }) → code from SMS → verifyOtp({ phone, token, type: 'sms' }).
//   3. Add a `customers` table (user_id → phone, name) and an RPC that links a signed-in customer's
//      orders by phone, so «Мои заказы» works across devices.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { ownerApi } from '../pages/admin/ownerApi';

/** Customer accounts by phone number: planned, switched off until SMS login is configured. */
export const CUSTOMER_PHONE_LOGIN = false;

export type AccountRole = 'owner' | 'customer';

/** The current Supabase session (undefined while it is being read). Live shops only. */
export function useSession(enabled: boolean): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(enabled ? undefined : null);
  useEffect(() => {
    if (!enabled) return;
    const sb = supabase();
    void sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [enabled]);
  return session;
}

/** The signed-in user's role in this shop, if any. */
export function useAccount(slug: string, live: boolean) {
  const session = useSession(live);
  const shops = useQuery({ queryKey: ['owner-shops', session?.user.id], queryFn: ownerApi.shops, enabled: !!session });
  const ownShop = shops.data?.find((s) => s.slug === slug) ?? null;
  const role: AccountRole | null = ownShop ? 'owner' : null;
  return { session, role, ownShop, isLoading: session === undefined || (!!session && shops.isLoading) };
}
