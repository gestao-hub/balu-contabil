# Fluxo: Cadastro de usuário até empresa cadastrada

```mermaid
flowchart TD
    A([Usuário acessa /cadastro]) --> B[Preenche nome, tipo de conta,\ne-mail, senha + aceita termos]
    B --> C{Validação\nclient + server}
    C -->|erro| B
    C -->|ok| D[supabase.auth.signUp\nsalva metadata: nome, tipo, data termos\ntrigger DB cria role_types]

    D --> E{Confirm email\nativado no projeto?}
    E -->|SIM| F[cadastro/confirme-email\nTela: verifique seu e-mail]
    F --> G[Usuário clica no link\ndo e-mail]
    G --> H[auth/confirm\nverifyOtp → cria sessão]
    E -->|NÃO| I[Sessão criada direto]

    H --> J
    I --> J

    J[Redireciona para /] --> K{Auth layout gate\nverifica sessão e empresa}
    K -->|sem sessão| L([/login])
    K -->|sem empresa| M[/onboarding\nVamos começar]

    M --> N{Como quer\nadicionar a empresa?}
    N -->|Já tenho CNPJ| O[Abre CreateCompanyDialog]
    N -->|Quero abrir empresa| P[onboarding/abertura\nFluxo de abertura]

    O --> Q[Etapa 1: digita CNPJ\nbusca na Focus API\nautofill razão social,\nendereço, CNAE, regime]
    Q --> R[Etapa 2: revisa/edita\ndados da empresa]
    R --> S[Etapa 3: confirma\nregime tributário\nMEI / Simples / etc.]
    S --> T[createCompanyAction\ninsert companies\nupsert profiles.current_company\ninsert empresas_fiscais]
    T --> U{Salvou ok?}
    U -->|erro| S
    U -->|ok| V[router.push /]
    V --> W{Auth layout\nverifica novamente}
    W -->|current_company preenchido| X([App normal — dashboard])
```

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `app/(public)/cadastro/page.tsx` | Formulário de cadastro |
| `app/(public)/cadastro/actions.ts` | `signupAction` — chama `supabase.auth.signUp`, redireciona |
| `app/(public)/cadastro/confirme-email/page.tsx` | Tela de espera de confirmação de e-mail |
| `app/auth/confirm/route.ts` | Callback PKCE/token_hash — troca code/OTP por sessão |
| `app/(auth)/layout.tsx` | Auth gate — sem sessão → `/login`; sem empresa → `/onboarding` |
| `app/(onboarding)/onboarding/page.tsx` | Tela "Vamos começar" — escolha entre CNPJ existente ou abertura |
| `app/(onboarding)/onboarding/abertura/` | Fluxo de abertura de empresa (CNPJ novo) |
| `components/CreateCompanyDialog.tsx` | Dialog multi-etapa: CNPJ → busca Focus → dados → regime |
| `app/(auth)/onboarding/actions.ts` | `createCompanyAction` — insert companies + upsert profiles + insert empresas_fiscais |
