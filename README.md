# Prospecção Instagram — manual de uso

Sistema que manda a primeira mensagem para clientes em potencial no Instagram
sozinho, continua a conversa quando a pessoa responde, e vai te avisando o
que precisa da sua atenção. Roda na sua própria máquina, com a sua conta.

Este README ensina a instalar, configurar e usar pelo painel — sem precisar
mexer em código. Documentação técnica mais funda fica em [`SETUP.md`](./SETUP.md)
e [`docs/architecture.md`](./docs/architecture.md).

---

## 1. Antes de instalar

Você vai precisar, além deste repositório:

- **Node.js** (versão LTS) — [nodejs.org](https://nodejs.org)
- **Google Chrome** — [google.com/chrome](https://google.com/chrome)
- **cloudflared** — [github.com/cloudflare/cloudflared/releases](https://github.com/cloudflare/cloudflared/releases),
  baixe o instalador `.msi` do Windows
- **Uma conta comercial (business) do Instagram**, com um app criado no
  [developers.facebook.com](https://developers.facebook.com) — passo a passo
  completo na seção 4

## 2. Instalar

1. Baixe/clone este repositório na sua máquina.
2. Dê dois cliques em **`instalar.bat`**. Uma janela preta abre e instala
   tudo sozinha (pode levar alguns minutos). Quando terminar, feche a janela.

## 3. Abrir o sistema

Dois cliques em **`iniciar.bat`**. Uma janela preta fica aberta (é o motor do
sistema rodando — não feche) e o navegador abre sozinho em
`http://localhost:3000`, no **Painel**.

No menu da esquerda, vá em **Sistema**. É lá que você configura tudo.

---

## 4. Criar o app no Facebook/Meta (uma vez só)

O sistema manda a primeira mensagem pelo navegador, mas as respostas do lead
chegam por um app oficial da Meta (é a Meta quem entrega a mensagem pro
sistema, via "webhook"). Sem isso, o sistema não fica sabendo que a pessoa
respondeu.

### 4.1 Criar o app

1. Entre em [developers.facebook.com](https://developers.facebook.com) e
   faça login com a conta do Facebook ligada ao Instagram comercial.
2. **Meus Apps → Criar App**.
3. Tipo de app: **"Outro"** → **"Empresa"**.
4. Dê um nome (ex: "Prospecção Instagram") e crie.

### 4.2 Adicionar o produto certo

1. No painel do app, procure **"API do Instagram com login do Instagram"**
   (não é a "API do WhatsApp" nem a "Instagram Graph API" antiga) e clique em
   **Configurar**.
2. Siga o assistente para conectar a conta comercial do Instagram. Ele vai
   pedir para você logar no Instagram e autorizar o app.

### 4.3 Pegar as chaves

No painel do app, em **Configurações do App → Básico**:

- **ID do App** e **Chave Secreta do App** (App Secret) — clique em
  "Mostrar" para revelar a chave secreta. Essa é a **App Secret** que vai no
  painel do sistema.

Em **API do Instagram com login do Instagram → Configuração da API**:

- Gere o **token de acesso de longa duração (60 dias)** da conta — essa é o
  **Token de acesso da página** que vai no painel.
- Pegue o **ID da conta do Instagram** (número) — vai no campo **ID da conta
  comercial do Instagram** do painel.

> O token de 60 dias é renovado sozinho pelo sistema depois (não precisa
> voltar aqui toda hora). Só ao configurar pela primeira vez.

### 4.4 Permissões

Em **Revisão do App → Permissões e Recursos**, peça/ative:

- `instagram_business_basic`
- `instagram_business_manage_messages`

Para testar sozinho (sem revisão da Meta), adicione sua própria conta do
Instagram como **testador**: **Funções do App → Testadores** → adicione o
usuário → aceite o convite pelo próprio Instagram (Configurações → Apps e
sites).

### 4.5 Webhook (a parte que muda a cada uso)

1. No painel do sistema (aba **Sistema**), clique em **"Iniciar túnel"**.
   Uma URL vai aparecer (algo como
   `https://palavras-aleatorias.trycloudflare.com/api/webhooks/instagram`).
2. Clique em **"Testar"**. Só continue se aparecer "OK, pode colar na Meta".
3. Copie a URL do painel.
4. Na Meta, vá em **API do Instagram com login do Instagram → Configuração →
   Webhooks**.
5. Cole a URL em **"URL de callback"**.
6. Em **"Verificar token"**, cole o mesmo valor que está no campo **"Token de
   verificação do webhook"** no painel do sistema (aba Sistema, seção
   "Chaves de API"). Se ainda não preencheu esse campo, escolha uma palavra
   qualquer (ex: `minhaempresa-wh-2026`), salve no painel primeiro, e só
   depois use o mesmo valor aqui.
7. Clique em **Verificar e salvar**.
8. Ainda na tela de Webhooks, inscreva o campo **`messages`** (é isso que
   avisa o sistema quando alguém responde a DM).

> **Atenção:** toda vez que você reiniciar o túnel (fechar e abrir o
> `iniciar.bat` de novo, por exemplo), a URL muda. Repita os passos 1–3 e
> 5–7 (só o campo URL de callback muda; o token de verificação continua o
> mesmo).

---

## 5. Preencher a aba Sistema

Tudo isso fica em `http://localhost:3000/sistema`, de cima para baixo:

### 1. Chrome (envio da 1ª mensagem)

Botão **"Abrir Chrome"** abre uma janela do Chrome dedicada (separada do seu
Chrome pessoal) com uma porta de depuração ativa — é por ela que o sistema
"aperta os botões" para mandar a primeira mensagem.

Na primeira vez, **faça login no seu Instagram nessa janela**, na mão, uma
única vez. Nas próximas vezes o login fica salvo.

Deixe essa janela aberta enquanto o sistema estiver mandando mensagens. Ela
nunca mexe no seu mouse/teclado — abre a própria aba dela.

### 2. Túnel público (para o webhook da Meta)

Botão **"Iniciar túnel"** — veja a seção 4.5 acima. A URL que aparece aqui é
o que você cola no painel da Meta.

### 3. Negócio (o que a IA fala em nome dele)

Isso define como o sistema se apresenta e o que ele tem permissão de
afirmar. Campo por campo:

| Campo | O que colocar |
|---|---|
| **Seu nome** | Seu nome de verdade — a mensagem se apresenta como você, pessoa física, não como "a empresa". |
| **Seu cargo/papel** | Ex: "Fundador", "Sócio", "Desenvolvedor". |
| **Nome da empresa** | Nome que aparece na apresentação ("Sou o Fulano, da [Empresa]"). |
| **Site** | Com `https://`. |
| **Usuário do Instagram (sem @)** | O @ da conta comercial que está mandando as mensagens — o sistema nunca manda mensagem para o próprio perfil da empresa. |
| **WhatsApp** | Só os números, com DDD e código do país (ex: `5544999999999`). Vira o link que é oferecido pro lead quando ele quer continuar a conversa lá. |
| **Grupo de afiliados** | Opcional — link de convite, se você tiver um programa de indicação/afiliados. Deixe em branco se não tiver. |
| **País/região** | Ex: `Brasil`. |
| **Frase de apresentação** | Uma linha resumindo o que a empresa faz. |
| **Como funciona** | Um passo por linha — o passo a passo de como é atender um cliente (ex: "Você conta o que precisa", "A gente propõe uma solução", "Entregamos e acompanhamos"). |
| **Como a empresa ganha dinheiro** | Um por linha (ex: "Projetos sob demanda", "Mensalidade de manutenção"). Usado só como contexto interno, não é enviado ao lead. |
| **Segmentos que você atende** | Um por linha — tipos de negócio/profissional que são bons clientes (ex: "clínica odontológica", "loja de roupas", "advocacia"). Usado para pontuar quem vale a pena abordar. |
| **Palavras-chave de busca no Instagram** | Um termo por linha — o sistema usa isso para *procurar* perfis no Instagram (ex: "clínica de estética", "corretor de imóveis"). Quanto mais específico, melhor a qualidade dos leads encontrados. |
| **Afirmações comprovadas** | **O mais importante.** Um fato por linha que é 100% verdade e comprovável (está no site, é possível provar). A IA só pode falar o que estiver aqui. Ex: "Atendemos clientes há 3 anos", "Já entregamos mais de 20 sistemas". |
| **Afirmações NÃO comprovadas** | Coisas que você pensa em dizer no futuro mas ainda não pode provar — ficam **bloqueadas** até você mover para a lista de comprovadas. Serve de lembrete, não precisa preencher. |

Depois de mudar qualquer coisa aqui, clique em **Salvar tudo**.

### 4. Chaves de API

| Campo | Onde conseguir |
|---|---|
| **Chave da IA (Claude / Anthropic)** | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) — crie uma chave nova, em projeto próprio, e defina um limite de gasto mensal (hard limit) no billing. |
| **Token de verificação do webhook** | Você inventa (ex: `minhaempresa-wh-2026`). Usado na seção 4.5. |
| **App Secret** | Painel da Meta → seção 4.3. |
| **Token de acesso da página** | Painel da Meta → seção 4.3. |
| **ID da conta comercial do Instagram** | Painel da Meta → seção 4.3. |

Clique em **Salvar tudo**. Depois de salvar chaves da Meta/IA, **feche e
abra o `iniciar.bat` de novo** para valerem por completo (o motor que manda
mensagens roda em processo separado do painel).

---

## 6. Uso do dia a dia

1. Dois cliques em `iniciar.bat`.
2. Aba **Sistema**: confira se Chrome e túnel estão com a bolinha verde. Se
   o túnel foi reiniciado, repita os passos 5–7 da seção 4.5 (a URL muda).
3. Pronto — o sistema já descobre, qualifica e manda mensagem sozinho,
   dentro dos limites configurados em **Configurações**.
4. Acompanhe pela aba **Painel** (resumo geral), **Leads** (cada contato),
   **Conversas** (o que já foi trocado) e **Exceções** (o que precisa de
   você — token vencendo, mensagem que não conseguiu sair, etc).
5. Botão **"Pausar tudo"** (na aba Painel) para tudo na hora, em qualquer
   situação.

## 7. Se algo der errado

- **"Túnel desligado" ou a URL não bate mais com a Meta"**: clique em
  "Iniciar túnel" de novo e repita a seção 4.5.
- **Chrome fechou sozinho ou perdeu o login**: clique em "Abrir Chrome",
  faça login de novo na janela que abrir.
- **Aparece alerta em Exceções**: leia a mensagem, geralmente explica o que
  fazer (token vencendo, mensagem bloqueada, etc).
- Qualquer outra coisa: tire um print da tela do painel e da mensagem de
  erro, e mande para quem configurou o sistema para você.

---

## Para quem mexe no código

Stack, arquitetura e comandos de desenvolvimento ficam em
[`SETUP.md`](./SETUP.md) (operador, PT-BR) e
[`docs/architecture.md`](./docs/architecture.md) (arquitetura, EN).

```bash
pnpm install
cp .env.example .env
cp config/business.example.json config/business.json
pnpm db:migrate
pnpm dev            # painel :3000 + worker, modo desenvolvimento
pnpm check          # lint + typecheck + test + build de produção
```
