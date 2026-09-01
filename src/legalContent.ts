import type { Language } from './i18n';

export type LegalDoc = 'privacy' | 'terms' | 'refund';

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

// Template legal copy for ONEFLOW — written to reflect how the product actually works (the
// Replicate-backed generation pipeline, the LemonSqueezy-funded credit balance, the optional
// Yandex Disk backup). Not a substitute for review by a lawyer in your jurisdiction before
// relying on it for real compliance (GDPR-style rights, local consumer-protection law, etc.).
export const LEGAL_CONTENT: Record<Language, Record<LegalDoc, LegalDocument>> = {
  ru: {
    privacy: {
      title: 'Политика конфиденциальности',
      updated: 'Последнее обновление: 1 сентября 2026 г.',
      intro:
        'Настоящая Политика конфиденциальности описывает, какие данные собирает ONEFLOW ' +
        '(далее — «Сервис»), как они используются, кому передаются и какими правами вы ' +
        'располагаете в отношении своих данных.',
      sections: [
        {
          heading: '1. Какие данные мы собираем',
          paragraphs: [
            'Данные аккаунта: адрес электронной почты и данные аутентификации, которые ' +
              'обрабатывает наш поставщик инфраструктуры (Supabase) при регистрации и входе.',
            'Данные об оплате: при оплате тарифа платёжные данные (номер карты и т. п.) ' +
              'вводятся непосредственно в интерфейсе платёжного партнёра LemonSqueezy — Сервис ' +
              'их не видит и не хранит. Нам передаётся только факт и сумма оплаты для начисления ' +
              'баланса.',
            'Данные об использовании: история ваших запросов на генерацию (используемая модель, ' +
              'стоимость, время) — нужна для списания баланса и отображения истории генераций.',
            'Содержимое генераций: промпты и загружаемые вами изображения/видео передаются ' +
              'сторонним поставщикам AI-моделей (см. раздел 3) для выполнения генерации.',
            'Данные интеграций: если вы подключаете резервное копирование в Яндекс.Диск, мы ' +
              'храним токен доступа, полученный по протоколу OAuth, в защищённом виде — только ' +
              'для загрузки ваших собственных генераций в вашу же папку на Диске.',
            'Локальные данные: часть настроек интерфейса и статистика использования сохраняются ' +
              'локально в вашем браузере (localStorage) и не передаются на наши серверы.',
          ],
        },
        {
          heading: '2. Как мы используем данные',
          paragraphs: [
            'Для предоставления функциональности Сервиса: выполнение генераций, списание и ' +
              'начисление баланса, отображение истории и профиля.',
            'Для связи с вами: уведомления об оплате, ответы на обращения в поддержку.',
            'Для обеспечения безопасности: предотвращение злоупотреблений и несанкционированного ' +
              'доступа к аккаунту.',
            'Мы не продаём ваши персональные данные третьим лицам и не используем их в рекламных ' +
              'целях за пределами самого Сервиса.',
          ],
        },
        {
          heading: '3. Передача данных третьим лицам',
          paragraphs: [
            'Supabase — хостинг базы данных и аутентификация пользователей.',
            'Replicate — выполнение AI-генераций; ваши промпты и загруженные изображения ' +
              'передаются на их серверы исключительно для обработки запроса и не используются ' +
              'нами для иных целей.',
            'LemonSqueezy — обработка платежей в качестве продавца записи (merchant of record); ' +
              'полностью отвечает за безопасность платёжных данных согласно стандарту PCI DSS.',
            'Яндекс.Диск — только если вы сами подключили интеграцию резервного копирования.',
            'Мы не передаём данные каким-либо иным третьим лицам, кроме случаев, предусмотренных ' +
              'законом.',
          ],
        },
        {
          heading: '4. Хранение и защита данных',
          paragraphs: [
            'Доступ к данным ограничен ролевой моделью на уровне базы данных (Row Level ' +
              'Security) — каждый пользователь видит только свои собственные записи.',
            'Данные хранятся столько, сколько существует ваш аккаунт. При удалении аккаунта мы ' +
              'удаляем связанные с ним данные, за исключением информации, которую обязаны хранить ' +
              'по закону (например, записи о платежах).',
          ],
        },
        {
          heading: '5. Ваши права',
          paragraphs: [
            'Вы можете запросить копию своих данных, их исправление или полное удаление аккаунта, ' +
              'написав на адрес поддержки, указанный в разделе «Контакты».',
            'Отключить резервное копирование в Яндекс.Диск можно в любой момент из интерфейса ' +
              'Сервиса — токен доступа будет удалён немедленно.',
          ],
        },
        {
          heading: '6. Изменения политики',
          paragraphs: [
            'Мы можем время от времени обновлять эту Политику. При существенных изменениях мы ' +
              'уведомим вас через интерфейс Сервиса или по электронной почте.',
          ],
        },
        {
          heading: '7. Контакты',
          paragraphs: [
            'По всем вопросам, связанным с обработкой персональных данных, пишите на ' +
              'nurgazinov.ayan@gmail.com.',
          ],
        },
      ],
    },
    terms: {
      title: 'Условия использования',
      updated: 'Последнее обновление: 1 сентября 2026 г.',
      intro:
        'Используя ONEFLOW (далее — «Сервис»), вы соглашаетесь с настоящими Условиями. Если вы ' +
        'не согласны с каким-либо пунктом — пожалуйста, не используйте Сервис.',
      sections: [
        {
          heading: '1. Описание сервиса',
          paragraphs: [
            'ONEFLOW — нод-редактор для генерации и адаптации рекламных фото, видео и аудио с ' +
              'помощью сторонних AI-моделей, а также набор инструментов для подготовки креативов ' +
              'под рекламные площадки (Kaspi, GDN, РСЯ/YAN, BYYD, Discovery и др.).',
            'Фактическую генерацию контента выполняют сторонние поставщики AI-моделей (в первую ' +
              'очередь Replicate) — Сервис выступает интерфейсом и не гарантирует бесперебойную ' +
              'доступность конкретных моделей, поскольку это зависит от третьих лиц.',
          ],
        },
        {
          heading: '2. Аккаунт',
          paragraphs: [
            'Для использования Сервиса необходима регистрация. Вы несёте ответственность за ' +
              'сохранность данных для входа и за все действия, совершённые под вашим аккаунтом.',
            'Один аккаунт предназначен для одного пользователя или организации; передача доступа ' +
              'третьим лицам без ведома Сервиса не допускается.',
          ],
        },
        {
          heading: '3. Тарифы и баланс',
          paragraphs: [
            'Оплата тарифа через LemonSqueezy пополняет ваш баланс в Сервисе на сумму, равную ' +
              '85% от фактически оплаченной суммы (комиссия Сервиса и платёжного партнёра ' +
              'составляет 15%).',
            'Баланс — это разовое пополнение: он не сгорает и не обнуляется в начале следующего ' +
              'месяца, а расходуется по мере использования Сервиса, пока не закончится.',
            'Стоимость каждой генерации списывается с баланса по фактической цене используемой ' +
              'модели в момент запроса. Если баланса недостаточно, запрос на генерацию будет ' +
              'отклонён — доплатите тариф, чтобы продолжить.',
            'Новый аккаунт без единой успешной оплаты имеет баланс $0 — бесплатный тариф даёт ' +
              'доступ к интерфейсу Сервиса, но не включает генерации за счёт Сервиса.',
          ],
        },
        {
          heading: '4. Допустимое использование',
          paragraphs: [
            'Запрещается использовать Сервис для создания незаконного контента, контента, ' +
              'нарушающего права третьих лиц (авторские права, товарные знаки, право на ' +
              'изображение), а также оскорбительного, дискриминационного или вводящего в ' +
              'заблуждение контента.',
            'Запрещены попытки автоматизированного обхода ограничений баланса, эксплуатации ' +
              'уязвимостей Сервиса или чрезмерной нагрузки на инфраструктуру.',
            'Мы оставляем за собой право приостановить или прекратить доступ к аккаунту при ' +
              'нарушении настоящих Условий.',
          ],
        },
        {
          heading: '5. Интеллектуальная собственность',
          paragraphs: [
            'Права на контент, созданный вами с помощью Сервиса, принадлежат вам в объёме, ' +
              'допускаемом условиями использования лежащих в основе AI-моделей третьих лиц.',
            'Сервис не гарантирует уникальность или отсутствие сходства сгенерированного контента ' +
              'с результатами, полученными другими пользователями тех же AI-моделей.',
          ],
        },
        {
          heading: '6. Ограничение ответственности',
          paragraphs: [
            'Сервис предоставляется «как есть». Мы не гарантируем, что сгенерированный контент ' +
              'будет полностью точным, пригодным для конкретной цели или свободным от ошибок.',
            'Мы не несём ответственности за перебои в работе сторонних поставщиков (Replicate, ' +
              'LemonSqueezy, Яндекс.Диск и др.), находящиеся вне нашего контроля.',
          ],
        },
        {
          heading: '7. Изменение и прекращение работы Сервиса',
          paragraphs: [
            'Мы можем изменять функциональность Сервиса, тарифы и настоящие Условия. О ' +
              'существенных изменениях мы уведомим заранее через интерфейс Сервиса или по ' +
              'электронной почте.',
          ],
        },
        {
          heading: '8. Контакты',
          paragraphs: ['По всем вопросам пишите на nurgazinov.ayan@gmail.com.'],
        },
      ],
    },
    refund: {
      title: 'Политика возврата средств',
      updated: 'Последнее обновление: 1 сентября 2026 г.',
      intro:
        'Эта политика описывает, в каких случаях и в каком порядке возможен возврат средств за ' +
        'оплаченный тариф ONEFLOW.',
      sections: [
        {
          heading: '1. Общее правило',
          paragraphs: [
            'Оплата тарифа пополняет ваш баланс в Сервисе и является предоплатой за будущие ' +
              'генерации. Средства, уже списанные с баланса за выполненные генерации, возврату не ' +
              'подлежат — вы получили услугу, за которую заплатили.',
          ],
        },
        {
          heading: '2. Возврат неиспользованного остатка',
          paragraphs: [
            'Вы можете запросить возврат неизрасходованной части баланса в течение 14 дней с ' +
              'момента оплаты, написав в поддержку по адресу nurgazinov.ayan@gmail.com.',
            'К возврату принимается только та часть суммы, которая не была потрачена на ' +
              'генерации к моменту рассмотрения обращения.',
          ],
        },
        {
          heading: '3. Технические сбои',
          paragraphs: [
            'Если генерация завершилась ошибкой по вине Сервиса или используемой AI-модели, но ' +
              'баланс всё же был списан, соответствующая сумма возвращается на баланс. Если это не ' +
              'произошло автоматически — напишите в поддержку с деталями запроса (модель, время, ' +
              'сумма списания).',
          ],
        },
        {
          heading: '4. Способ возврата',
          paragraphs: [
            'Возврат осуществляется через LemonSqueezy (наш платёжный партнёр и продавец записи) ' +
              'тем же способом, которым была произведена оплата. Срок зачисления зависит от вашего ' +
              'банка или платёжной системы.',
          ],
        },
        {
          heading: '5. Исключения',
          paragraphs: [
            'Возврат не производится, если аккаунт был заблокирован за нарушение Условий ' +
              'использования, либо если запрос на возврат подан позднее 14 дней с момента оплаты.',
          ],
        },
      ],
    },
  },
  en: {
    privacy: {
      title: 'Privacy Policy',
      updated: 'Last updated: September 1, 2026',
      intro:
        'This Privacy Policy explains what data ONEFLOW (the "Service") collects, how it is ' +
        'used, who it is shared with, and what rights you have over your data.',
      sections: [
        {
          heading: '1. What we collect',
          paragraphs: [
            'Account data: your email address and authentication data, processed by our ' +
              'infrastructure provider (Supabase) when you sign up and sign in.',
            'Payment data: when you pay for a tariff, your card details are entered directly on ' +
              'our payment partner LemonSqueezy’s interface — the Service never sees or ' +
              'stores them. We only receive the fact and amount of the payment, used to credit ' +
              'your balance.',
            'Usage data: your generation request history (model used, cost, timestamp) — needed ' +
              'to deduct your balance and show your generation history.',
            'Generation content: prompts and images/video you upload are sent to third-party AI ' +
              'model providers (see Section 3) to perform the generation.',
            'Integration data: if you connect Yandex Disk backup, we store the OAuth access token ' +
              'securely — used only to upload your own generations to your own Disk folder.',
            'Local data: some interface preferences and usage statistics are stored locally in ' +
              'your browser (localStorage) and never sent to our servers.',
          ],
        },
        {
          heading: '2. How we use it',
          paragraphs: [
            'To provide the Service: running generations, crediting/deducting your balance, ' +
              'showing your history and profile.',
            'To communicate with you: payment notifications, support responses.',
            'To keep the Service secure: preventing abuse and unauthorized account access.',
            'We do not sell your personal data to third parties or use it for advertising outside ' +
              'the Service itself.',
          ],
        },
        {
          heading: '3. Third parties we share data with',
          paragraphs: [
            'Supabase — database hosting and user authentication.',
            'Replicate — runs the AI generations; your prompts and uploaded images are sent to ' +
              'their servers solely to process the request and are not used by us for any other ' +
              'purpose.',
            'LemonSqueezy — processes payments as the merchant of record; fully responsible for ' +
              'payment data security under PCI DSS.',
            'Yandex Disk — only if you connect the backup integration yourself.',
            'We do not share your data with any other third party except where required by law.',
          ],
        },
        {
          heading: '4. Storage and security',
          paragraphs: [
            'Access to data is restricted at the database level via Row Level Security — every ' +
              'user can only see their own records.',
            'Data is kept for as long as your account exists. When you delete your account, we ' +
              'delete the associated data except information we’re required to keep by law ' +
              '(e.g. payment records).',
          ],
        },
        {
          heading: '5. Your rights',
          paragraphs: [
            'You can request a copy of your data, a correction, or full account deletion by ' +
              'contacting the support address in the Contacts section.',
            'You can disconnect Yandex Disk backup at any time from the Service — the access ' +
              'token is deleted immediately.',
          ],
        },
        {
          heading: '6. Changes to this policy',
          paragraphs: [
            'We may update this Policy from time to time. We will notify you of material changes ' +
              'through the Service interface or by email.',
          ],
        },
        {
          heading: '7. Contact',
          paragraphs: [
            'For any questions about how we handle personal data, write to ' +
              'nurgazinov.ayan@gmail.com.',
          ],
        },
      ],
    },
    terms: {
      title: 'Terms of Service',
      updated: 'Last updated: September 1, 2026',
      intro:
        'By using ONEFLOW (the "Service") you agree to these Terms. If you disagree with any ' +
        'part of them, please do not use the Service.',
      sections: [
        {
          heading: '1. Description of the Service',
          paragraphs: [
            'ONEFLOW is a node-based editor for generating and adapting advertising photos, ' +
              'video, and audio using third-party AI models, plus tools for preparing creatives ' +
              'for ad platforms (Kaspi, GDN, YAN, BYYD, Discovery, and others).',
            'Actual content generation is performed by third-party AI model providers (primarily ' +
              'Replicate) — the Service acts as an interface and does not guarantee uninterrupted ' +
              'availability of any specific model, since that depends on those third parties.',
          ],
        },
        {
          heading: '2. Account',
          paragraphs: [
            'Using the Service requires registration. You are responsible for keeping your login ' +
              'credentials safe and for all activity under your account.',
            'One account is intended for one user or organization; sharing access with third ' +
              'parties without the Service’s knowledge is not permitted.',
          ],
        },
        {
          heading: '3. Tariffs and balance',
          paragraphs: [
            'Paying for a tariff through LemonSqueezy credits your Service balance with 85% of ' +
              'the amount actually charged (the Service and payment partner retain a 15% margin).',
            'The balance is a one-time top-up: it never expires and never resets at the start of ' +
              'a new month — it is spent down as you use the Service until it runs out.',
            'The cost of each generation is deducted from your balance at the actual price of the ' +
              'model used at the time of the request. If your balance is insufficient, the ' +
              'generation request will be declined — top up your tariff to continue.',
            'A new account with no successful payment has a $0 balance — the free tier gives ' +
              'access to the Service’s interface but does not include any generations funded ' +
              'by the Service.',
          ],
        },
        {
          heading: '4. Acceptable use',
          paragraphs: [
            'You may not use the Service to create illegal content, content infringing third-' +
              'party rights (copyright, trademarks, right of publicity), or offensive, ' +
              'discriminatory, or misleading content.',
            'Automated attempts to bypass balance limits, exploit Service vulnerabilities, or ' +
              'place excessive load on the infrastructure are prohibited.',
            'We reserve the right to suspend or terminate account access for violations of these ' +
              'Terms.',
          ],
        },
        {
          heading: '5. Intellectual property',
          paragraphs: [
            'Rights to content you create with the Service belong to you, to the extent permitted ' +
              'by the terms of use of the underlying third-party AI models.',
            'The Service does not guarantee that generated content will be unique or free from ' +
              'similarity to output produced by other users of the same AI models.',
          ],
        },
        {
          heading: '6. Limitation of liability',
          paragraphs: [
            'The Service is provided "as is". We do not guarantee that generated content will be ' +
              'fully accurate, fit for a particular purpose, or error-free.',
            'We are not liable for outages of third-party providers (Replicate, LemonSqueezy, ' +
              'Yandex Disk, etc.) that are outside our control.',
          ],
        },
        {
          heading: '7. Changes and termination',
          paragraphs: [
            'We may change the Service’s functionality, pricing, and these Terms. We will ' +
              'give advance notice of material changes through the Service interface or by email.',
          ],
        },
        {
          heading: '8. Contact',
          paragraphs: ['For any questions, write to nurgazinov.ayan@gmail.com.'],
        },
      ],
    },
    refund: {
      title: 'Refund Policy',
      updated: 'Last updated: September 1, 2026',
      intro:
        'This policy describes when and how you can get a refund for a paid ONEFLOW tariff.',
      sections: [
        {
          heading: '1. General rule',
          paragraphs: [
            'Paying for a tariff tops up your Service balance and is a prepayment for future ' +
              'generations. Funds already deducted from your balance for completed generations ' +
              'are non-refundable — you received the service you paid for.',
          ],
        },
        {
          heading: '2. Refund of an unused balance',
          paragraphs: [
            'You can request a refund of the unspent portion of your balance within 14 days of ' +
              'payment by writing to support at nurgazinov.ayan@gmail.com.',
            'Only the portion of the amount not yet spent on generations at the time your request ' +
              'is reviewed is eligible for a refund.',
          ],
        },
        {
          heading: '3. Technical failures',
          paragraphs: [
            'If a generation fails due to a fault of the Service or the AI model used, but your ' +
              'balance was still deducted, that amount is credited back to your balance. If this ' +
              'doesn’t happen automatically, contact support with the request details (model, ' +
              'time, amount deducted).',
          ],
        },
        {
          heading: '4. Refund method',
          paragraphs: [
            'Refunds are processed through LemonSqueezy (our payment partner and merchant of ' +
              'record) using the same method you paid with. The time to receive the funds depends ' +
              'on your bank or payment provider.',
          ],
        },
        {
          heading: '5. Exceptions',
          paragraphs: [
            'No refund is given if the account was suspended for violating the Terms of Service, ' +
              'or if the refund request is submitted more than 14 days after payment.',
          ],
        },
      ],
    },
  },
};
