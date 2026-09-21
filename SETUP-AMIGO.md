# Como instalar e usar (sem precisar entender de programação)

## 1. Instalar (uma vez só)

1. Instale o [Node.js](https://nodejs.org) (versão LTS, botão verde).
2. Instale o [Google Chrome](https://google.com/chrome), se ainda não tiver.
3. Instale o [cloudflared](https://github.com/cloudflare/cloudflared/releases) (o instalador `.msi` do Windows).
4. Dê dois cliques em **`instalar.bat`**. Uma janela preta vai aparecer e
   instalar tudo sozinha. Quando terminar, feche a janela.

## 2. Abrir o sistema

Dois cliques em **`iniciar.bat`**. O navegador abre sozinho em
`http://localhost:3000`.

## 3. Configurar (primeira vez)

No painel, clique em **Sistema** no menu da esquerda. De cima pra baixo:

1. **Chrome**: clique em "Abrir Chrome". Uma janela do Chrome vai abrir.
   Faça login no seu Instagram nela, uma vez só.
2. **Túnel público**: clique em "Iniciar túnel". Vai aparecer uma URL —
   copie ela.
3. Vá em [developers.facebook.com](https://developers.facebook.com), no seu
   app → Webhooks, cole essa URL no campo "URL de callback" e no "Verificar
   token" cole o mesmo valor que você colocar no campo "Token de verificação
   do webhook" mais abaixo no painel. Antes de salvar lá, volte no painel e
   clique em "Testar" — se disser "OK, pode colar na Meta", pode salvar.
4. **Negócio**: preencha os dados da empresa (nome, site, WhatsApp,
   Instagram, o que a empresa faz).
5. **Chaves de API**: cole a chave da IA e os dados do app da Meta
   (App Secret, Token de acesso, ID da conta).
6. Clique em **Salvar tudo**.
7. Feche a janela preta (`iniciar.bat`) e abra de novo, pra tudo valer.

## 4. Uso do dia a dia

- Só abrir `iniciar.bat`. Se o Chrome ou o túnel não estiverem abertos,
  reabra os dois na aba **Sistema** (a URL do túnel muda toda vez — copie a
  nova pra Meta de novo).
- Painel principal (**Painel**, no menu) tem o botão **"Pausar tudo"** pra
  emergência.
- **Exceções** mostra o que precisa de você (token vencendo, lead que não
  conseguiu mandar mensagem, etc).

## 5. Se algo der errado

Tire um print da tela e do que apareceu, e manda pra quem instalou pra você.
