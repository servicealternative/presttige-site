# Arquitectura Presttige

**Princípios de construção para um milhão de membros**

> *Selected by Humans · Private · Prestigious*

**Versão 1.3** · 6 de Maio de 2026
**Documento de referência inviolável**
Antonio Manuel Pereira

---

## Changelog

**v1.0 → v1.3** — consolidações sucessivas após revisão directa do autor.

- **v1.1** — clarificação AWS-only stack; PostgreSQL vs DynamoDB; REST vs GraphQL; Tier Names vs Labels; 2FA por papel; Founder Channel; arquitectura completa de Partners
- **v1.2** — Princípio 11 (compliance não-falhável); roadmap operacional de certificações; Analytics architecture; Apple NFC entitlement como Day 1
- **v1.3** — revisão de prosa para eliminar repetições. Cada ideia é dita uma vez, no seu lugar próprio, com referências cruzadas em vez de re-explicações

---

## Índice

1. Nota de propósito
2. O contrato
3. Os onze princípios invioláveis
4. O sistema único
5. Stack técnico — tudo dentro de AWS
6. Modelo de dados
7. Autenticação, papéis e Founder Channel
8. GDPR e privacidade
9. Compliance e certificações — caminho operacional
10. Multi-tenancy
11. Versionamento de API
12. Eventos
13. Mobile
14. Member Cards
15. Arquitectura de Partners
16. Observabilidade
17. Analytics
18. As três frentes em paralelo
19. Calendário e custos
20. Tech Lead — três gatilhos
21. Proibições
22. Manutenção do documento

---

## 1. Nota de propósito

Este documento responde a uma pergunta única: como construir a Presttige de modo a que, no momento em que tiver um milhão de utilizadores activos, o sistema funcione como funciona hoje com cinco — sem reescritas, sem migrações, sem pausas para refactorizar?

A resposta é filosófica antes de técnica. Construir para um milhão desde o primeiro membro significa tomar decisões considerando o estado final, não o estado inicial. Significa pagar mais agora — em tempo, em infrastructure, em rigor — para nunca pagar a dívida técnica que mata empresas no momento em que começam a vencer.

A Presttige, pelo seu posicionamento e mercado, não tem licença para falhar à escala. Um sistema que parte ao colo na primeira tracção real destrói a marca em silêncio. Um membro Patron que vê o sistema falhar não escreve uma reclamação — vai-se embora e leva o seu círculo.

> *Documento em Português para revisão privilegiada entre Antonio Pereira e equipa de produto. Versão Inglesa será produzida para uso operacional com Codex e contratações técnicas.*

---

## 2. O contrato

Este documento é um contrato em quatro níveis.

- **Para Antonio:** a referência que protege contra atalhos. Quando alguém viola um princípio, este documento é a resposta — "está aqui escrito que não"
- **Para Codex e qualquer programador:** a especificação que se segue antes de implementar. Cada feature começa por verificar este documento
- **Para a equipa de IT futura:** a herança técnica. O Tech Lead que entrar lê isto antes de tocar em código
- **Para o negócio:** o documento que se mostra a investidor sério, partner institucional, due diligence. Empresas premium vendem-se ao nível das suas decisões de arquitectura

> *A arquitectura é a única coisa que não se pode comprar depois. Tudo o resto sim. A arquitectura está nos primeiros mil commits ou nunca está.*

---

## 3. Os onze princípios invioláveis

Cada decisão técnica posterior deriva destes princípios. Quando há dúvida, volta-se aqui. Não há excepções.

**01.** Construir para 1MM de membros desde o primeiro membro. Não para 1.000 com plano de migrar — esse plano nunca é executado a tempo.

**02.** Sistema único, não múltiplos sistemas integrados. CRM, Apps, Member Portal, Match, Admin Panel, Member Card backend, Partner Portal — uma única plataforma com diferentes interfaces. Uma base de dados, uma autenticação, um modelo de dados.

**03.** Privacidade e GDPR como arquitectura, não como camada. Direito ao apagamento, consentimento granular, portabilidade, residência geográfica — desenhados dentro do data model desde o primeiro dia.

**04.** Versionamento desde a primeira API. Toda a API pública é `/api/v1/...` desde o primeiro endpoint. Quebrar contratos com clientes não é opção.

**05.** Eventos antes de polling. Tudo o que acontece gera um evento. Outras partes do sistema reagem. EventBridge desde o início.

**06.** Multi-tenancy implícito. Cada registo sabe a que tenant pertence. Parceiros futuros entram sem reescrita.

**07.** Codebase única para iOS e Android. React Native + Expo. Não duas equipas mantendo dois codebases nativos.

**08.** Observabilidade desde o primeiro user. Datadog ou equivalente. Sem isto, à primeira escala real fica-se às escuras.

**09.** Tier names e brand language imutáveis em código. Subscriber, Club, Premier, Patron, Founder, Committee — sempre em Inglês, sempre em local separado e versionado.

**10.** Documentação é parte do produto. Cada decisão tem registo. O Tech Lead que entrar lê documentação, não código.

> *Princípio 11 é de outra natureza — falhas aqui não admitem reparação.*

**11.** Compliance e certificações são fundação não-falhável. GDPR conformidade total desde o primeiro membro. Caminho de auditoria completo desde o primeiro registo. ISO 27001 e SOC 2 Type II como destinos certificáveis. Frameworks de mercados-alvo (UAE PDPL, EU AI Act emergente) tratados desde o desenho. Não se admite "vamos arranjar depois" — o dano à marca em caso de falha é instantâneo e irreversível.

---

## 4. O sistema único

> *A Presttige não tem um CRM. Não tem um Member Portal. Não tem Apps. Não tem Admin Panel. A Presttige tem uma plataforma operacional única, com várias interfaces.*

Todas as interfaces falam com a mesma API, a mesma autenticação, o mesmo modelo de dados. A diferença está em quais endpoints cada role acede e em como a UI apresenta.

### As interfaces

- App iOS / Android — para membros activos
- Member Portal web — paridade com a app
- Express Interest form — para candidatos
- Admin Panel — para a equipa Presttige
- Partner Portal — para parceiros (detalhe na Secção 15)
- Founder Concierge — gestão pessoal de Patrons e Founders (detalhe na Secção 7)

### Porque é não-negociável

CRM separado de Apps separado de Portal separado de Admin Panel: receita garantida para inconsistência, sincronizações falhadas, dados duplicados. Aos 1.000 membros aguenta-se. Aos 10.000 começa a doer. Aos 100.000 é insustentável. Aos 1MM é o fim do produto.

A arquitectura unificada custa 4-6 semanas extra no início para definir o data model. A partir do mês 6, qualquer feature nova entra em todas as superfícies em dias, não em meses.

---

## 5. Stack técnico — tudo dentro de AWS

Todo o stack vive numa única conta AWS — a conta METTALIX já em utilização (343218208384), região primária `us-east-1`. Mesma conta, mesma factura, mesmo IAM.

### Componentes AWS

- Aurora PostgreSQL Serverless v2 — base de dados primária
- Cognito User Pool — autenticação
- Lambda + ECS Fargate — execução de código
- EventBridge — sistema de eventos
- API Gateway — entrada da API REST
- S3 + CloudFront — storage e CDN global
- KMS — gestão de chaves de encriptação
- CloudWatch — logs e métricas básicas
- SES — envio de emails transaccionais
- SQS — filas de mensagens assíncronas

### Fora da AWS

- Stripe — pagamentos (já operacional)
- Datadog — observabilidade premium
- Apple Developer + Google Play Console — distribuição móvel
- GitHub — repositório de código

### Base de dados — Aurora PostgreSQL Serverless v2

PostgreSQL é o standard da indústria para sistemas operacionais sérios. Aurora Serverless v2 escala automaticamente entre 0.5 e 128 ACUs com read replicas multi-AZ. Backups diários com point-in-time recovery de 35 dias. Encryption at rest e in transit por defeito.

Aguenta de 1 user a 1MM sem alteração — apenas escala automaticamente o custo.

#### Porquê PostgreSQL e não DynamoDB

PostgreSQL trata dados relacionais com queries complexas — Members ligados a Memberships ligadas a Transactions ligadas a Matches ligadas a Partners. Cada um destes tem joins, agregações, relatórios.

DynamoDB é document store NoSQL, optimizado para padrões muito específicos a escala massiva (carrinho da Amazon). Não faz joins. Forçaria desnormalização e lógica de negócio em código de aplicação que o PostgreSQL resolve em 1 linha de SQL.

DynamoDB pode ser usado em casos isolados muito específicos (log high-write de CardEvents raramente consultado com joins). Nunca como base de dados primária.

### Autenticação — AWS Cognito User Pool

Suporta email/password, SSO (Apple, Google), magic links, MFA, custom attributes. Integração nativa com o resto do stack AWS, conformidade SOC 2 / ISO 27001 / GDPR herdada, evita a armadilha de auth caseira.

### API — REST com versionamento `/api/v1/`

REST sobre HTTPS. JSON. Documentação OpenAPI 3.0 gerada automaticamente. Rate limiting por API key e por user. Authentication via JWT emitido por Cognito.

#### Porquê REST e não GraphQL

REST: cada URL endpoint devolve dados específicos. `/api/v1/members/123` devolve member 123. Simples, previsível, conhecido por 99% dos developers.

GraphQL: um único endpoint onde o cliente escreve uma query. Poderoso, flexível, mas mais complexo de operar.

Razões para REST na v1: talent pool maior e mais barato; tooling maduro; caching natural em CloudFront; debugging mais simples. GraphQL fica em aberto para v2 ou v3 se as apps evoluírem para precisar de 10+ chamadas REST por ecrã.

### API por domínio

- `/api/v1/members/...`
- `/api/v1/conversations/...`
- `/api/v1/committee/...`
- `/api/v1/matches/...`
- `/api/v1/cards/...`
- `/api/v1/partners/...`
- `/api/v1/transactions/...`
- `/api/v1/admin/...`

### Eventos — EventBridge

Event bus central. Cada acção significativa gera evento (`member.approved`, `payment.completed`, `match.proposed`, `card.tapped`). Outros componentes subscrevem. Detalhe na Secção 12.

### Compute — Lambda + ECS Fargate

Lambda para handlers de API e processamento de eventos curtos. Fargate para serviços com estado ou que ultrapassem 15 min. Evita Kubernetes (over-engineering nesta fase) mas mantém opções abertas.

### Frontend — Next.js (web), React Native + Expo (mobile)

Next.js para todas as superfícies web. React Native + Expo para iOS e Android — codebase única, deploys OTA possíveis. Detalhe na Secção 13.

### Storage — S3 + CloudFront

S3 para todos os blobs. CloudFront para CDN global. Encryption at rest. Lifecycle policies. Signed URLs para acesso privado.

---

## 6. Modelo de dados

Onze objectos centrais. Desenhado para suportar 1MM desde o primeiro registo.

> *Detalhe de campos, índices e relações fica para Database Schema v1.0, produzido com Codex no início da implementação.*

### Tier Names vs Tier Labels

Distinção crítica:

- **Tier Names** — imutáveis no sistema, sempre em Inglês, em base de dados, Stripe, API, código: Subscriber, Club, Premier, Patron, Founder
- **Tier Labels** — editorial, podem evoluir, apresentação visual: ACCESS POINT, ENTRY, PRESENCE, BY EXCEPTION, PRIVATE

Developer altera código sem tocar em Tier Names; copy e marketing evolui Tier Labels sem afectar nada técnico.

### Os onze objectos

#### 01. Person

Cada ser humano que interage com a Presttige. ID UUID que persiste para sempre. Status evolui: `candidate`, `under_review`, `approved_subscriber`, `active_club`/`premier`/`patron`, `founder`, `paused`, `departed`, `partner_contact`, `internal_team`, `blocked`, `deceased`.

Atributos: ID, nome legal, nome preferencial, emails, telefones, países, data de nascimento, género, status actual, histórico, source de aquisição, idiomas, GDPR consents.

#### 02. Conversation

Cada conversa comercial ou de relação. Stages: `identified`, `contacted`, `meeting_scheduled`, `meeting_done`, `proposal_sent`, `negotiating`, `won`, `lost`, `paused`.

#### 03. Approval

Cada decisão do Comité. Estados: `submitted`, `under_review`, `awaiting_information`, `approved`, `deferred`, `rejected`. Inclui reasoning, tier proposto, audit trail.

#### 04. Membership

Quando Approval resulta em entrada efectiva. Liga Person ao tier, datas, status de pagamento, Stripe Subscription ID, histórico de tier changes.

#### 05. Match

Cada introdução proposta. Inclui as duas Persons, quem propôs, estado, contexto, canal de comunicação posterior.

#### 06. Transaction

Cada movimento financeiro. Subscriptions, refunds, partner revenue share, agency commissions, affiliate payouts.

#### 07. Partner

Cada parceria operacional. Terms, modo de partilha de revenue, tipo, cidades cobertas, status.

#### 08. CardEvent

Cada evento de Member Card. NFC tap, geofence entry, card download, push update, value dashboard interaction, badge unlock.

#### 09. Communication

Cada email, SMS, push, carta, conversa de renovação. From, to, channel, template, send time, open, reply.

#### 10. Document

Contratos, NDAs, ID verifications. Encriptação reforçada (KMS). Access log. Retention policy explícita.

#### 11. AuditLog

Toda acção significativa. Quem, quando, o quê, antes/depois. Imutável. Retido 7 anos.

### Relações

Person tem múltiplas Memberships ao longo do tempo. Approval gera Membership. Match liga duas Persons. Transaction liga Person + Membership. Partner tem múltiplas Persons. CardEvent liga Membership + Partner. Communication liga Person. Document liga Person ou Partner. AuditLog regista qualquer acção. Estrutura simples e canónica — a complexidade vive nas regras de negócio.

---

## 7. Autenticação, papéis e Founder Channel

Autenticação confirma quem és. Autorização confirma o que podes fazer. Camadas distintas, ambas desenhadas desde o início para o leque completo de papéis.

### Os sete papéis

- **MEMBER** — utilizador final activo. Acede à app e Member Portal
- **COMMITTEE** — Antonio + Ana + futuros membros. Aprova candidatos, faz curation
- **ADMIN** — Antonio (e futuro Tech Lead, Head of Operations). Acesso total
- **PARTNER** — contacto humano de um Partner. Acede ao Partner Portal
- **AGENCY** — agências comerciais. Vê o seu pipeline
- **FOUNDER** — relação especial, ver Founder Channel abaixo
- **ANONYMOUS** — visitante público. Express Interest, páginas públicas

### Fluxos por papel

#### MEMBER

- Email + magic link (sem password)
- Biometric opcional na app
- 2FA obrigatório para operações sensíveis (mudar pagamento, GDPR export, eliminar conta)

#### COMMITTEE / ADMIN / PARTNER / AGENCY — 2FA sempre obrigatório

- Email + password forte
- 2FA obrigatório em cada login (Authenticator app preferida)
- Session timeout: 8h Committee, 4h Admin/Partner/Agency
- Hardware security key (YubiKey) recomendada para Admin top-level
- Audit log entry em cada login

### Magic Links

O fluxo actual de tier-select usa `magic_token` + `lead_id` no URL. Padrão generaliza-se: qualquer link sensível por email contém token single-use ou time-limited. Tokens hashed em base de dados, expiração conforme sensibilidade (15 min payments, 7 dias tier selection, 24h profile changes), invalidados após uso.

### Founder Channel — relação humana, não login

> *Ao nível Founder não pedimos que entres em nenhum sistema. Vamos ter contigo, pessoalmente, no canal que tu escolhes.*

Cada Founder tem associado uma linha WhatsApp dedicada (gerida manualmente, não automatizada), uma linha telefónica directa (número privado), e email pessoal de membro do Comité (não `info@`).

A Presttige inicia o contacto, não o Founder. Renovações, requests, introduções — todos passam por contacto pessoal. Founder verification para acções sensíveis acontece via canal humano: Antonio ou Comité fala directamente, confirma intent, sistema regista "human-verified by [Committee member]".

Se um Founder quer aceder à app ou portal, tem acesso completo a nível Patron-equivalent — opcional, não obrigatório.

Esta decisão tem implicações no data model, no AuditLog, na segurança. Não é uma cortesia — é uma estrutura. O dinheiro não compra esta relação. Tempo e atenção humana compram.

---

## 8. GDPR e privacidade

Aplicação imediata e não-negociável desde o primeiro membro. O caminho operacional de certificações (ISO 27001, SOC 2, UAE PDPL) está na Secção 9.

### Os direitos GDPR

#### Direito ao acesso

Person pede exportação completa. Sistema gera relatório JSON+PDF estruturado em 72 horas. Query estruturada percorre todos os objectos relacionados com o Person ID, gera relatório, envia link seguro de download.

#### Direito ao apagamento

Duas fases: imediata (anonimização — remove identificadores pessoais, preserva integridade do AuditLog e Transactions financeiras conforme exigências legais) e completa (após período de retenção legal, apaga registos preserváveis).

AuditLog substitui Person ID por pseudonym permanente. Transactions ficam preservadas com pseudonym (obrigação fiscal) sem identificação directa.

#### Direito à portabilidade

Dados em formato standard (JSON conforme schema documentado), permitindo migração.

#### Direito à rectificação

Person actualiza próprios dados via Member Portal e app. Para mudanças sensíveis (nome legal, ID document) há fluxo de validação.

#### Consentimento granular

Cada Person tem consents armazenados: marketing emails, partner sharing, analytics opt-in, communication channels. Cada consent tem timestamp e IP. Pode ser revogado individualmente sem afectar membership.

### Residência de dados

Base de dados primária em AWS `eu-west-1` (Irlanda) por compliance europeia. Read replicas noutras regiões para performance. UAE como mercado primário não exige residência local hoje, mas o desenho multi-region já está pensado.

### Encryption

At rest: tudo encriptado por defeito (Aurora encryption, S3 SSE com KMS-managed keys). In transit: TLS 1.3 mínimo, certificate pinning nas apps. Documents particularmente sensíveis (ID verifications) têm encryption adicional ao nível da aplicação.

### Audit obrigatório

Qualquer acesso a dados pessoais por role que não é o próprio MEMBER gera entrada no AuditLog. Em investigação ou pedido GDPR, é possível mostrar exactamente quem viu o quê e quando.

---

## 9. Compliance e certificações — caminho operacional

Operacionaliza o Princípio 11. Define frameworks, cadência de auditoria, ownership.

### Frameworks

#### ISO 27001 — destino dentro de 12-18 meses

Standard internacional de gestão de segurança de informação. Para uma rede privada operando em Dubai, Londres, Nova Iorque, é exigência tácita de parceiros institucionais.

Caminho:

- Mês 1-3: documentação de políticas e controles em paralelo com o código
- Mês 4-9: implementação de controles, evidência de operação contínua
- Mês 10-12: pré-auditoria interna, identificação e correcção de gaps
- Mês 13-15: auditoria de certificação Stage 1 (documentação) + Stage 2 (operação)
- Mês 16-18: certificação obtida

Custo primeiro ciclo: 25-40.000 EUR. Renovação anual: 10-15.000 EUR/ano.

#### SOC 2 Type II — em paralelo com ISO 27001

Standard americano equivalente. Type II avalia operação ao longo de período mínimo 6 meses. Crítico para parcerias com empresas baseadas em US e apresentação a investidores. 80% dos controles partilhados com ISO 27001. Custo incremental: 15-25.000 EUR para primeiro ciclo.

#### PCI-DSS — relevância parcial

Stripe Checkout (já em uso) mantém a Presttige na categoria SAQ-A — auditoria mínima. Manter isto significa nunca tocar em dados de cartão directamente. Princípio inviolável.

#### UAE Personal Data Protection Law

Federal Decree-Law No. 45 of 2021 — equivalente UAE ao GDPR. Como sede ULTRATTEK LLC FZ está em Dubai e dados primários ficam em AWS `eu-west-1`, configuração actual cumpre. Exige documentação específica de cross-border data flow e nomeação de DPO registado nos EAU.

#### Frameworks emergentes — atenção contínua

EU AI Act (relevante para Match algorítmico). Digital Services Act (plataformas com utilizadores UE). UAE Cybersecurity Law. Antonio (e mais tarde Tech Lead + Legal counsel) revêem trimestralmente.

### Auditor-ready por desenho

Em qualquer momento, um auditor pode pedir e o sistema responde:

- Quem acedeu a quais dados pessoais nos últimos 12 meses — minutos
- Lista de incidentes de segurança detectados — automático via Datadog
- Evidência de patches de segurança aplicados — automático
- Rotação de chaves KMS — automático
- Backups e disaster recovery testados — runbooks AWS
- Política de retenção e apagamento — queries directas
- Acessos privilegiados (admin actions) — AuditLog

Não há fase de "preparação para o auditor". Sistema sempre auditor-ready.

### Cadência de revisão

- **Mensal:** review de incidentes (mesmo que zero)
- **Trimestral:** revisão de políticas, controles, estado de certificações pelo Comité
- **Semestral:** penetration testing externo (a partir de pré-lançamento das apps)
- **Anual:** auditoria externa de certificações activas

### Ownership

- Hoje: Antonio é ponto único de responsabilidade legal e compliance
- Codex executa instruções de implementação
- Quando Tech Lead entrar: ownership operacional transfere; accountability legal mantém-se com Antonio enquanto for CEO
- DPO outsourced quando atingir 1.000+ membros pagantes
- Legal counsel especializado em fintech/luxury/UAE — relação contínua
- Consultoria de certificação durante ciclo, depois renovação anual

### Custos consolidados de compliance

- Legal counsel: 5-10.000 EUR/ano em retainer + ad-hoc
- DPO outsourced: 8-15.000 EUR/ano
- Consultoria ISO 27001 + SOC 2 (primeiro ciclo): 40-65.000 EUR
- Renovação anual de certificações: 25-40.000 EUR/ano
- Penetration testing semestral: 10-15.000 EUR/ciclo
- Auditor GDPR externo (uma vez): 5-10.000 EUR

Total recorrente após primeiro ano: 60-95.000 EUR. Primeiro ano (incluindo certificação inicial): 100-150.000 EUR. Linha de orçamento separada da Secção 19, não-negociável.

---

## 10. Multi-tenancy

Cada registo na base de dados tem campo `tenant_id`. Hoje só existe o tenant `"presttige"`. Quando Glow é onboarded, é criado tenant `"glow"`.

Row-level security no PostgreSQL garante filtragem automática por `tenant_id` baseado no role autenticado. Glow user nunca vê dados de outro partner ou da Presttige core. ADMIN Presttige vê todos os tenants.

### Porque importa agora

- Segundo partner entra sem reescrita
- Resposta a partners que pedem acesso aos seus dados é "sim, hoje"
- White-label permanece em aberto
- Compliance e auditoria por tenant fica trivial

Custo de implementar desde o início: praticamente zero. Custo de adicionar depois: massive — migração de dados, reescrita de queries, redesign de auth.

---

## 11. Versionamento de API

Toda a API pública é `/api/v1/...` desde o primeiro endpoint. Quando v2 for necessária, v1 continua a funcionar.

### Clientes que dependem da API

- App iOS (versões antigas continuam em v1 até actualização)
- App Android
- Member Portal web
- Admin Panel
- Partner Portal
- Future partner integrations
- Webhooks subscritos por parceiros

### Política de deprecation

v2 introduzida → v1 entra em "deprecated" mas continua funcional. Comunicação a developers com 6 meses de antecedência. Sunset date anunciada. v1 sunsetada apenas quando 95%+ do tráfego está em v2.

---

## 12. Eventos

EventBridge é o sistema nervoso da Presttige. Cada acção significativa gera evento. Outros componentes reagem assincronamente.

### Exemplos

- `member.approved` → email de boas-vindas, provisioning de Card, actualização de analytics
- `payment.completed` → actualização de Membership, envio de receipt, cálculo de partner revenue share
- `match.connected` → criação de canal de mensagens, push notification, log de audit
- `card.tapped` → billing do partner, analytics, geolocation enrichment

### Vantagens

- Componentes desacoplados
- Resiliência por retry automático
- Audit trail completo
- Webhooks para parceiros
- Replay para debug

---

## 13. Mobile

React Native + Expo. Codebase única, builds para iOS e Android, deploys OTA possíveis para correcções não-críticas.

### Porquê não nativo

Manter dois codebases nativos (Swift + Kotlin) à velocidade que a Presttige vai precisar exige equipa móvel grande — pelo menos 2 engineers iOS, 2 Android, plus Tech Lead móvel. Insustentável até 50.000+ members.

React Native moderno (0.74+) com Expo SDK 51+ é praticamente indistinguível de nativo para 95% dos casos.

### Features que exigem cuidado

- PassKit (Apple Wallet) — biblioteca React Native existente
- Google Wallet — equivalente disponível
- NFC tap detection — plugin nativo (existe)
- Geofencing background — permissões delicadas
- Push via APNs e FCM
- Biometric auth

### Releases

Major (features, mudanças UI): App Store + Play Store, com review obrigatória. Bugs e correcções menores: OTA via Expo Updates — aplicados ao abrir a app, sem passar pelas stores.

---

## 14. Member Cards

Os Member Cards são a bandeira do produto.

> **APPLE NFC ENTITLEMENT — DAY 1 ACTION ITEM.** Pedido formal à Apple Developer Program para NFC Tag Reading entitlement (Core NFC com background reading) submetido por Antonio no primeiro dia útil após aprovação deste documento. 4 semanas de espera. Sem este entitlement, Frente 3 fica bloqueada.

### Componentes

- Card design templates (4 — Founder preto, Patron dourado escuro, Premier prata, Club creme), em Apple PassKit (.pkpass) e Google Wallet API (JSON)
- Card generation service — quando Membership é criada/actualizada, gera o card
- Push update service — quando campo do card muda (renovação, badge, valor), envia push update via APNs ou FCM. Card actualiza-se sozinho no telemóvel sem o user fazer nada. Propriedade de marca, não apenas técnica: o Card é vivo, não estático
- NFC tap reader — em parceiros, POS app ou device verifica autenticidade do card via API call assinada
- Geofence triggers — apps detectam entrada em geofences e emitem eventos
- Value dashboard — UI dentro da app que mostra valor acumulado de pertencer
- Streak badges — gamificação ligeira para encorajar engagement

### Card design

Designer único cobre Cards + Forms + Portal UX + Match UX + decks impressos. Briefing único — coerência visual garantida.

### Backend escalável

Gerar e actualizar cards para 1MM members: cada update push é uma chamada APNs ou FCM. À escala, batch processing assíncrono via Lambda + SQS é obrigatório.

---

## 15. Arquitectura de Partners

Como parceiros (Glow, hotéis, marcas, leiloeiras, casas-galeria) interagem com a Presttige operacionalmente.

### Os cinco componentes

#### 01. Partner Portal (web)

Interface segura. Cada partner user acede com email + password + 2FA obrigatório. Vê apenas dados do seu próprio tenant.

- Lista de membros que interagiram com este partner
- Calendário de próximos eventos com membros confirmados
- Estatísticas de redenção
- Revenue share dashboard
- Capacidade de criar novos eventos para curadoria do Comité
- Registo manual de interacção (caso NFC tap falhe)
- Comunicação com a equipa Presttige (chat ou ticket)

#### 02. Partner Scanner App (móvel)

App no telemóvel ou tablet do staff. Login restrito ao partner específico.

- **Mode primário** — NFC tap
- **Mode fallback** — QR code scan (caso NFC falhe)
- **Mode manual** — pesquisa por nome ou email (último recurso)

Resposta imediata: aprovado/recusado, tier, benefícios aplicáveis, notas públicas (não privadas). Funciona offline com sincronização posterior — crítico para eventos com WiFi instável.

#### 03. Member-Authorised Notes

Membro escolhe partilhar notas com partners. Granularidade:

- Notas gerais — todos os partners do tipo
- Notas para partners específicos
- Notas para todos os partners do mesmo tier

Sistema rege-se por consentimento granular GDPR. Membro controla totalmente.

#### 04. Partner Feedback Loop

Após cada interacção, partner pode (não obrigatório):

- Qualidade geral da experiência
- Eventuais problemas
- Notas privadas (visíveis apenas pelo Comité, nunca pelo membro)
- Sugestões para melhoria do match

Feedback alimenta sistema de match e curadoria interna.

#### 05. Outbound Invitations

Glow tem 50 lugares para evento. Quer 12 para membros Presttige.

No Partner Portal: "Submit experience for Presttige curation" → define capacidade, tier mínimo, perfil ideal. Comité curates → escolhe membros → convites partem da Presttige (não do partner directamente, a marca é Presttige) → membros aceitam ou recusam via app → lista final volta ao partner.

> *O membro nunca é "vendido" pelos parceiros. É curado pela Presttige, sempre.*

### Onboarding operacional de partner

- Conversa inicial vive como Conversation no CRM
- Acordo formal assinado — Document ligado ao Partner record
- Onboarding técnico — Codex cria Partner record, tenant ID, contas no Portal, configuração, dispositivos NFC reader programados
- Treino do staff — vídeo curto, idealmente sessão ao vivo
- Pilot de 30 dias com observação próxima por Antonio/Ana
- Ongoing — revisão trimestral conjunta

---

## 16. Observabilidade

Responde a "o sistema está saudável?". Diferente de Analytics (Secção 17), que responde a "o que está a acontecer no negócio?".

### Métricas técnicas

- API latency (p50, p95, p99 por endpoint)
- Error rate (4xx e 5xx)
- Database performance
- Lambda execution time e cold starts
- EventBridge throughput e dead letter queue
- CloudFront cache hit ratio
- Mobile app crash rate (iOS e Android)

### SLOs

- API availability: 99.9% (máx 8.7h downtime/ano)
- API latency p95: < 300ms
- Mobile app crash rate: < 0.1%
- Payment processing success: > 99.5%

### Alerting

PagerDuty ou Opsgenie. Pré-Tech Lead, alertas vão para Antonio + Codex via SMS e email para SEV-1. SEV-2 e SEV-3 por email apenas, processados em horário comercial.

---

## 17. Analytics

> *Sem analytics, decide-se por opinião. Com analytics, decide-se por evidência.*

### Fontes — tudo o que é mensurável é medido

- Website — page views, bounce rate, source de tráfego, conversão Express Interest
- Member Portal — sessões, features mais usadas, abandonment
- Apps — installs, DAU, MAU, session length, retention curves, push engagement
- Member Cards — taps por dia/partner/cidade, geofence triggers, downloads, value dashboard, badges
- Partner interactions — invitations sent vs accepted, redemption rates, revenue share, feedback
- Match — proposals, mutual acceptance, conversation rates, blocks, time-to-first-meeting
- Communications — open rates, CTR, reply rates
- Express Interest funnel — submissions, conversion to Subscriber, time in review, approval rate
- Tier conversions — Subscriber → Club, Club → Premier, Premier → Patron, churn em cada nível
- Financeiras — MRR, ARR, ARPU, LTV, CAC, churn cohort analysis
- Curadoria — throughput, decision time, distribuição geográfica, source attribution

### Níveis — segmentação multi-dimensional

- Tenant — Presttige core vs cada partner separadamente
- Tier
- Cidade — Dubai, Londres, NY, Paris, São Paulo, Miami, Barcelona, Hong Kong
- País de residência
- Cohort de aquisição
- Tempo — daily, weekly, monthly, quarterly, yearly, custom
- Source — referrer, agency, partner, organic
- Faixa etária

### View scopes — quem vê o quê

#### Antonio — visibilidade total

Acesso completo. Dashboard executivo com vista macro e drill-down a cada métrica.

#### Committee

Foco em curadoria e qualidade. Aprovação, tempo de revisão, distribuição geográfica, mutual acceptance rate, partner satisfaction. Acesso financeiro limitado: volumes agregados, não detalhe individual.

#### Ana — pipeline comercial e parcerias

Foco em partnerships pipeline, performance de partners activos, revenue share, agency performance, trusted voices. Métricas comerciais detalhadas. Pipeline value e partner revenue. Sem acesso a financeiras consolidadas de membership.

#### Partners — only-self, RLS-enforced

Cada partner vê apenas o seu sub-universo. Members que interagiram com o seu venue, taps, RSVPs aceites, revenue share gerado, feedback recebido. Nunca dados de outros partners ou Presttige core.

#### Founders — relacional, partilha discricionária

Acesso opcional. Quando acedem: total de membros na rede, distribuição geográfica e por tier, eventos próximos. Antonio decide caso a caso o que partilhar com cada Founder.

#### Tech Lead (futuro) — operacional

Saúde operacional, custos de infrastructure, performance, incidentes. Vista de negócio (custo por membro, custo de infrastructure por feature). Sem acesso a detalhe individual excepto em incidentes (e nesse caso sempre com entrada no AuditLog).

### Camada técnica

- Data warehouse separado da operational database — AWS Redshift ou alternativa
- ETL/ELT contínuo da Aurora primária e do EventBridge
- Eventos comportamentais (web, app) via tooling especializado — Amplitude, Mixpanel, ou Segment
- Dashboards em Looker, Mode, ou Metabase
- Privacy preservation — agregação onde possível, sem dados pessoais brutos
- Retention segue política GDPR

### Quando entra

Não Day 1 — prioridade são as três frentes (Apps, Sistema Operacional, Cards) e tracking básico via EventBridge + Datadog. Analytics dedicada entra mês 3-4 quando há volume real. Antes disso, métricas básicas em queries directas à Aurora e dashboards simples no Datadog.

Mas o data model é desenhado desde o primeiro dia para suportar analytics — todos os eventos relevantes capturados, todos os IDs preservados, todos os timestamps UTC com timezone metadata.

---

## 18. As três frentes em paralelo

Apps, Sistema Operacional, Member Cards avançam em paralelo a partir de Maio 2026. Briefings próprios, calendários próprios, mas todas partilham a arquitectura definida acima.

### Frente 1 — Apps iOS + Android

- React Native + Expo
- Codex + Mobile Lead freelance entrando Junho-Julho
- Submissão final de Outubro 2026
- Lançamento público: 21 de Dezembro de 2026
- Custo: 8-15.000 EUR/mês × 5-6 meses

### Frente 2 — Sistema Operacional Presttige

- Next.js, partilhando 100% do data model com as Apps
- Codex (autónomo, com revisão de Antonio)
- v0.1 funcional: 6 semanas
- v1.0 completo: 3-4 meses
- Custo: incluído no de Codex

### Frente 3 — Member Cards

- PassKit + Google Wallet
- Codex + designer freelance (briefing único)
- Bloqueio Day 1: Apple NFC entitlement (Secção 14) — sem este, Frente 3 não arranca
- Primeiro Card emitido: 6 semanas após NFC entitlement aprovado
- Custo: 15-30.000 EUR em design e implementação inicial

### Coordenação

Frentes partilham mesma base de dados, Cognito, API, EventBridge, Datadog. Aplicação directa do Princípio 02 — não duplicam infrastructure nem podem divergir em decisões fundamentais.

---

## 19. Calendário e custos até Dezembro 2026

### Calendário

- **Maio:** documento aprovado; NFC entitlement pedido; designer briefing; Sistema Operacional v0.1 começa; Mobile Lead identificado
- **Junho:** Sistema Operacional v0.1 em uso interno; Mobile Lead começa; Apps em desenvolvimento; Card designs aprovados; NFC entitlement aprovado
- **Julho:** Sistema Operacional v0.5; Apps em alpha interno; primeiros Cards distribuídos
- **Agosto:** Sistema Operacional v1.0; Apps em beta fechado; Match em produção interna
- **Setembro:** Apps em beta aberto; estabilização; início recrutamento Tech Lead
- **Outubro:** submissão à App Store e Play Store mid-Outubro
- **Novembro:** aprovação stores; soft launch; última ronda de polish
- **Dezembro:** 21 de Dezembro — lançamento público

### Custos de desenvolvimento (Maio → Dezembro)

- Codex: 4-6.000 EUR/mês × 8 = 32-48.000 EUR
- Mobile Lead freelance: 6-9.000 EUR/mês × 6 = 36-54.000 EUR
- Designer (briefing único): 15-25.000 EUR
- AWS infrastructure: 1.000 EUR/mês × 8 = 8.000 EUR
- Datadog: 300-500 EUR/mês × 8 = 2.400-4.000 EUR
- Software (Figma, Linear, GitHub): 500-800 EUR/mês × 8 = 4-6.500 EUR
- Voz e música para vídeo: 600-1.200 EUR
- Vídeo agência boutique: 8-15.000 EUR
- Material impresso: 5-10.000 EUR

Total desenvolvimento: 110-180.000 EUR. Não inclui compliance (Secção 9, 100-150.000 primeiro ano), comerciais, ou legais ad-hoc.

---

## 20. Tech Lead — três gatilhos

> *Tech Lead vem no momento em que se comece a faturar. Não antes.*

O primeiro gatilho a chegar acciona o recrutamento.

**01.** MRR acima de 30-50.000 EUR sustentado durante 2 meses consecutivos.

**02.** Mais de 2.000 membros activos pagantes (Club + Premier + Patron + Founder).

**03.** Lançamento público das apps em 21 de Dezembro de 2026. Recrutamento começa em Setembro/Outubro 2026 para integração em Janeiro 2027, mesmo que os outros gatilhos não tenham disparado.

### O que o Tech Lead recebe

- Plataforma única, em produção, a vender
- Este documento e a sua evolução
- Documentação completa de decisões técnicas
- Codebase organizada
- Equipa potencial para crescer
- Métricas operacionais via Datadog
- Roadmap claro até final 2027

### Perfil

Operou sistemas de pelo menos 100.000 utilizadores. Experiência em produtos premium ou luxury. Entende a tensão entre velocidade de produto e qualidade operacional. Operador-construtor — não arquitecto puro nem manager puro.

---

## 21. Proibições

Lista terminológica. Quando alguém propuser, a resposta é "está aqui escrito que não".

- CRM SaaS (Folk, HubSpot, Salesforce, Pipedrive) como sistema operacional principal
- SQLite, MySQL, ou NoSQL document stores como base de dados primária
- Auth caseira
- API sem versionamento
- Dois codebases mobile sob equipa pequena
- Sistemas separados que sincronizam
- Hard-coded brand language ou tier names
- Tradução automática do site
- Polling como solução padrão
- Cron jobs como arquitectura
- Dados pessoais em logs de aplicação (vão no AuditLog)
- Acesso a dados pessoais sem entrada no AuditLog
- Login automatizado para Founders em coisas sensíveis
- 2FA opcional para Committee, Admin, Partner, ou Agency
- Decisões técnicas tomadas sem actualização deste documento
- Lançamento de feature sem métricas Datadog correspondentes
- Lançamento de feature sem evidência de conformidade GDPR
- Adiamento de certificações ISO 27001 ou SOC 2
- Tratamento de dados de cartão directamente na infrastructure Presttige
- Cross-border data transfers sem documentação e legal basis
- Decisões de produto que afectem privacidade ou compliance sem revisão prévia

---

## 22. Manutenção do documento

### Quando se actualiza

- Decisão técnica fundamental muda
- Princípio refinado ou novo
- Gatilho do Tech Lead dispara
- Tech Lead entra (transição formal)
- Frente nova de desenvolvimento torna-se estratégica

### Quem propõe mudanças

- Antonio Pereira (always)
- Codex (propostas técnicas, sujeitas a aprovação)
- Tech Lead quando entrar
- Mobile Lead, designers, outros: levantam problemas que disparam revisão; não modificam directamente

### Versionamento

Mudanças menores: v1.4, v1.5. Mudanças significativas: v2.0. Cada versão preserva a anterior. Cada nova versão carrega Changelog no início.

---

> *Este documento é o pacto que protege a Presttige do erro mais comum em produtos premium: ganhar tracção e descobrir que não estavam preparados para o sucesso.*

Aprovado por Antonio Manuel Pereira em 6 de Maio de 2026. Versão 1.3 — revisão de prosa para eliminar repetições.

**Fim do documento.**
