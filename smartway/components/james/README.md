# James

- **Transcrição:** Web Speech API com `processLocally=true`, pacote `pt-BR` e ativação explícita. Sem pacote local, usa texto/botões; não troca silenciosamente para reconhecimento remoto. A escuta pausa ao ocultar a aba. Após despertar, a conversa permanece ativa por 90 segundos sem repetir o nome.
- **Síntese:** `speechSynthesis` com voz `pt` marcada `localService`. Sem voz local, a resposta fica em texto. O reconhecedor é suspenso durante a fala para impedir autoconfirmação; o botão Interromper retoma a interação.
- **IA:** `JAMES_PROVIDER=nvidia`, `NVIDIA_API_KEY` somente no servidor, modelo `openai/gpt-oss-20b`. Transcrição em texto e contexto mínimo do carrinho vão à NVIDIA; áudio não vai. Alternativa explícita: `JAMES_PROVIDER=ollama`, `OLLAMA_URL`, `OLLAMA_MODEL`.
- **Ações:** interpretação tipada, resolução de itens no servidor, permissões existentes, resumo assinado e confirmação explícita. Reenvio do mesmo resumo reutiliza o resultado persistido. Migração `004_request_submissions` necessária.
- **Pet:** preferências locais por usuário; fica parado por padrão. Movimento opcional após inatividade; quando não há canto livre, usa uma área no fluxo da página. Destaques nunca clicam ou preenchem controles. Efeitos próprios em CSS/WAAPI; nenhum recurso do CodePen foi copiado, pois referência/licença não ficaram acessíveis.
- **Testes:** `tests/mysql/james.spec.ts` usa modelos/transcrições controlados com MySQL real; `james-live.spec.ts` só chama NVIDIA com `JAMES_LIVE_TEST=1`. Isso não valida microfone físico ou desempenho em hardware móvel real.
