# HViagem — Prestação de Contas Hubvision

App mobile-first para lançar e aprovar despesas de viagem.

- **Colaborador:** lança as próprias despesas a partir da foto ou do arquivo do comprovante. A leitura automática (Gemini) preenche tipo, valor, data e descrição para conferência.
- **Admin:** cria os usuários, vê as despesas da equipe com os anexos, aprova ou rejeita e faz o fechamento com PDF por colaborador.

Stack: TanStack Start (React 19, Vite), Tailwind, shadcn/ui, Supabase (banco, autenticação e storage).

## Configuração

1. Crie o banco rodando, em ordem, os arquivos de `supabase/migrations/` no SQL Editor do Supabase.
2. Copie `.env.example` para `.env.local` e preencha. As variáveis `VITE_*` são embutidas no build; as demais são lidas pelo servidor em tempo de execução.
3. No Supabase, desligue o cadastro público. A primeira conta criada vira admin; as demais são criadas pelo admin na tela Usuários.

## Desenvolvimento

```bash
npm install
npm run dev
```

O app abre em http://localhost:8080.

## Produção (servidor Node)

```bash
npm ci
npm run build
npm start
```

O build fica em `.output/` e o servidor escuta na porta definida em `PORT` (padrão 3000). No ambiente do servidor precisam existir `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `GEMINI_API_KEY`. As variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` precisam estar definidas no momento do build.
