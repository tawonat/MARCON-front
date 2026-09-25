# MARCON / Smartway

## Instalação e banco MySQL 8

No Workbench, abra `db/001_initial.sql` e execute o arquivo inteiro, sem selecionar
apenas um trecho. O script cria e seleciona `marcon` antes de criar as tabelas.
Atualize a lista **Schemas** ao terminar. Requer MySQL 8 e permissão para criar o banco.
Pelo terminal, `npm run db:migrate` cria o banco indicado em `DATABASE_URL` se necessário.

Na pasta `smartway`, execute `npm ci` (Node 20.9 ou superior).
Sem `DB_NAME`, `DB_USER` e `DATABASE_URL`, `npm run dev` inicia a demonstração em memória.

Para persistência, crie um banco MySQL 8 com charset `utf8mb4` e um usuário com
acesso a ele. Copie `.env.example` para `.env.local` e configure `DB_HOST`, `DB_PORT`,
`DB_NAME`, `DB_USER`, `DB_PASSWORD`,
`SESSION_SECRET` e `SEED_PASSWORD`. Nos campos separados a senha não precisa de
codificação de URL. Use aspas se houver `#` e escape `$` como `\$` no arquivo env.
`DATABASE_URL` continua disponível como alternativa; `DB_NAME` e `DB_USER` têm prioridade.
Nesta máquina, o serviço MySQL80 usa a porta `3307` no `my.ini`; defina
`DB_PORT=3307` no `.env.local`. O Workbench é apenas o cliente: a aplicação
se conecta ao MySQL Server com usuário e senha próprios.
Gere um segredo privado com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
A senha do seed deve ter pelo menos 12 caracteres.

Execute `npm run db:migrate`, `npm run db:seed` e `npm run dev`.
Remova `SEED_PASSWORD` do ambiente após o seed e reinicie a aplicação.
Nunca publique `.env.local`. `/health` verifica a conexão.
O seed usa `INSERT IGNORE`: não redefine senhas, saldos ou usuários existentes.
Faça backup antes de migrar bancos existentes: DDL MySQL não tem rollback integral.

| Matrícula | E-mail | Perfil | Bloco no seed MySQL |
| --- | --- | --- | --- |
| 1001 | ana@marcon.demo | Funcionário | A |
| 1002 | carlos@marcon.demo | Líder | A |
| 1003 | mariana@marcon.demo | Almoxarifado | — |
| 1004 | rafael@marcon.demo | Administrador | — |

No MySQL, a senha inicial das quatro contas é `SEED_PASSWORD` (no ambiente local
de exemplo, `Marcon@12345`).
Na demonstração, a senha é `Marcon@123`. O demo mantém seus dados próprios.
Em bancos antigos, Carlos pode continuar no bloco B: ajuste pelo administrador
para aprovar pedidos de Ana. RFID é simulado apenas no modo demonstração.

## Verificação e pendências

Execute `npm run lint`, `npm run build` e, sem `DATABASE_URL`, `npm run test:e2e`.
Instale Chromium com `npx playwright install chromium` ou configure
`PLAYWRIGHT_CHANNEL=chrome` para usar o Chrome instalado.

Para integração, use um banco descartável cujo nome termine em `_test`, configure
`.env.local`, execute migração e seed e mantenha `SEED_PASSWORD` durante o teste.
Execute `npx playwright test --config=playwright.mysql.config.ts`.
O teste usa a porta 3101 e mantém os registros criados para inspeção.

As dependências foram recuperadas: lint e build passaram. Os testes de demonstração
cobrem os quatro logins fixos, retorno, logout e bloqueio de acesso entre perfis.
Para testar com outro servidor dev aberto, rode primeiro `npm run build` e defina
`PLAYWRIGHT_PRODUCTION=1`, `PLAYWRIGHT_PORT=3100` e `PLAYWRIGHT_CHANNEL=chrome`.
A configuração demo desativa `DB_NAME`, `DB_USER` e `DATABASE_URL` somente no processo de teste.
O MySQL local ainda retorna `ER_ACCESS_DENIED_ERROR` com as credenciais de exemplo.
Migração, seed e testes reais permanecem pendentes até configurar o acesso real.
**MySQL não validado para produção.**

## Perfil e autenticação facial

`/profile` permite atualizar nome, e-mail e senha no MySQL. Toda alteração exige
a senha atual; cinco tentativas incorretas bloqueiam novas tentativas por 15
minutos. A troca de senha invalida as sessões anteriores. O administrador define
e confirma a senha inicial no cadastro de usuários.

O teste de câmera foi substituído por passkeys WebAuthn. Com MySQL configurado,
o usuário entra com senha, abre `/profile` e cadastra uma passkey integrada ao dispositivo.
Depois, pode informar e-mail ou matrícula e entrar com a passkey. O aparelho
pode solicitar rosto, digital ou PIN conforme o sistema, sem chave USB. A aplicação não recebe
nem armazena imagens ou dados biométricos. O servidor verifica o desafio, a
assinatura e a credencial cadastrada antes de criar a sessão. Execute
`npm run db:migrate` para criar as tabelas de passkeys no banco existente.
WebAuthn requer HTTPS em produção (localhost funciona para desenvolvimento)
e um domínio estável: passkeys cadastradas em outro domínio não funcionam.
