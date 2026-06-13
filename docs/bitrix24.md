# Подключение Битрикс24 к AI Food

Интеграция работает только через `api.cremenality.ru`. Webhook Битрикс24 нельзя помещать в HTML, `config.js`, Android-приложение или Git.

## 1. Создайте сущности

В Битрикс24 создайте три смарт-процесса:

1. `Basic User Contact`
2. `Support Ticket`
3. `Partnership Request`

Если раздел смарт-процессов недоступен на вашем тарифе, потребуется либо тариф с этой возможностью, либо адаптация интеграции под лиды/сделки. Текущий Worker использует универсальные методы `crm.item.*` и рассчитан на смарт-процессы.

## 2. Добавьте поля

### Basic User Contact

```text
user_id
email
role
source
is_blocked
created_at
```

### Support Ticket

```text
email
user_id
subject
message
category
status
priority
ticket_id
source
created_at
```

### Partnership Request

```text
cooperation_type
email
author_name
company_name
subject
proposal_message
preferred_contact
user_id
thread_id
status
source
created_at
```

Для первого подключения поля `status`, `priority`, `source`, `category`, `preferred_contact` и `cooperation_type` проще создать строковыми. Если вы создаёте их как списки, Битрикс24 обычно ожидает внутренние ID вариантов, а не текстовые значения. Worker поддерживает такое сопоставление через `BITRIX_ENUM_MAP_JSON`.

## 3. Получите внутренние коды

Отображаемое название поля и REST-код поля различаются. Worker должен получить именно REST-код, который возвращает Битрикс24, например `ufCrm...`.

Используйте REST-методы:

```text
crm.type.list
crm.item.fields
```

`crm.type.list` возвращает `entityTypeId` каждого смарт-процесса. `crm.item.fields` с нужным `entityTypeId` возвращает коды его полей. Не придумывайте коды вручную.

Официальная документация:

- https://apidocs.bitrix24.com/api-reference/crm/universal/crm-type-list.html
- https://apidocs.bitrix24.com/api-reference/crm/universal/crm-item-fields.html
- https://apidocs.bitrix24.com/api-reference/crm/universal/crm-item-add.html
- https://apidocs.bitrix24.com/api-reference/crm/timeline/comments/crm-timeline-comment-add.html

## 4. Создайте входящий webhook

В Битрикс24 откройте раздел разработчика и создайте входящий webhook с доступом к CRM. Создавайте webhook от отдельного технического пользователя с минимально необходимыми правами.

Адрес имеет вид:

```text
https://ВАШ_ПОРТАЛ.bitrix24.ru/rest/USER_ID/SECRET
```

Сохраните его только как секрет Worker:

```powershell
cd "C:\Users\pacani\Documents\Programms\AI Food\sitebyaidfood\cloudflare-auth-worker"
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put BITRIX_WEBHOOK_URL
```

В приглашение `Enter a secret value` вставьте базовый адрес webhook без `/crm.item.add.json`.

## 5. Заполните `wrangler.toml`

Укажите три `entityTypeId`:

```toml
BITRIX_USER_ENTITY_TYPE_ID = "[ID Basic User Contact]"
BITRIX_SUPPORT_ENTITY_TYPE_ID = "[ID Support Ticket]"
BITRIX_PARTNERSHIP_ENTITY_TYPE_ID = "[ID Partnership Request]"
```

Затем сопоставьте каждый REST-код поля с соответствующей переменной `BITRIX_*_FIELD_*`. Пример:

```toml
BITRIX_PARTNERSHIP_FIELD_EMAIL = "ufCrm42_1740000001"
BITRIX_PARTNERSHIP_FIELD_THREAD_ID = "ufCrm42_1740000002"
BITRIX_PARTNERSHIP_FIELD_STATUS = "ufCrm42_1740000003"
```

Для синхронизации назначенной на сайте роли добавьте в `Basic User Contact`
строковое поле `role`, получите его REST-код через `crm.item.fields` и укажите:

```toml
BITRIX_USER_FIELD_ROLE = "ufCrm7_ВАШ_КОД"
```

Пока значение оставлено пустым, назначение ролей на сайте работает, но поле роли
не отправляется в Битрикс24.

Числа выше являются только примером. Используйте коды именно вашего портала.

Если поля созданы как списки, укажите ID вариантов одним JSON-объектом:

```toml
BITRIX_ENUM_MAP_JSON = "{\"partnership.status.new\":\"101\",\"partnership.status.in_progress\":\"102\",\"support.priority.urgent\":\"205\"}"
```

Ключ строится как `сущность.поле.значение`. Поддерживаемые сущности: `user`, `support`, `partnership`. Если сопоставления нет, Worker отправляет исходное текстовое значение.

При необходимости задайте ID ответственных сотрудников:

```toml
BITRIX_USER_RESPONSIBLE_ID = "[ID сотрудника]"
BITRIX_SUPPORT_RESPONSIBLE_ID = "[ID Support Manager]"
BITRIX_PARTNERSHIP_RESPONSIBLE_ID = "[ID CRM Manager]"
```

## 6. Настройте роли сайта

Списки сотрудников не храните в `wrangler.toml`. Добавьте их как Cloudflare
Secrets, перечисляя несколько email через запятую:

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put ADMIN_EMAILS_SECRET
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put CRM_MANAGER_EMAILS_SECRET
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put SUPPORT_MANAGER_EMAILS_SECRET
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put DEVELOPER_EMAILS_SECRET
```

Wrangler запросит значение отдельно и не добавит его в Git.

Права проверяются в Worker, а не только скрытием вкладок на frontend.

## 7. Дополнительная защита и уведомления

Turnstile:

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put TURNSTILE_SECRET_KEY
```

Публичный site key укажите в `config.js` как `turnstileSiteKey`. Оба ключа должны относиться к виджету, разрешённому для `cremenality.ru`.

Telegram для команды:

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put TELEGRAM_BOT_TOKEN
```

В `TELEGRAM_CHAT_IDS` укажите один или несколько chat ID через запятую.

## 8. Примените миграции и разверните Worker

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler d1 migrations apply aifood-auth --remote
& "C:\Program Files\nodejs\npx.cmd" wrangler deploy
```

После этого разверните сайт:

```powershell
cd "C:\Users\pacani\Documents\Programms\AI Food\sitebyaidfood"
& "C:\Program Files\nodejs\npx.cmd" wrangler pages deploy . --project-name cremenality
```

## 9. Проверка

1. Зарегистрируйте тестового пользователя и подтвердите email.
2. Создайте обращение поддержки.
3. Создайте заявку на сотрудничество.
4. Проверьте три карточки в Битрикс24.
5. Ответьте через админ-панель AI Food.
6. Убедитесь, что ответ появился на сайте, в таймлайне CRM и пришёл на email.
7. Откройте `Admin -> Интеграция` и проверьте, что события имеют статус `synced`.

Если Битрикс24 временно недоступен, запись остаётся в D1. Cron Worker повторяет отправку каждые пять минут; администратор или интегратор может также запустить повтор вручную.

## Безопасность

- не публикуйте webhook и токены;
- при утечке немедленно удалите webhook в Битрикс24 и создайте новый;
- используйте отдельного технического пользователя;
- не передавайте в CRM профиль питания, аллергены, пароли, токены, AI-историю и сессии;
- разрешайте webhook только те CRM-операции, которые реально нужны интеграции.
