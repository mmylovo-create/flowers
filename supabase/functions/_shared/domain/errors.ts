// Error codes raised by the database and server functions, with messages for people.
export const ERROR_MESSAGES: Record<string, string> = {
  slot_busy: 'Это время только что заняли. Выберите, пожалуйста, другое.',
  too_soon: 'Ближайшая доставка — не раньше чем через час. Выберите время позже.',
  too_far: 'На эту дату пока нельзя оформить заказ.',
  day_off: 'В этот день мы не работаем.',
  closed: 'В это время мы не доставляем.',
  bad_slot: 'Выберите время из списка.',
  out_of_stock: 'Одной из позиций не хватает в наличии. Уменьшите количество или выберите другую.',
  bouquet_not_found: 'Букет не найден — возможно, его убрали из каталога.',
  shop_not_found: 'Магазин не найден.',
  shop_is_sample: 'Это образец магазина: заказы пока не принимаются.',
  bad_quantity: 'Проверьте количество.',
  no_bouquet: 'Добавьте в корзину букет, шары или фейерверк — открытки доставляем вместе с ними.',
  stock_item_not_found: 'Такой позиции нет на складе. Проверьте название или сначала оформите приход.',
  stock_not_enough: 'На складе меньше, чем вы хотите списать.',
  bad_stock_line: 'Не получилось разобрать строку: нужно «Название количество».',
  bad_card_text: 'Текст открытки — до 300 символов.',
  bad_name: 'Проверьте имя.',
  bad_phone: 'Проверьте номер телефона.',
  bad_contact: 'Проверьте ник в VK или Telegram.',
  bad_address: 'Укажите адрес доставки.',
  not_confirmed: 'Подтвердите доставку.',
  order_not_found: 'Заказ не найден.',
  cancel_too_late: 'Отменить заказ уже нельзя по правилам магазина. Позвоните нам.',
  not_authenticated: 'Войдите в кабинет.',
  forbidden: 'Нет доступа.',
  bad_settings: 'Проверьте настройки магазина.',
  bad_bouquet: 'Проверьте данные букета.',
  bad_status: 'Неизвестный статус.',
  order_closed: 'Заказ уже закрыт.',
  bad_code: 'Код устарел. Получите новый в кабинете.',
  network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
  invalid_input: 'Проверьте заполненные поля.',
};

export function errorMessage(code: string | undefined | null): string {
  if (!code) return 'Что-то пошло не так. Попробуйте ещё раз.';
  return ERROR_MESSAGES[code] ?? 'Что-то пошло не так. Попробуйте ещё раз.';
}

export class AppError extends Error {
  constructor(public code: string, public detail?: string) {
    super(errorMessage(code));
  }
}
