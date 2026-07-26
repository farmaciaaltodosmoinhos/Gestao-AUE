# Pedidos AUE — sincronização com o Netlify (sem perda de dados)

Este pacote está pronto a publicar no Netlify diretamente a partir do GitHub.

## Últimas correções (nesta versão)

- **Botão "Formulário de aquisição" removido da barra superior.** Mantém-se apenas
  o botão **"Preencher formulário de aquisição (Alliance Healthcare)"** dentro de
  cada pedido, que já vinha pré-preenchido com os dados desse pedido.
- **Impressão do formulário igual ao ecrã.** O Chrome esconde por defeito as cores
  de fundo ao imprimir; forçámos essas cores a manter-se (`print-color-adjust:
  exact`), pelo que o cabeçalho verde e as barras de secção agora imprimem/geram
  PDF exatamente como aparecem no ecrã.
- **Selo "Desenvolvido por" com tamanho fixo em qualquer ecrã** (incluindo o ecrã
  de login) — reforçado com regras CSS e um estilo direto na imagem, para nunca
  mais aparecer maior do que deve.

## Como publicar via GitHub → Netlify

1. **Criar o repositório no GitHub**
   - Vá a [github.com/new](https://github.com/new), dê um nome (ex.: `pedidos-aue`)
     e crie o repositório (pode ser privado — recomendado, por conter dados de saúde).
   - Não escolha "Initialize with README" (esta pasta já tem um).

2. **Enviar esta pasta para o GitHub**
   Dentro desta pasta, num terminal:
   ```bash
   git init
   git add .
   git commit -m "Pedidos AUE com sincronização Netlify"
   git branch -M main
   git remote add origin https://github.com/SEU-UTILIZADOR/pedidos-aue.git
   git push -u origin main
   ```
   (Substitua `SEU-UTILIZADOR` e o nome do repositório pelos que criou no passo 1.)

3. **Ligar o repositório ao Netlify**
   - Em [app.netlify.com](https://app.netlify.com), clique em **"Add new site" →
     "Import an existing project"**.
   - Escolha **GitHub**, autorize o acesso e selecione o repositório que acabou
     de criar.
   - As definições de build já vêm do `netlify.toml` incluído nesta pasta
     (`npm install`, publica a raiz, funções em `netlify/functions`) — não precisa
     de alterar nada, basta clicar em **"Deploy site"**.

4. **(Recomendado) Definir o código de acesso à sincronização**
   - No site já criado: **Site configuration → Environment variables → Add a
     variable**.
   - Nome: `AUE_SYNC_TOKEN`. Valor: uma frase secreta à sua escolha.
   - Volte a fazer deploy (Deploys → Trigger deploy) para a variável ficar ativa.
   - Em cada computador, abra **"☁ Definições de sincronização"** na app e cole
     o mesmo código.

5. **Atualizações futuras**
   Sempre que quiser publicar alterações, basta:
   ```bash
   git add .
   git commit -m "Descrição da alteração"
   git push
   ```
   O Netlify deteta o push e publica automaticamente uma nova versão.

---

## O que mudou e porquê

1. **Os dados locais nunca são apagados por uma sincronização falhada.**
   O `localStorage` de cada computador é sempre a fonte de verdade imediata.
   Se a sincronização falhar (sem internet, servidor em baixo, erro de rede),
   a aplicação **não toca** nos dados locais — fica só a aguardar nova tentativa.

2. **A sincronização faz sempre uma fusão (merge), nunca uma substituição total.**
   Cada pedido tem agora uma marca temporal `updatedAt`. Ao sincronizar, o mais
   recente por pedido é o que fica — tanto no navegador como no servidor (a função
   Netlify também funde em vez de substituir). Isto evita que a sincronização de
   um computador apague alterações feitas noutro.

3. **Eliminar um pedido já não o remove logo da memória.**
   Fica marcado como eliminado ("tombstone") até essa eliminação ser sincronizada
   com todos os dispositivos. Assim, um pedido eliminado não "ressuscita" por
   engano, mas também não desaparece de um dispositivo sem nunca ter sido avisado
   aos outros.

4. **O indicador da barra lateral força a sincronização sem pedir novo login.**
   O botão "☁" na barra lateral (com uma bolinha verde/âmbar/vermelha) mostra o
   estado atual e, ao ser tocado, tenta sincronizar imediatamente. Nunca pede
   email/palavra-passe — usa, quando muito, um código de acesso próprio,
   totalmente independente da sessão local de entrada na aplicação.

5. **Botão "Guardar alterações".**
   O formulário de cada pedido só grava quando se clica em **"Guardar alterações"**
   — nunca automaticamente a cada tecla premida. Isto evita gravações parciais ou
   acidentais. Depois de gravar localmente, a app tenta sincronizar em segundo
   plano, sem bloquear o ecrã.

6. **Cópias de segurança automáticas.**
   Antes de cada sincronização é guardada uma cópia dos dados tal como estavam
   (até 3 cópias mais recentes), acessível em "☁ Definições de sincronização →
   Restaurar cópia de segurança", para o caso (raro) de ser preciso repor os
   dados manualmente.

7. **Recuperação automática de dados corrompidos.**
   Se, por alguma razão, o `localStorage` principal ficar ilegível, a aplicação
   tenta recuperar automaticamente a última cópia de segurança antes de mostrar
   uma lista vazia.

## Se aparecer "Não foi possível sincronizar (HTTP 500 — blobs_unavailable...)"

Isto significa que o Netlify não conseguiu ligar automaticamente a função de
sincronização ao armazenamento (Netlify Blobs) deste site. Normalmente isto
funciona sozinho, mas em alguns sites (sobretudo recém-criados) essa ligação
automática falha. Corrige-se assim, uma única vez:

1. **Obter o Project ID (Site ID):** no Netlify, abra o seu site → **Project
   configuration → General → Project information** e copie o valor de
   **Project ID**.
2. **Criar um Personal Access Token:** clique no seu avatar (canto superior
   direito) → **User settings → Applications → New access token**. Dê um nome
   (ex.: "Pedidos AUE sync") e copie o token gerado (só é mostrado uma vez).
3. **Adicionar as duas variáveis de ambiente ao site:** **Project
   configuration → Environment variables → Add a variable**:
   - `AUE_BLOBS_SITE_ID` = o Project ID copiado no passo 1
   - `AUE_BLOBS_TOKEN` = o token copiado no passo 2
4. **Publicar de novo:** Deploys → Trigger deploy → Deploy site (as variáveis
   só ficam ativas numa nova publicação).
5. Volte à aplicação e toque no indicador "☁" na barra lateral para forçar
   nova sincronização.

Note que a mensagem de erro agora mostra sempre o motivo técnico exato (não
apenas "indisponível"), o que ajuda a confirmar se o problema é mesmo este ou
outro diferente (ex.: código de acesso errado em "Definições de
sincronização", ou falta de ligação à internet).

**Nota:** a aba **"Database"** que aparece no painel do Netlify é um produto
diferente (uma base de dados Postgres), não tem relação com esta aplicação —
o que importa aqui é apenas a aba **"Blobs"**.



### Netlify Blobs
Os sites Netlify modernos têm o Netlify Blobs disponível automaticamente, sem
configuração adicional — a função usa `getStore('aue-pedidos')` e o Netlify
associa isso automaticamente ao seu site. Não é preciso criar nenhuma base de
dados à parte.

### Estrutura de ficheiros do repositório
```
index.html              ← a aplicação; é este ficheiro que o Netlify serve na raiz do site
package.json
netlify.toml
netlify/
  functions/
    sync.js
```

### Testar depois de publicado
Abra a aplicação em dois computadores/separadores diferentes, crie ou edite um
pedido num deles, prima "Guardar alterações" e, no outro, toque no indicador
"☁" na barra lateral — o novo pedido deve aparecer sem pedir login.

## Limitações a ter em conta

- **Tamanho dos documentos anexados:** os 3 documentos de cada pedido são
  guardados como imagens/PDF em base64 dentro do próprio registo. Isto funciona
  bem para o volume normal de uma farmácia, mas se acumular muitos milhares de
  pedidos com documentos grandes, o tamanho total pode começar a ficar elevado.
  Se isso acontecer, o mais indicado é criar uma rotina de arquivo/exportação
  (CSV) dos pedidos mais antigos já entregues.
- **Sincronização "eventual", não em tempo real:** os dados sincronizam quando
  a aplicação arranca, quando a janela volta a estar em primeiro plano, quando a
  ligação à internet é restabelecida, a cada 90 segundos em segundo plano, e
  sempre que se prime "Guardar alterações" ou o indicador "☁". Não há
  atualização instantânea ao vivo entre dispositivos abertos ao mesmo tempo.
- **O login de email/palavra-passe continua a ser só uma proteção local do
  browser** (não é uma conta na nuvem) — serve para impedir o acesso casual ao
  ecrã, mas não está ligado à sincronização nem à segurança dos dados no servidor.
