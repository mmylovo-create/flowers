import { Token } from '@astryxdesign/core/Token';
import { STATUS_LABELS, type OrderStatus } from '@domain';

const COLORS: Record<OrderStatus, 'blue' | 'green' | 'teal' | 'gray' | 'red' | 'yellow'> = {
  new: 'yellow', confirmed: 'blue', delivering: 'teal', done: 'green', cancelled_by_client: 'gray', cancelled_by_shop: 'red',
};

export function StatusToken({ status }: { status: OrderStatus }) {
  return <Token label={STATUS_LABELS[status]} color={COLORS[status]} />;
}
