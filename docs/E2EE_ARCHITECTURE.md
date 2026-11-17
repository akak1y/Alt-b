# Сквозное шифрование Alt

## Что делает Element Web

Исследован Element Web на коммите `5985a54` ветки `develop`. Его lockfile фиксирует
Matrix JS SDK на `6240d0e` и WASM на `18.9.2`. Alt сохраняет версии из своего
lockfile, Matrix JS SDK `37.13.0` и `@matrix-org/matrix-sdk-crypto-wasm@15.3.0`.
API интеграции сверены с исходниками именно установленного SDK.
[Lockfile Element](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/pnpm-lock.yaml) ·
[JS SDK Element](https://github.com/matrix-org/matrix-js-sdk/tree/6240d0e9c63319f2f5c05f27fd9f1dc12fa8068b) ·
[JS SDK Alt](https://github.com/matrix-org/matrix-js-sdk/tree/v37.13.0) ·
[Привязка WASM и версии Rust](https://github.com/matrix-org/matrix-sdk-crypto-wasm/blob/v15.3.0/Cargo.toml)

| Задача                             | Реализация Element                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Жизненный цикл                     | `Lifecycle.restoreSessionFromStorage` и `doSetLoggedIn` восстанавливают учётные данные. `MatrixClientPeg.assign` дожидается `initClientCrypto`, которое передаёт локальный ключ или пароль хранилища в `initRustCrypto`. `MatrixClientPeg.start` затем вызывает `startClient`. [Lifecycle](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/Lifecycle.ts#L705) · [MatrixClientPeg](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/MatrixClientPeg.ts#L240)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Отправка                           | `SendMessageComposer.sendMessage` формирует контент и передаёт его `MatrixClient.sendMessage`. SDK выбирает шифрование по состоянию комнаты, распределяет ключи и отправляет `m.room.encrypted`. [SendMessageComposer](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/components/views/rooms/SendMessageComposer.tsx#L352)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Приём и ошибки                     | `EventTile` подписывается на `MatrixEventEvent.Decrypted` и перестраивает отображение. `MatrixActionCreators` передаёт обновление в хранилища интерфейса. `DecryptionFailureTracker` дополнительно отслеживает ошибки и дальнейшие попытки, включая случаи запоздавших ключей. [EventTile](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/components/views/rooms/EventTile.tsx#L577) · [Диспетчер](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/actions/MatrixActionCreators.ts#L356) · [Ошибки](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/DecryptionFailureTracker.ts#L200)                                                                                                                                                                                                                                                                                                                                                     |
| Локальное хранение и потеря данных | Rust Crypto держит состояние в IndexedDB. `BasePlatform.getPickleKey` получает платформенный ключ для локальных данных, а `StorageManager` сравнивает признаки инициализации и наличие хранилищ. `Lifecycle` показывает диалог при потере данных, поддерживает повторную авторизацию и очищает свои хранилища при полном выходе. [BasePlatform](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/BasePlatform.ts#L384) · [StorageManager](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/utils/StorageManager.ts) · [Выход](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/Lifecycle.ts#L1245)                                                                                                                                                                                                                                                                                                                                            |
| Восстановление и доверие           | `SecurityManager.accessSecretStorage` открывает или настраивает Secret Storage и может вызвать `bootstrapCrossSigning`. `CreateSecretStorageDialog` управляет созданием Recovery Key и Key Backup. `RestoreKeyBackupDialog` загружает и импортирует резервные ключи. `SetupEncryptionBody` запрашивает подтверждение у другого своего устройства через `requestOwnUserVerification`. [SecurityManager](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/SecurityManager.ts#L204) · [Настройка](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/async-components/views/dialogs/security/CreateSecretStorageDialog.tsx#L185) · [Восстановление](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/components/views/dialogs/security/RestoreKeyBackupDialog.tsx) · [Подтверждение](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/apps/web/src/components/structures/auth/SetupEncryptionBody.tsx#L110) |

Olm передаёт ключи комнат между устройствами, а Megolm шифрует события комнаты.
Cross-Signing позволяет связать доверие к устройствам с доверенной идентичностью
пользователя. Отправитель может исключить неподтверждённые устройства. Key
Backup хранит на сервере зашифрованные ключи Megolm. Secret Storage может
хранить закрытый ключ от резервной копии вместе с секретами Cross-Signing.
Recovery Key открывает Secret Storage. Успех восстановления зависит от
фактически загруженных в резервную копию сеансов и доступности секрета.
[CryptoApi](https://github.com/matrix-org/matrix-js-sdk/blob/v37.13.0/src/crypto-api/index.ts) ·
[OlmMachine](https://github.com/matrix-org/matrix-rust-sdk/blob/matrix-sdk-0.14.0/crates/matrix-sdk-crypto/src/machine/mod.rs)

Alt использует публичные API Matrix SDK. Код и архитектура Element в проект не
переносились. [Лицензирование Element](https://github.com/element-hq/element-web/blob/5985a54e4139833dc550e56a8e6271cb7ec398f0/README.md)

## Аудит Alt и реализация MVP

Исходная точка — `main` на `2f1392e`. Alt уже сохранял поля сессии, но три
пути подключения отдельно запускали sync. Проекция комнат заменяла
`m.room.encrypted` заглушкой, а шаблон скрывал поле отправки. Сборка esbuild
создавала IIFE, CSP Express блокировала компиляцию WASM. Приглашения и
Matrix-трафик продолжают идти по прежним маршрутам, а шифрование выполняется в
браузере.

1. Логин и регистрация сохраняют выданные сервером учётные данные.
   Восстановление использует сохранённый token и проверяет его через
   `/account/whoami`. Для всех трёх путей создаётся аутентифицированный
   `MatrixClient` с `userId` и `deviceId`.
2. Вкладка получает эксклюзивный Web Lock `alt-matrix-session`. Он охватывает
   аутентификацию, crypto, sync и выход. Вторая вкладка показывает сообщение
   и предлагает обновить страницу после закрытия первой. Это ограничение
   действует на весь origin, поскольку запись сессии общая.
3. `initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix })` завершается
   перед `startClient()`. Если нет ID устройства, Web Locks, IndexedDB или
   запуск crypto завершается ошибкой, обычная переписка доступна, а защищённая
   отправка и создание E2EE-комнаты заблокированы. В E2EE-комнате показывается
   причина. Для работы crypto нужен HTTPS или доверенный `localhost`.
4. `sendTextMessage` вызывается только для известной комнаты, в которую
   пользователь вступил. В криптографической ветке SDK проверяет состояние
   комнаты, подбирает устройства, отправляет ключи и вызывает `encryptEvent`.
   Ошибка шифрования обрывает отправку. Приватная E2EE-комната создаётся
   одним `createRoom` с `private_chat` и `m.room.encryption` для Megolm в
   `initial_state`. Обычные комнаты сохраняют прежние пресеты.
5. Sync передаёт события и ключи в Rust Crypto. Alt запрашивает расшифровку
   загруженной ленты открытой комнаты через `decryptEventIfNeeded`.
   `Event.decrypted` обновляет проекцию Vue для успеха и ошибки. Проверка
   `isDecryptionFailure()` нужна даже при типе `m.room.message`. Поздний ключ
   позволяет SDK повторить попытку и заменить заглушку текстом того же события.
6. На выходе `logout(true)` останавливает SDK и пытается отозвать серверную
   сессию. При сетевой ошибке локальный выход всё равно очищает сохранённую
   сессию. Rust Crypto закрывает соединения IndexedDB, а Alt сохраняет данные
   ключей. Обычная перезагрузка открывает то же хранилище. После возврата из
   BFCache страница заново восстанавливает сессию.

[MatrixClient и отправка](https://github.com/matrix-org/matrix-js-sdk/blob/v37.13.0/src/client.ts#L1925) ·
[RoomEncryptor](https://github.com/matrix-org/matrix-js-sdk/blob/v37.13.0/src/rust-crypto/RoomEncryptor.ts) ·
[Sync](https://github.com/matrix-org/matrix-js-sdk/blob/v37.13.0/src/sync.ts#L1355) ·
[MatrixEvent](https://github.com/matrix-org/matrix-js-sdk/blob/v37.13.0/src/models/event.ts#L800) ·
[Повторная расшифровка](https://github.com/matrix-org/matrix-js-sdk/blob/v37.13.0/src/rust-crypto/rust-crypto.ts#L1832)

| Место                             | Данные и срок жизни                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localStorage/alt_matrix_session` | Access token, Matrix user ID и device ID. Запись стирается при выходе или отказе сервера в `whoami`.                                                                                                                  |
| IndexedDB текущего origin         | Хранилище SDK с префиксом `alt-e2ee-` и JSON-кортежем `[homeserver, userId, deviceId]`. Здесь находятся ключ устройства, сеансы Olm и Megolm и служебное состояние. Ключ отдельного шифрования IndexedDB не задаётся. |
| Память вкладки                    | MatrixClient, открытое состояние SDK и расшифрованные сообщения интерфейса.                                                                                                                                           |
| Synapse                           | Публичные ключи устройств, зашифрованные события и протокольные данные Matrix. Alt использует существующие Matrix API.                                                                                                |

Сборка копирует бинарник из установленной транзитивной зависимости в
`public/js/pkg/`. Его URL разрешается относительно адреса `alt.js`. Express
выдаёт WASM как `application/wasm`; `script-src 'wasm-unsafe-eval'` разрешает
компиляцию WebAssembly, а политика `connect-src` допускает загрузку с origin
Alt. Дополнительные пакеты npm и изменение конфигурации Synapse для MVP не
требуются.

## Ограничения и дальнейшая работа

- MVP использует политику устройств SDK по умолчанию. Сторона, которая требует
  верификации устройств, может не передать Alt ключи. Устройства и личности
  собеседников нельзя подтвердить из интерфейса Alt.
- Перезагрузка сохраняет устройство, а выход и новый вход по паролю обычно
  дают новый device ID. Старые ключи сохраняются локально, но новый клиент
  открывает своё хранилище. История может остаться недоступной. Очистка
  хранилища, смена origin или профиля браузера также могут лишить доступа.
  Если IndexedDB удалена при сохранённом токене и сервер уже знает прежние
  ключи устройства, может потребоваться новый вход для получения нового
  device ID. Новому устройству нужны сеансы, переданные Matrix или
  восстановленные из совместимого бэкапа.
- Шифрование IndexedDB отдельным ключом и очистка устройства на общем
  компьютере требуют отдельной политики. В MVP доступ к профилю браузера
  или выполнение кода на origin Alt создают риск доступа к сессии и ключам.
- Следующий этап — доступ к существующей Secret Storage через
  `cryptoCallbacks.getSecretStorageKey`. Для новой настройки использовать
  `createRecoveryKeyFromPassphrase` и `bootstrapSecretStorage`. Существующий
  Key Backup следует проверить через `checkKeyBackupAndEnable`, затем загрузить
  секрет через `loadSessionBackupPrivateKeyFromSecretStorage` и восстановить
  ключи через `restoreKeyBackup`. Новый backup создаётся по явному выбору после
  настройки доверия. Такой порядок защищает существующий бэкап от замены при
  повторном входе.
- Для доверия и передачи секретов добавить `bootstrapCrossSigning`,
  `requestOwnUserVerification`, обработку
  `CryptoEvent.VerificationRequestReceived` и подтверждение SAS через SDK.
  Верификация и восстановление дополняют друг друга. Подтверждение устройства
  само по себе не восстанавливает все старые сеансы. Шифрование медиа —
  отдельная задача с использованием совместимого формата Matrix attachments.

## Интеграционная проверка с Element Web

Используйте два выделенных тестовых аккаунта и два независимых профиля
браузера. Предпочтителен отдельный Synapse. Для локального Synapse в тестовой
копии согласуйте `HOMESERVER` и `connect-src` с его адресом и настройте Element
на тот же сервер. `docker-compose.yml` запускает только тестовый Synapse.
В DevTools смотрите на типы событий, статус и наличие поля `ciphertext`.
Пароли, токены, ключи и необработанные сетевые журналы в отчёт не включайте.

1. Войти как A в Alt и как B в Element. Дождаться первого sync.
2. В Alt создать приватную комнату, включив «сквозное шифрование». Пригласить
   B и принять приглашение в Element. Проверить признак шифрования в Element.
3. Отправить два разных текста в обе стороны. Оба получателя должны увидеть
   исходный текст. Проверить, что HTTP-запросы используют
   `/send/m.room.encrypted/{txnId}` и тело не содержит открытый текст.
4. Повторить шаг в комнате, созданной в Element, и проверить подгрузку старых
   событий через «История».
5. Обновить оба клиента в тех же профилях. Убедиться, что сообщения читаются и
   новые отправляются. Открыть вторую вкладку Alt и проверить блокировку.
   Закрыть первую вкладку, обновить вторую и проверить восстановление.
6. Проверить выход из Alt и повторный вход. Сравнить device ID и состояние
   старых сообщений. Проверить новые сообщения после появления устройства в
   списке получателей.
7. Открыть Alt в новом профиле. Для случая отсутствующего ключа открыть историю,
   которой новое устройство заведомо не получало, либо использовать политику
   Element, исключающую неподтверждённые устройства. Проверить понятное
   сообщение об ошибке. Если тестовый пользователь ранее настроил Key Backup,
   проверить восстановление в Element с его Recovery Key. В Alt этот поток
   пока недоступен.
8. Проверить незашифрованную комнату, отправку в обе стороны, историю и
   приглашения. Запрос обычного сообщения должен использовать
   `/send/m.room.message/{txnId}`.

Автоматические тесты покрывают порядок запуска SDK, восстановление с тем же
префиксом, конкурирующую вкладку, обработку ошибок и поздней расшифровки,
закрытую отправку при сбое crypto, payload создания комнаты и обычную
переписку. В Chromium с имитацией ответов Matrix API проверены загрузка WASM
под CSP, запросы `m.room.encrypted` без открытого текста, чтение ранее
отправленного зашифрованного события после перезагрузки, обычный
`m.room.message` и блокировка второй вкладки. Обмен с Element на реальном
Synapse остаётся ручной проверкой.
