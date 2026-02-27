# Patch SPP Carreira (segurança + 1 chamada Claude + supabase opcional)

## O que tem aqui
- resultado.html (atualizado): remove lógica/prompt/arquétipos do front e chama /api/process
- api/process.js: calcula score/arquetipo no servidor, chama Claude 1x (max_tokens limitado) e retorna JSON
  - se SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY existirem no Vercel, salva o lead na tabela `leads`.

## Como aplicar
1) No seu repo, crie a pasta `api/` na raiz (se não existir)
2) Substitua `resultado.html` pelo deste patch
3) Adicione `api/process.js`
4) No Vercel, garanta:
   - ANTHROPIC_API_KEY setada
   - (opcional) SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
5) Redeploy
